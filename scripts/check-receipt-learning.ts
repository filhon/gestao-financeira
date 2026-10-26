/**
 * Verificação da calibragem: aliases aprendidos e beneficiário informado.
 *   npm run check:receipt-learning
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  learnableAliases,
  matchComprovante,
  parseReceipt,
} from "../src/lib/matching";
import type { Entity, Transaction } from "../src/lib/types";

const entity = (
  id: string,
  name: string,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  companyId: "c1",
  name,
  type: "company",
  category: "supplier",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

const tx = (
  id: string,
  entityId: string,
  supplier: string,
  amount: number,
): Transaction =>
  ({
    id,
    companyId: "c1",
    description: `Contribuição ${supplier}`,
    amount,
    type: "payable",
    status: "paid",
    entityId,
    supplierOrClient: supplier,
    paymentDate: new Date("2026-05-29T12:00:00-03:00"),
    dueDate: new Date("2026-05-29T12:00:00-03:00"),
    createdBy: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Transaction;

// Banco imprime a razão social da conta, não o nome do cadastro.
const receipt = `Comprovante de transferência PIX
Data do pagamento: 29/05/2026
Valor: R$ 3.900,00
Dados do recebedor
Nome: CONVENCAO BATISTA REGIONAL
CNPJ: 11.222.333/0001-81`;

const igreja = entity("e1", "Igreja Evangélica Batista da Graça");
const outra = entity("e2", "Ministério Alcance Brasil");
const txs = [
  tx("t1", "e1", igreja.name, 3900),
  tx("t2", "e2", outra.name, 3900),
];

// 1. Sem calibragem: dois títulos de R$ 3.900, nada identifica o beneficiário.
const before = matchComprovante(receipt, txs, { entities: [igreja, outra] });
assert.notEqual(
  before.best?.confidenceLevel,
  "HIGH",
  "não pode chutar entre os dois",
);

// 2. Beneficiário informado: restringe ao título dele e sobe a confiança.
const informed = matchComprovante(receipt, [txs[0]], {
  entities: [igreja, outra],
  confirmedEntityId: "e1",
});
assert.equal(informed.best?.transactionId, "t1");
assert.equal(informed.best?.confidenceLevel, "HIGH");
assert.equal(informed.best?.signals.entityEvidence, "confirmed");

// 3. O que se aprende: o CNPJ do recebedor e a grafia do banco.
const learned = learnableAliases(parseReceipt(receipt), igreja, [
  igreja,
  outra,
]);
assert.deepEqual(learned.documents, ["11222333000181"]);
assert.ok(learned.names.length > 0, "aprende a grafia do recebedor");

// 4. Próximo comprovante igual já chega identificado, sem ajuda.
const taught = {
  ...igreja,
  receiptAliases: { documents: learned.documents, names: learned.names },
};
const after = matchComprovante(receipt, txs, { entities: [taught, outra] });
assert.equal(after.best?.transactionId, "t1");
assert.equal(after.best?.confidenceLevel, "HIGH");
assert.equal(after.best?.signals.entityEvidence, "document");

// 5. Nunca aprende o que já identifica outra entidade.
const owner = entity("e3", "Convenção", { document: "11.222.333/0001-81" });
const blocked = learnableAliases(parseReceipt(receipt), igreja, [
  igreja,
  owner,
]);
assert.deepEqual(blocked.documents, []);

// 6. Valor corrigido substitui a leitura.
const corrected = matchComprovante(
  receipt.replace("3.900,00", "390,00"),
  [txs[0]],
  {
    entities: [igreja],
    overrides: { amount: 3900 },
  },
);
assert.equal(corrected.best?.matchedAmount, 3900);

console.log("receipt-learning: ok");
