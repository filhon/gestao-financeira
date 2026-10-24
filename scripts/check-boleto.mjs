// node scripts/check-boleto.mjs  (Node 22.18+ importa .ts direto)
import assert from "node:assert/strict";
import { parseBoleto, formatBoletoLine } from "../src/lib/boleto.ts";

const mod10 = (s) => {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    const p = Number(s[i]) * w;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    w = w === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
};
const mod11 = (s) => {
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
};

// Boleto bancário: banco 001, fator 1626 (10/11/2026 no ciclo de 2025), R$ 1.234,56.
const free = "1234567890123456789012345";
const body = "0019" + "1626" + "0000123456" + free;
const dv = mod11(body);
const barcode = body.slice(0, 4) + dv + body.slice(4);
const f1 = barcode.slice(0, 4) + free.slice(0, 5);
const f2 = free.slice(5, 15);
const f3 = free.slice(15, 25);
const line =
  f1 + mod10(f1) + f2 + mod10(f2) + f3 + mod10(f3) + dv + "1626" + "0000123456";

const today = new Date(2026, 9, 24);
for (const input of [line, barcode, formatBoletoLine(line)]) {
  const p = parseBoleto(input, today);
  assert.equal(p.valid, true, input);
  assert.equal(p.kind, "bank");
  assert.equal(p.bankCode, "001");
  assert.equal(p.amount, 1234.56);
  assert.equal(p.dueDate.getFullYear(), 2026);
  assert.equal(p.dueDate.getMonth(), 10);
  assert.equal(p.dueDate.getDate(), 10);
}

// Um dígito trocado precisa invalidar.
const tampered =
  line.slice(0, 40) + ((Number(line[40]) + 1) % 10) + line.slice(41);
assert.equal(parseBoleto(tampered, today).valid, false);
assert.equal(parseBoleto("123", today).valid, false);

// Arrecadação, identificador 6 (mod 10), R$ 87,90.
const c = "826?" + "00000008790" + "00012026110012345678901234567";
const cBody = c.replace("?", "");
const cBarcode = c.replace("?", String(mod10(cBody)));
const cLine = [0, 11, 22, 33]
  .map((i) => cBarcode.slice(i, i + 11))
  .map((b) => b + mod10(b))
  .join("");
const cp = parseBoleto(cLine, today);
assert.equal(cp.valid, true);
assert.equal(cp.kind, "collection");
assert.equal(cp.amount, 87.9);
assert.equal(cp.dueDate, undefined);

console.log("boleto ok");
