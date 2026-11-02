/**
 * Verificação das checagens de nota enviada pelo funcionário.
 *   npm run check:receipt-checks
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  isValidAccessKey,
  normalizeAccessKey,
  accessKeyParts,
  receiptFlags,
  type DuplicateCandidate,
} from "../src/lib/reimbursement/receiptChecks";

// Chave montada aqui: UF 35, 2609, CNPJ 11222333000181, modelo 65, série 001,
// nº 000004321, emissão 1, código 12345678 + DV calculado à mão.
const body = "3526091122233300018165001000004321112345678";
const withDv = (dv: number) => body + dv;
const valid = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  .map(withDv)
  .filter(isValidAccessKey);
assert.equal(valid.length, 1, "exatamente um DV fecha a chave");
const key = valid[0];

assert.ok(!isValidAccessKey(key.slice(0, 43)), "43 dígitos não é chave");
assert.ok(
  !isValidAccessKey(
    key.slice(0, 10) + ((Number(key[10]) + 1) % 10) + key.slice(11),
  ),
  "um dígito trocado quebra o DV",
);
assert.equal(
  normalizeAccessKey(key.replace(/(\d{4})/g, "$1 ")),
  key,
  "chave impressa em grupos de 4 é aceita",
);
assert.equal(normalizeAccessKey("123"), null);
assert.deepEqual(accessKeyParts(key), {
  cnpj: "11222333000181",
  model: "NFC-e",
  number: "4321",
});

const today = new Date(2026, 10, 2);
const d = (day: number, month = 10) => new Date(2026, month, day);
const facts = {
  amount: 58.9,
  date: d(1),
  supplierDocument: "11222333000181",
  accessKey: null,
  confidence: 90,
};
const cand = (extra: Partial<DuplicateCandidate>): DuplicateCandidate => ({
  kind: "submission",
  id: "s1",
  label: "enviada em 01/11",
  amount: 58.9,
  date: d(1),
  ...extra,
});

assert.deepEqual(
  receiptFlags(facts, [], today),
  [],
  "nota limpa não tem alerta",
);

const codes = (f: ReturnType<typeof receiptFlags>) => f.map((x) => x.code);
assert.deepEqual(codes(receiptFlags(facts, [cand({})], today)), ["duplicate"]);
assert.deepEqual(
  codes(
    receiptFlags(facts, [cand({ supplierDocument: "99999999000199" })], today),
  ),
  [],
  "mesmo valor e dia, CNPJ diferente: não é duplicata",
);
assert.deepEqual(
  codes(receiptFlags(facts, [cand({ amount: 58.91 })], today)),
  [],
  "um centavo de diferença: não é duplicata",
);
assert.deepEqual(
  codes(
    receiptFlags(
      { ...facts, accessKey: key, amount: 1 },
      [cand({ accessKey: key, amount: 999 })],
      today,
    ),
  ),
  ["duplicate"],
  "mesma chave vence valor diferente",
);
assert.deepEqual(
  codes(
    receiptFlags(
      { ...facts, accessKey: key },
      [cand({ accessKey: "1".repeat(44) })],
      today,
    ),
  ),
  [],
  "chaves diferentes: não é duplicata, mesmo com valor e dia iguais",
);

const old = receiptFlags({ ...facts, date: d(1, 7) }, [], today);
assert.deepEqual(old, [{ code: "old", days: 93 }]);

assert.deepEqual(receiptFlags({ ...facts, amount: null }, [], today), [
  { code: "unreadable", missing: ["valor"] },
]);
assert.deepEqual(codes(receiptFlags({ ...facts, confidence: 40 }, [], today)), [
  "unreadable",
]);
assert.deepEqual(
  codes(receiptFlags({ ...facts, confidence: 40, edited: true }, [], today)),
  [],
  "corrigida pelo funcionário: confiança baixa não alerta",
);

console.log("check:receipt-checks ok");
