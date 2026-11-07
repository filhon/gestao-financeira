/**
 * Verificação da fila de sugestões e da prova cruzada extrato × comprovante.
 *   npm run check:matching-queue
 * Falha com exceção no primeiro cenário quebrado.
 */
import assert from "node:assert/strict";
import {
  accuracyByBand,
  distantPaymentDate,
  distributeSuggestions,
  isFromBeneficiary,
  receiptFeedback,
} from "../src/lib/matching/queue";
import {
  autoConfirmReason,
  extractControlNumber,
  matchComprovante,
} from "../src/lib/matching";
import { matchStatement } from "../src/lib/matching/statement";
import type { BankTransaction, Entity, Transaction } from "../src/lib/types";

const paidOn = new Date("2026-05-29T12:00:00-03:00");
const tx = (id: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    id,
    companyId: "c1",
    description: "Oferta projeto",
    amount: 1000,
    type: "payable",
    status: "paid",
    entityId: "x",
    supplierOrClient: "Missão Xingu",
    paymentDate: paidOn,
    dueDate: paidOn,
    createdBy: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  }) as Transaction;
const xingu = {
  id: "x",
  companyId: "c1",
  name: "Missão Xingu",
  document: "11.222.333/0001-81",
  type: "company",
  category: "supplier",
  createdAt: new Date(),
  updatedAt: new Date(),
} as Entity;

// 1. Três comprovantes iguais disputando a mesma conta: a mais forte fica,
// as outras são casadas de novo com o que sobrou; sem opção, a disputa fica.
{
  const queue = [
    { id: "c1", ids: ["t1"], score: 80 },
    { id: "c2", ids: ["t1"], score: 90 },
    { id: "c3", ids: ["t1"], score: 70 },
  ];
  const spare = ["t2"];
  const changed = distributeSuggestions(queue, new Set(), (_, used) => {
    const free = spare.find((id) => !used.has(id));
    return free ? { ids: [free] } : null;
  });
  assert.equal(changed.has("c2"), false, "a mais forte não muda");
  assert.deepEqual(changed.get("c1"), { ids: ["t2"] });
  assert.equal(changed.get("c3"), null);

  // Conta com comprovante confirmado já está tomada.
  const taken = distributeSuggestions(
    [{ id: "c4", ids: ["t9"], score: 95 }],
    new Set(["t9"]),
    () => null,
  );
  assert.equal(taken.get("c4"), null);
}

// 2. Acerto por faixa.
{
  const rows = accuracyByBand(
    [
      { score: 95, outcome: "accepted" },
      { score: 92, outcome: "undone" },
      { score: 75, outcome: "changed" },
      { score: 40, outcome: "rejected" },
    ],
    [90, 70, 0],
  );
  assert.deepEqual(
    rows.map((r) => [r.min, r.max, r.total, r.accepted]),
    [
      [90, 100, 2, 1],
      [70, 89, 1, 0],
      [0, 69, 1, 0],
    ],
  );
  assert.equal(rows[0].rate, 0.5);
}

// 3. Desfecho de um comprovante: automático não conta; recusa conta.
{
  const base = { matchConfidence: 88, suggestedTransactionIds: ["a", "b"] };
  assert.equal(
    receiptFeedback({
      ...base,
      matchStatus: "matched",
      transactionIds: ["b", "a"],
    })?.outcome,
    "accepted",
  );
  assert.equal(
    receiptFeedback({ ...base, matchStatus: "matched", transactionIds: ["c"] })
      ?.outcome,
    "changed",
  );
  assert.equal(
    receiptFeedback({ ...base, matchStatus: "matched", reviewedBy: "auto" }),
    null,
  );
  assert.equal(
    receiptFeedback({
      matchStatus: "rejected_match",
      matchConfidence: 60,
      suggestedTransactionIds: null,
    })?.outcome,
    "rejected",
  );
}

// 4. Extrato → comprovante: entre duas contas iguais, a que o extrato já
// provou paga naquele dia vence.
{
  const receipt = `Comprovante de transferência PIX
Data do pagamento: 29/05/2026
Valor: R$ 1.000,00
Recebedor: MISSAO XINGU`;
  const out = matchComprovante(
    receipt,
    [tx("t1"), tx("t2", { reconciled: true })],
    { entities: [xingu] },
  );
  assert.equal(out.best?.transactionId, "t2");
  assert.ok(
    out.best?.reasons.includes("Pagamento conferido no extrato bancário"),
  );
}

// 5. Comprovante → extrato: a conta com comprovante confirmado sobe.
{
  const line: BankTransaction = {
    id: "l1",
    date: paidOn,
    amount: -1000,
    description: "PAGAMENTOS A FORNECEDORES MISSAO XINGU",
    type: "debit",
    status: "unmatched",
  };
  const [plain] = matchStatement([line], [tx("t1")], [xingu]);
  const [proven] = matchStatement(
    [line],
    [tx("t1", { comprovanteId: "c1" })],
    [xingu],
  );
  assert.equal(proven.confidence, Math.min(100, plain.confidence! + 5));
  assert.ok(
    proven.matchCandidates?.[0].reasons.includes("Comprovante confirmado"),
  );
}

console.log("check:matching-queue ok");

// 6. Parcelas mensais iguais: comprovante de 30/10 com CNPJ e valor exato não
// pode cair na parcela paga em 30/09 só porque a de 30/10 já tem comprovante.
{
  const receipt = `Comprovante de transferência PIX
Data da transferência: 30/10/2026
Valor: R$ 1.000,00
CPF/CNPJ do recebedor: 11.222.333/0001-81
Nome do recebedor: MISSAO XINGU`;
  const sep = new Date("2026-09-30T12:00:00-03:00");
  const oct = new Date("2026-10-30T12:00:00-03:00");
  const out = matchComprovante(
    receipt,
    [
      tx("set", { paymentDate: sep, dueDate: sep }),
      tx("out", { paymentDate: oct, dueDate: oct, comprovanteId: "outro" }),
    ],
    { entities: [xingu] },
  );
  assert.notEqual(
    out.best?.confidenceLevel,
    "HIGH",
    "parcela de outro mês não é Alta",
  );
  if (out.best?.transactionId === "set") {
    assert.ok(out.best.signals.penalties.includes("data_distante"));
    assert.ok(
      out.best.reasons.some((r) =>
        r.startsWith("⚠ Comprovante de 30/10/2026"),
      ),
    );
  }

  // Mesmo comprovante, parcela do mês livre: continua Alta.
  const ok = matchComprovante(
    receipt,
    [
      tx("set", { paymentDate: sep, dueDate: sep }),
      tx("out", { paymentDate: oct, dueDate: oct }),
    ],
    { entities: [xingu] },
  );
  assert.equal(ok.best?.transactionId, "out");
  assert.equal(ok.best?.confidenceLevel, "HIGH");
}

// ── Data lida × data de pagamento do título ─────────────────────────────────
{
  const paidOn = new Date(2026, 0, 30);
  assert.ok(
    distantPaymentDate(new Date(2026, 9, 30), [paidOn]),
    "comprovante de 30/10 × título pago em 30/01 diverge",
  );
  assert.equal(
    distantPaymentDate(new Date(2026, 1, 2), [paidOn]),
    null,
    "3 dias (fim de semana) é tolerado",
  );
  assert.equal(
    distantPaymentDate(new Date(2026, 9, 30), [
      undefined,
      paidOn,
      new Date(2026, 9, 29),
    ]),
    null,
    "consolidado: basta um título perto da data lida",
  );
  assert.equal(distantPaymentDate(undefined, [paidOn]), null, "sem data lida");
  console.log("check:matching-queue datas ok");
}

// ── Número de controle e beneficiário ─────────────────────────────────────────
{
  const ctl = "000009046871551";
  assert.equal(extractControlNumber(`ID: E60 controle: ${ctl} transação`), ctl);
  assert.equal(
    extractControlNumber(`via Sispag, CTRL 001492662428818.`),
    "001492662428818",
  );
  assert.equal(
    extractControlNumber(`DY5PXFIG3AMcontrole:${ctl}transação efetuada`),
    ctl,
    "PDF com o texto colado",
  );
  assert.equal(
    extractControlNumber(`controle\nHEBRON\n03.458.134/0001-49\n${ctl}\nFim`),
    ctl,
    "OCR com rótulos e valores em colunas",
  );
  assert.equal(
    extractControlNumber(`controle\n${ctl}\n271793382417389`),
    ctl,
    "colado ao rótulo vence os soltos",
  );
  assert.equal(
    extractControlNumber(`controle\nA\n${ctl}\n271793382417389`),
    undefined,
    "dois candidatos soltos: não adivinha",
  );
  assert.equal(extractControlNumber(`Autenticação\n${ctl}`), undefined);
  assert.equal(
    extractControlNumber(
      `controle\n34191090086144173124971066670002116210000074240`,
    ),
    undefined,
    "código de barras não é controle",
  );

  const read = { matchedEntity: "Missão do Céu" };
  assert.ok(isFromBeneficiary(read, { supplierOrClient: "MISSAO DO CEU" }));
  assert.ok(!isFromBeneficiary(read, { supplierOrClient: "Outro" }));
  assert.ok(!isFromBeneficiary(read, {}), "título sem fornecedor");
  const fixed = {
    matchedEntity: "Missão do Céu",
    manualFields: { entityId: "e1" },
  };
  assert.ok(
    isFromBeneficiary(fixed, {
      entityId: "e1",
      supplierOrClient: "Nome antigo",
    }),
    "cadastro corrigido vale sobre o nome",
  );
  assert.ok(
    !isFromBeneficiary(fixed, {
      entityId: "e2",
      supplierOrClient: "Missão do Céu",
    }),
  );
  assert.ok(isFromBeneficiary(fixed, { supplierOrClient: "Missão do Céu" }));
  console.log("check:matching-queue controle e beneficiário ok");
}

// ── Código de barras desempata ────────────────────────────────────────────────
{
  const linha = "34191090086141955124971066670002115900000026519";
  const outraLinha = "34191090086145998124971066670002116210000026519";
  const receipt = (cnpj: string) => `Comprovante de pagamento de boleto
Beneficiário: MISSAO XINGU
CPF/CNPJ do beneficiário: ${cnpj}
34191 09008 61419 551249 71066 670002 1 15900000026519
Valor do pagamento (R$): 265,19
Data de pagamento: 29/05/2026
Operação efetuada via Sispag, CTRL 008717912271057.`;
  const sala = (id: string, barcode?: string) =>
    tx(id, { description: `Condomínio ${id}`, amount: 265.19, barcode });
  const entities = [xingu];
  const cnpj = "11.222.333/0001-81";

  const tie = matchComprovante(receipt(cnpj), [sala("s1"), sala("s2")], {
    entities,
  }).best!;
  assert.ok(tie.isAmbiguous, "sem código nos títulos o empate continua");

  const hit = matchComprovante(
    receipt(cnpj),
    [sala("s1"), sala("s2", linha), sala("s3", outraLinha)],
    { entities },
  ).best!;
  assert.deepEqual(hit.transactionIds, ["s2"], "o título do código vence");
  assert.ok(!hit.isAmbiguous, "código igual não é ambíguo");
  assert.equal(hit.confidenceLevel, "HIGH");
  assert.equal(hit.signals.entityEvidence, "barcode");
  assert.ok(autoConfirmReason(hit), "pode confirmar sozinho");

  const both = matchComprovante(
    receipt(cnpj),
    [sala("s1", linha), sala("s2", linha)],
    { entities },
  ).best!;
  assert.ok(both.isAmbiguous, "dois títulos com o mesmo código ainda disputam");

  const other = matchComprovante(
    receipt("04.252.011/0001-10"),
    [sala("s2", linha)],
    { entities },
  ).best!;
  assert.ok(
    other.score >= 97 &&
      !other.signals.penalties.includes("documento_divergente"),
    "intermediário emitiu o boleto: o código vale sobre o CNPJ",
  );

  const far = matchComprovante(
    receipt(cnpj),
    [
      sala("s1"),
      tx("s2", {
        amount: 265.19,
        barcode: linha,
        paymentDate: new Date("2026-02-02T12:00:00-03:00"),
        dueDate: new Date("2026-02-02T12:00:00-03:00"),
      }),
    ],
    { entities },
  ).best!;
  assert.deepEqual(far.transactionIds, ["s1"], "data distante ainda pesa");
  console.log("check:matching-queue código de barras ok");
}
