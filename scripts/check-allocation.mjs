// node scripts/check-allocation.mjs  (Node 22.18+ importa .ts direto)
import assert from "node:assert/strict";
import { amountsFromPercent, evenPercentages } from "../src/lib/allocation.ts";

const row = (percentage) => ({ costCenterId: "x", percentage, amount: 0 });
const amounts = (rows) => rows.map((r) => r.amount);
const sum = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

// 50/50 de R$ 100,01: o centavo vai para a última linha com %.
assert.deepEqual(
  amounts(amountsFromPercent([row(50), row(50)], 100.01)),
  [50.01, 50],
);

// Linha nova a 0% não absorve o arredondamento nem fica negativa.
const withZero = amounts(
  amountsFromPercent([row(50), row(50), row(0)], 100.01),
);
assert.equal(withZero[2], 0);
assert.equal(sum(withZero), 100.01);

// Terços fecham o total.
const thirds = evenPercentages(3);
assert.deepEqual(thirds, [33.33, 33.33, 33.34]);
assert.equal(sum(amounts(amountsFromPercent(thirds.map(row), 1000))), 1000);

// Soma diferente de 100%: nada é empurrado, o resto aparece como "Faltam".
assert.deepEqual(amounts(amountsFromPercent([row(60)], 200)), [120]);

console.log("allocation ok");
