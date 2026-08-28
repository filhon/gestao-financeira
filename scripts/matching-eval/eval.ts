/**
 * Suíte de avaliação do motor de matching de comprovantes.
 *
 * Rode com `npm run eval:matching`. Cada bloco é um cenário real de
 * comprovante brasileiro; falhas indicam regressão de precisão, não de
 * compilação. Ao mexer em pesos, limiares ou extração, rode isto antes.
 */
import { matchComprovante, parseReceipt } from "@/lib/matching";
import type { Entity, Transaction } from "@/lib/types";

const brt = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d, 3));

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(
      `  FAIL ${name}`,
      detail !== undefined ? JSON.stringify(detail) : "",
    );
  }
}

function tx(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    companyId: "c1",
    description: "",
    amount: 0,
    type: "payable",
    status: "paid",
    dueDate: brt(2026, 6, 10),
    createdBy: "u1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Transaction;
}

const entities: Entity[] = [
  {
    id: "e-acme",
    companyId: "c1",
    name: "ACME Distribuidora de Alimentos LTDA",
    type: "company",
    document: "11.444.777/0001-61",
    category: "supplier",
    pixKey: "11444777000161",
    agency: "1234",
    account: "56789",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "e-beta",
    companyId: "c1",
    name: "Beta Distribuidora de Alimentos LTDA",
    type: "company",
    document: "45.997.418/0001-53",
    category: "supplier",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

console.log("\n=== 1. Extração de fatos ===");
{
  const facts = parseReceipt(`
    Banco XPTO — Comprovante de transferência PIX
    Data do pagamento: 10/06/2026
    Valor do pagamento: R$ 12.345,67
    Tarifa: R$ 1,90
    Saldo disponível: R$ 98.765,43
    Beneficiário: ACME DISTRIBUIDORA DE ALIMENTOS LTDA
    CNPJ: 11.444.777/0001-61
    Pagador: MINHA EMPRESA SA
    CNPJ: 45.997.418/0001-53
  `);

  check(
    "valor rotulado vence a tarifa",
    facts.amounts[0].value === 12345.67,
    facts.amounts.slice(0, 3),
  );
  check(
    "tarifa capturada com peso baixo",
    facts.amounts.some((a) => a.value === 1.9 && a.weight < 0.3),
  );
  check(
    "data do pagamento extraída",
    facts.dates[0]?.date.getTime() === brt(2026, 6, 10).getTime(),
  );
  check(
    "CNPJ do beneficiário identificado",
    facts.documents.some(
      (d) => d.digits === "11444777000161" && d.role === "beneficiary",
    ),
    facts.documents,
  );
  check(
    "CNPJ do pagador identificado",
    facts.documents.some(
      (d) => d.digits === "45997418000153" && d.role === "payer",
    ),
    facts.documents,
  );
  check("método pix detectado", facts.paymentMethods.includes("pix"));
  check(
    "nome do beneficiário lido",
    facts.beneficiaryNames.some((n) => n.includes("acme")),
    facts.beneficiaryNames,
  );
}

console.log("\n=== 2. Data por extenso e CPF mascarado ===");
{
  const facts = parseReceipt(`
    Comprovante Pix
    Pago em 08 de junho de 2026 às 14:32
    Valor: R$ 1.500,00
    Recebedor: JOAO DA SILVA
    CPF: ***.456.789-**
  `);
  check(
    "data por extenso",
    facts.dates[0]?.date.getTime() === brt(2026, 6, 8).getTime(),
    facts.dates,
  );
  check("valor com milhar", facts.amounts[0]?.value === 1500);
  check(
    "CPF mascarado",
    facts.documents.some((d) => d.masked && d.visible === "456789"),
    facts.documents,
  );
}

console.log("\n=== 3. Desempate por CNPJ entre fornecedores homônimos ===");
{
  const transactions = [
    tx({
      id: "t-acme",
      amount: 12345.67,
      description: "Compra de insumos",
      supplierOrClient: "ACME Distribuidora de Alimentos LTDA",
      entityId: "e-acme",
      paymentDate: brt(2026, 6, 10),
    }),
    tx({
      id: "t-beta",
      amount: 12345.67,
      description: "Compra de insumos",
      supplierOrClient: "Beta Distribuidora de Alimentos LTDA",
      entityId: "e-beta",
      paymentDate: brt(2026, 6, 10),
    }),
  ];

  const text = `Comprovante PIX
    Data do pagamento: 10/06/2026
    Valor do pagamento: R$ 12.345,67
    Beneficiário: ACME DISTRIBUIDORA DE ALIMENTOS LTDA
    CNPJ do beneficiário: 11.444.777/0001-61`;

  const out = matchComprovante(text, transactions, { entities });
  check("acerta a ACME", out.best?.transactionId === "t-acme", {
    best: out.best?.transactionId,
    score: out.best?.score,
  });
  check(
    "confiança alta",
    out.best?.confidenceLevel === "HIGH",
    out.best?.score,
  );
  check("não fica ambíguo", out.isAmbiguous === false, {
    margin: out.best?.margin,
  });
  check(
    "rival penalizado por CNPJ divergente",
    (out.candidates.find((c) => c.transactionId === "t-beta")?.score ?? 0) < 40,
    out.candidates.map((c) => [c.transactionId, c.score]),
  );
}

console.log("\n=== 4. Ambiguidade real é sinalizada ===");
{
  const transactions = [
    tx({
      id: "t-a",
      amount: 500,
      description: "Servico mensal",
      supplierOrClient: "Fornecedor Um",
      paymentDate: brt(2026, 6, 10),
    }),
    tx({
      id: "t-b",
      amount: 500,
      description: "Servico mensal",
      supplierOrClient: "Fornecedor Dois",
      paymentDate: brt(2026, 6, 10),
    }),
  ];
  const out = matchComprovante(
    "Comprovante\nData: 10/06/2026\nValor: R$ 500,00",
    transactions,
  );
  check(
    "marca ambiguidade",
    out.isAmbiguous === true,
    out.candidates.map((c) => [c.transactionId, c.score]),
  );
  check(
    "não sobe para HIGH",
    out.best?.confidenceLevel !== "HIGH",
    out.best?.confidenceLevel,
  );
  check("oferece alternativa", out.alternatives.length >= 1);
}

console.log("\n=== 5. Consolidação por subconjunto (3 de 5 títulos) ===");
{
  const transactions = [
    tx({
      id: "c1",
      amount: 1000,
      description: "NF 8801",
      supplierOrClient: "ACME Distribuidora de Alimentos LTDA",
      entityId: "e-acme",
      paymentDate: brt(2026, 6, 10),
    }),
    tx({
      id: "c2",
      amount: 2500.5,
      description: "NF 8802",
      supplierOrClient: "ACME Distribuidora de Alimentos LTDA",
      entityId: "e-acme",
      paymentDate: brt(2026, 6, 11),
    }),
    tx({
      id: "c3",
      amount: 749.5,
      description: "NF 8803",
      supplierOrClient: "ACME Distribuidora de Alimentos LTDA",
      entityId: "e-acme",
      paymentDate: brt(2026, 6, 12),
    }),
    tx({
      id: "c4",
      amount: 9999,
      description: "NF 8804",
      supplierOrClient: "ACME Distribuidora de Alimentos LTDA",
      entityId: "e-acme",
      paymentDate: brt(2026, 6, 12),
    }),
    tx({
      id: "c5",
      amount: 12,
      description: "NF 8805",
      supplierOrClient: "ACME Distribuidora de Alimentos LTDA",
      entityId: "e-acme",
      paymentDate: brt(2026, 6, 12),
    }),
  ];

  const text = `Comprovante de pagamento
    Data do pagamento: 12/06/2026
    Valor do pagamento: R$ 4.250,00
    Beneficiário: ACME DISTRIBUIDORA DE ALIMENTOS LTDA
    CNPJ: 11.444.777/0001-61`;

  const out = matchComprovante(text, transactions, { entities });
  const ids = [...(out.best?.transactionIds ?? [])].sort().join(",");
  check("agrupa c1+c2+c3", ids === "c1,c2,c3", {
    ids,
    score: out.best?.score,
    reasons: out.best?.reasons,
  });
  check("marca como consolidado", out.best?.isConsolidated === true);
}

console.log("\n=== 6. Boleto: linha digitável casa com o barcode gravado ===");
{
  // Linha digitável derivada do código de barras pelo mapeamento oficial
  // (os DVs de campo são irrelevantes para a normalização, ficam em 0).
  const barcode = "34198983400000123451092000123456789012345678";
  const linha =
    barcode.slice(0, 4) +
    barcode.slice(19, 24) +
    "0" + // campo 1
    barcode.slice(24, 34) +
    "0" + // campo 2
    barcode.slice(34, 44) +
    "0" + // campo 3
    barcode[4] + // campo 4 (DV geral)
    barcode.slice(5, 19); // campo 5
  if (linha.length !== 47) throw new Error(`linha inválida: ${linha.length}`);
  const transactions = [
    tx({
      id: "b1",
      amount: 1234.5,
      description: "Fatura energia",
      supplierOrClient: "Companhia de Energia",
      barcode,
      paymentDate: brt(2026, 5, 20),
    }),
    tx({
      id: "b2",
      amount: 4321,
      description: "Outra conta",
      supplierOrClient: "Outro Fornecedor",
      paymentDate: brt(2026, 6, 12),
    }),
  ];
  const out = matchComprovante(
    `Pagamento de boleto\nLinha digitável: ${linha}\nValor: R$ 1.234,50`,
    transactions,
  );
  check("boleto vence", out.best?.transactionId === "b1", {
    best: out.best?.transactionId,
    score: out.best?.score,
    reasons: out.best?.reasons,
  });
  check(
    "score de identidade forte",
    (out.best?.score ?? 0) >= 90,
    out.best?.score,
  );
}

console.log("\n=== 7. Transação já conciliada é despriorizada ===");
{
  const transactions = [
    tx({
      id: "d1",
      amount: 800,
      description: "Aluguel",
      supplierOrClient: "Imobiliaria Central",
      paymentDate: brt(2026, 6, 10),
      comprovanteId: "outro-comprovante",
    }),
    tx({
      id: "d2",
      amount: 800,
      description: "Aluguel",
      supplierOrClient: "Imobiliaria Central",
      paymentDate: brt(2026, 6, 10),
    }),
  ];
  const out = matchComprovante(
    "Comprovante\nData do pagamento: 10/06/2026\nValor do pagamento: R$ 800,00\nBeneficiário: IMOBILIARIA CENTRAL",
    transactions,
  );
  check(
    "escolhe a que ainda não tem comprovante",
    out.best?.transactionId === "d2",
    out.candidates.map((c) => [c.transactionId, c.score]),
  );
}

console.log("\n=== 8. Valor com juros/multa ===");
{
  const transactions = [
    tx({
      id: "j1",
      amount: 1000,
      interest: 37.5,
      finalAmount: 1037.5,
      description: "Fornecimento",
      supplierOrClient: "Fornecedor Atrasado",
      paymentDate: brt(2026, 6, 15),
    }),
  ];
  const out = matchComprovante(
    "Comprovante\nData do pagamento: 15/06/2026\nValor do pagamento: R$ 1.037,50\nBeneficiário: FORNECEDOR ATRASADO",
    transactions,
  );
  check(
    "casa pelo finalAmount",
    out.best?.transactionId === "j1" && (out.best?.score ?? 0) >= 82,
    { score: out.best?.score, reasons: out.best?.reasons },
  );
}

console.log("\n=== 9. Texto ilegível não gera sugestão ===");
{
  const out = matchComprovante("   ", [tx({ id: "x", amount: 10 })]);
  check("sem candidatos", out.best === null);
}

console.log("\n=== 10. Nome truncado / erro de OCR ===");
{
  const transactions = [
    tx({
      id: "n1",
      amount: 2300,
      description: "Manutencao predial",
      supplierOrClient: "Bortolotto Engenharia e Servicos LTDA",
      paymentDate: brt(2026, 6, 9),
    }),
    tx({
      id: "n2",
      amount: 2300,
      description: "Manutencao predial",
      supplierOrClient: "Silva Engenharia e Servicos LTDA",
      paymentDate: brt(2026, 6, 9),
    }),
  ];
  // OCR truncou o nome e trocou uma letra.
  const out = matchComprovante(
    "Comprovante TED\nData do pagamento: 09/06/2026\nValor do pagamento: R$ 2.300,00\nFavorecido: BORTOLOTT0 ENGENHARIA",
    transactions,
  );
  check(
    "acerta apesar do OCR",
    out.best?.transactionId === "n1",
    out.candidates.map((c) => [c.transactionId, c.score, c.signals.entity]),
  );
}

console.log("\n=== 11. Desempenho ===");
{
  const many: Transaction[] = [];
  for (let i = 0; i < 3000; i++) {
    many.push(
      tx({
        id: `p${i}`,
        amount: 100 + (i % 900),
        description: `Servico ${i} nota ${10000 + i}`,
        supplierOrClient: `Fornecedor ${i % 120} Comercio LTDA`,
        entityId: i % 2 === 0 ? "e-acme" : "e-beta",
        paymentDate: brt(2026, 6, 1 + (i % 28)),
      }),
    );
  }
  const text = `Comprovante PIX
    Data do pagamento: 10/06/2026
    Valor do pagamento: R$ 543,00
    Beneficiário: FORNECEDOR 42 COMERCIO LTDA
    CNPJ: 11.444.777/0001-61`;
  const start = Date.now();
  const out = matchComprovante(text, many, { entities });
  const elapsed = Date.now() - start;
  console.log(
    `  3000 transações em ${elapsed}ms — topo: ${out.best?.transactionId} (${out.best?.score})`,
  );
  check("abaixo de 3s", elapsed < 3000, elapsed);
}

console.log("\n=== 12. Tarifa não sequestra o match ===");
{
  // A tarifa (R$ 1,90) coincide com o valor de outra transação.
  const transactions = [
    tx({
      id: "t-real",
      amount: 3200,
      description: "Compra mensal",
      supplierOrClient: "Fornecedor Alfa",
      paymentDate: brt(2026, 6, 10),
    }),
    tx({
      id: "t-tarifa",
      amount: 1.9,
      description: "Reembolso",
      supplierOrClient: "Fornecedor Alfa",
      paymentDate: brt(2026, 6, 10),
    }),
  ];
  const text = `Comprovante
    Data do pagamento: 10/06/2026
    Valor do pagamento: R$ 3.200,00
    Tarifa: R$ 1,90
    Favorecido: FORNECEDOR ALFA`;
  const out = matchComprovante(text, transactions);
  check(
    "valor rotulado vence",
    out.best?.transactionId === "t-real",
    out.candidates.map((c) => [c.transactionId, c.score]),
  );
  check(
    "a tarifa fica bem abaixo",
    (out.candidates.find((c) => c.transactionId === "t-tarifa")?.score ?? 0) <
      (out.best?.score ?? 0) - 15,
    out.candidates.map((c) => [c.transactionId, c.score]),
  );
}

console.log("=== 13. Valor sem centavos ===");
{
  const transactions = [
    tx({
      id: "v1",
      amount: 1500,
      description: "Servico",
      supplierOrClient: "Fornecedor Beta",
      paymentDate: brt(2026, 6, 10),
    }),
  ];
  const out = matchComprovante(
    "Comprovante\nData do pagamento: 10/06/2026\nValor do pagamento: R$ 1.500\nFavorecido: FORNECEDOR BETA",
    transactions,
  );
  check("R$ 1.500 lido como 1500", out.best?.matchedAmount === 1500, {
    matched: out.best?.matchedAmount,
    score: out.best?.score,
  });
}

console.log("=== 14. Sem valor compatível não vira sugestão forte ===");
{
  const transactions = [
    tx({
      id: "s1",
      amount: 77.77,
      description: "Servico",
      supplierOrClient: "Fornecedor Gama",
      paymentDate: brt(2026, 6, 10),
    }),
  ];
  const out = matchComprovante(
    "Comprovante\nData do pagamento: 10/06/2026\nValor do pagamento: R$ 9.999,99\nFavorecido: FORNECEDOR GAMA",
    transactions,
  );
  check(
    "nunca chega a HIGH",
    out.best === null || out.best.confidenceLevel !== "HIGH",
    { score: out.best?.score, level: out.best?.confidenceLevel },
  );
  check("teto de 45 respeitado", (out.best?.score ?? 0) <= 45, out.best?.score);
}

console.log("=== 15. Consolidação sem CNPJ ainda funciona (por nome) ===");
{
  const transactions = [
    tx({
      id: "k1",
      amount: 300,
      description: "Parcela 1",
      supplierOrClient: "Papelaria Central LTDA",
      paymentDate: brt(2026, 6, 10),
    }),
    tx({
      id: "k2",
      amount: 700,
      description: "Parcela 2",
      supplierOrClient: "Papelaria Central LTDA",
      paymentDate: brt(2026, 6, 10),
    }),
  ];
  const out = matchComprovante(
    "Comprovante\nData do pagamento: 10/06/2026\nValor do pagamento: R$ 1.000,00\nFavorecido: PAPELARIA CENTRAL LTDA",
    transactions,
  );
  check(
    "soma as duas",
    [...(out.best?.transactionIds ?? [])].sort().join(",") === "k1,k2",
    { ids: out.best?.transactionIds, score: out.best?.score },
  );
}

console.log(`\n${passed} passaram, ${failed} falharam\n`);
process.exit(failed > 0 ? 1 : 0);
