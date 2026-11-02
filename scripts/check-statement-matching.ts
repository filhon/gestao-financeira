/**
 * Verificação do motor de conciliação (extrato × títulos).
 *   npm run check:statement-matching
 * Falha com exceção no primeiro cenário quebrado.
 */
import assert from "node:assert/strict";
import {
  documentsIn,
  matchStatement,
  subsetSum,
} from "../src/lib/matching/statement";
import { statementAliases, statementPayee } from "../src/lib/matching/learn";
import { isValidCNPJ } from "../src/lib/matching/brazilian";
import type { BankTransaction, Entity, Transaction } from "../src/lib/types";

const day = (d: number, m = 11) => new Date(2026, m - 1, d);

const line = (
  description: string,
  amount: number,
  date = day(2),
): BankTransaction => ({
  id: `l-${description}-${amount}`,
  date,
  amount,
  description,
  type: amount < 0 ? "debit" : "credit",
  status: "unmatched",
});

let seq = 0;
const title = (t: Partial<Transaction>): Transaction =>
  ({
    id: `t${++seq}`,
    type: "payable",
    status: "approved",
    description: "Projeto",
    amount: 1000,
    dueDate: day(2),
    ...t,
  }) as Transaction;

const entity = (id: string, name: string, document?: string) =>
  ({ id, name, document }) as Entity;

const XINGU = entity(
  "x",
  "Instituição Missionária Xingu",
  "11.222.333/0001-81",
);
const OUTRA = entity("o", "Associação Vale Verde", "11.444.777/0001-61");
const MARIA = entity("m", "Maria Souza");
const JOAO = entity("j", "João Silva");
const entities = [XINGU, OUTRA, MARIA, JOAO];

// 1. Dez projetos aprovados da mesma instituição, uma transferência só.
{
  const projects = Array.from({ length: 10 }, (_, i) =>
    title({ entityId: "x", supplierOrClient: XINGU.name, dueDate: day(i + 1) }),
  );
  const noise = title({
    entityId: "o",
    supplierOrClient: OUTRA.name,
    amount: 10000,
  });
  const [r] = matchStatement(
    [line("PIX TRANSF INSTITUICAO MI02/11", -10000)],
    [...projects, noise],
    entities,
  );
  assert.equal(r.status, "potential_match");
  assert.deepEqual(
    new Set(r.matchedTransactionIds),
    new Set(projects.map((p) => p.id)),
  );
  assert.ok(r.confidence! >= 90, `forte, veio ${r.confidence}`);

  // Sem o nome no extrato: ainda sugere o grupo inteiro, mas não pré-marca.
  const [blind] = matchStatement(
    [line("SISPAG FORNECEDORES", -10000)],
    projects,
    entities,
  );
  assert.equal(blind.matchedTransactionIds?.length, 10);
  assert.ok(blind.confidence! >= 70 && blind.confidence! < 90);
}

// 2. Doze projetos iguais e nove pagos: soma bate, mas quais nove? Não pré-marca.
{
  const projects = Array.from({ length: 12 }, () =>
    title({ entityId: "x", supplierOrClient: XINGU.name }),
  );
  const [r] = matchStatement(
    [line("PIX TRANSF INSTITUICAO MI02/11", -9000)],
    projects,
    entities,
  );
  assert.equal(r.matchedTransactionIds?.length, 9);
  assert.ok(r.confidence! <= 80);
}

// 3. Título pago com juros, fora do vencimento: casa pela baixa, não pelo vencimento.
{
  const paid = title({
    status: "paid",
    entityId: "o",
    supplierOrClient: OUTRA.name,
    dueDate: day(15, 9),
    paymentDate: day(30, 10),
    amount: 1000,
    finalAmount: 1020,
  });
  const [r] = matchStatement(
    [line("PIX TRANSF ASSOCIACAO VA30/10", -1020, day(30, 10))],
    [paid],
    entities,
  );
  assert.equal(r.matchedTransactionId, paid.id);
  assert.ok(r.confidence! >= 90);
}

// 4. Sequência de 14 dígitos que não é CNPJ não derruba o casamento.
{
  assert.deepEqual(documentsIn("PAG BOLETO 12345678901234"), []);
  assert.deepEqual(documentsIn("TED 11.222.333/0001-81 XINGU"), [
    "11222333000181",
  ]);
  const paid = title({
    status: "paid",
    paymentDate: day(2),
    supplierOrClient: "Energia",
  });
  const [r] = matchStatement(
    [line("PAG BOLETO 12345678901234", -1000)],
    [paid],
    entities,
  );
  assert.equal(r.matchedTransactionId, paid.id);
}

// 5. CNPJ do extrato é de outra entidade: não casa, mesmo com valor e data.
{
  const other = title({ status: "paid", paymentDate: day(2), entityId: "o" });
  const [r] = matchStatement(
    [line("TED 11.222.333/0001-81", -1000)],
    [other],
    entities,
  );
  assert.equal(r.status, "unmatched");
  assert.equal(r.matchedTransactionId, undefined);
}

// 6. O título vai para a linha em que ele é a melhor resposta, não para a primeira.
{
  const maria = title({
    status: "paid",
    paymentDate: day(3),
    entityId: "m",
    amount: 500,
  });
  const joao = title({
    status: "paid",
    paymentDate: day(1),
    entityId: "j",
    amount: 500,
  });
  const [vague, named] = matchStatement(
    [
      line("SISPAG FORNECEDORES", -500, day(3)),
      line("PIX TRANSF MARIA SOUZA03/11", -500, day(3)),
    ],
    [maria, joao],
    entities,
  );
  assert.equal(named.matchedTransactionId, maria.id);
  assert.notEqual(vague.matchedTransactionId, maria.id);
}

// 7. Título aberto com bloqueio de pagamento não é sugerido.
{
  const held = title({
    entityId: "x",
    paymentHold: { reason: "x" } as Transaction["paymentHold"],
  });
  const [r] = matchStatement([line("PIX XINGU", -1000)], [held], entities);
  assert.equal(r.status, "unmatched");
}

// 8. Somatório: acha a combinação e diz quando há mais de uma.
{
  const items = [300, 200, 500].map((v) => ({ cents: v }));
  assert.equal(subsetSum(items, 500)?.ways, 2);
  assert.deepEqual(subsetSum(items, 1000)?.items.length, 3);
  assert.equal(subsetSum(items, 50), null);
}

// 9. Formato real do Itaú (SISPAG): favorecido e documento saem do histórico.
const SBB =
  "PAGAMENTOS A FORNECEDORES SOCIEDADE BIBLICA DO BRASIL 33.579.376/0001-51";
{
  assert.equal(statementPayee(SBB), "sociedade biblica do brasil");
  assert.deepEqual(documentsIn(SBB), ["33579376000151"]);
  assert.equal(
    statementPayee(
      "PAGAMENTOS A FORNECEDORES 58.621.963 CLEYTON FEITOSA DA SILVA 58.621.963/0001-92",
    ),
    "cleyton feitosa da silva",
  );
  assert.equal(statementPayee("SALDO ANTERIOR"), "saldo anterior");
  assert.equal(statementPayee("PAGAMENTOS A FORNECEDORES 12"), "");
}

// 10. Aprender: cadastro sem documento e com apelido; confirmada uma vez, a
// próxima linha casa pelo CNPJ que o banco imprimiu.
{
  const sbb = entity("sbb", "SBB - Bíblias");
  const before = matchStatement(
    [line(SBB, -500)],
    [
      title({
        status: "paid",
        paymentDate: day(9),
        entityId: "sbb",
        amount: 500,
      }),
    ],
    [sbb, ...entities],
  )[0];
  assert.notEqual(before.status, "potential_match", "sem cadastro, data longe");

  const learned = statementAliases(SBB, documentsIn(SBB), sbb, [
    sbb,
    ...entities,
  ]);
  assert.deepEqual(learned.documents, ["33579376000151"]);
  assert.deepEqual(learned.names, ["sociedade biblica do brasil"]);
  const taught = { ...sbb, receiptAliases: learned } as Entity;

  const after = matchStatement(
    [line(SBB, -500)],
    [
      title({
        status: "paid",
        paymentDate: day(9),
        entityId: "sbb",
        amount: 500,
      }),
    ],
    [taught, ...entities],
  )[0];
  assert.equal(after.status, "potential_match");

  // Documento que já é de outra entidade nunca vira apelido.
  const blocked = statementAliases(
    "PAGAMENTOS A FORNECEDORES XINGU 11.222.333/0001-81",
    ["11222333000181"],
    sbb,
    [sbb, ...entities],
  );
  assert.deepEqual(blocked.documents, []);
}

// 11. Filial: mesma raiz de CNPJ reforça um pouco, não recusa.
{
  const withDv = (base: string) => {
    for (let dv = 0; dv < 100; dv++) {
      const c = base + String(dv).padStart(2, "0");
      if (isValidCNPJ(c)) return c;
    }
    throw new Error(base);
  };
  const matriz = withDv("001183310001");
  const ipb = entity("ipb", "Igreja Presbiteriana do Brasil", matriz);
  const [r] = matchStatement(
    [
      line(
        "PAGAMENTOS A FORNECEDORES IGREJA PRESBITERIANA DO BRASIL 00.118.331/0004-73",
        -700,
      ),
    ],
    [
      title({
        status: "paid",
        paymentDate: day(2),
        entityId: "ipb",
        amount: 700,
      }),
    ],
    [ipb],
  );
  assert.equal(r.status, "potential_match");
}

// 12. Velocidade: 500 linhas × 3.000 títulos em menos de 2 s.
{
  const many = Array.from({ length: 3000 }, (_, i) =>
    title({
      status: i % 2 ? "paid" : "approved",
      paymentDate: i % 2 ? day((i % 28) + 1) : undefined,
      supplierOrClient: `Fornecedor ${i % 300}`,
      amount: 100 + (i % 977),
    }),
  );
  const lines = Array.from({ length: 500 }, (_, i) =>
    line(
      `PIX TRANSF FORNECEDOR ${i}`,
      -(100 + ((i * 7) % 977)),
      day((i % 28) + 1),
    ),
  );
  const start = performance.now();
  matchStatement(lines, many, entities);
  const ms = performance.now() - start;
  assert.ok(ms < 2000, `${Math.round(ms)} ms`);
  console.log(`500 linhas × 3.000 títulos: ${Math.round(ms)} ms`);
}

console.log("check:statement-matching ok");
