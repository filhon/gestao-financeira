// Checagem do diff de auditoria: `npx tsx scripts/check-audit-diff.ts`
import assert from "node:assert/strict";
import { Timestamp } from "firebase/firestore";
import {
  generateChanges,
  detailRows,
  getValueLabel,
} from "../src/lib/auditFormatter";

const due = new Date(2026, 9, 26, 12);
const old = {
  amount: 5914.52,
  dueDate: Timestamp.fromDate(due),
  requestOrigin: { type: "department", name: "RH" },
  costCenterAllocation: [
    { costCenterId: "cc1", percentage: 100, amount: 5914.52 },
  ],
  notes: "",
};
const form = {
  amount: 5898.19,
  dueDate: new Date(2026, 9, 26), // mesmo dia, outra hora: não é mudança
  requestOrigin: { name: "RH", type: "department" }, // chaves em outra ordem
  costCenterAllocation: [
    { amount: 5914.52, percentage: 100, costCenterId: "cc1" },
  ],
  notes: undefined,
  accountId: "acc1",
};
const changes = generateChanges(old, form);
assert.deepEqual(
  changes.map((c) => c.field),
  ["amount", "accountId"],
);

// Log antigo com mudanças fantasmas: somem na leitura
const names = new Map([
  ["acc1", "3.1.01 Salários"],
  ["cc1", "01 Administrativo"],
]);
const rows = detailRows(
  {
    changes: [
      {
        field: "dueDate",
        oldValue: Timestamp.fromDate(due),
        newValue: Timestamp.fromDate(new Date(2026, 9, 26)),
      },
      { field: "accountId", oldValue: null, newValue: "acc1" },
      { field: "amount", oldValue: 5914.52, newValue: 5898.19 },
    ],
  },
  names,
);
assert.deepEqual(
  rows.map((r) => [
    r.label,
    r.before?.replace(/ /g, " "),
    r.after.replace(/ /g, " "),
    r.direction,
  ]),
  [
    ["Conta Contábil", "(vazio)", "3.1.01 Salários", undefined],
    ["Valor", "R$ 5.914,52", "R$ 5.898,19", "down"],
  ],
);
assert.equal(
  getValueLabel("costCenterAllocation", form.costCenterAllocation, names),
  "01 Administrativo (100%)",
);
assert.equal(getValueLabel("dueDate", Timestamp.fromDate(due)), "26/10/2026");
assert.equal(
  getValueLabel("dueDate", { seconds: due.getTime() / 1000, nanoseconds: 0 }),
  "26/10/2026",
);
assert.equal(getValueLabel("notes", ""), "(vazio)");
console.log("audit diff ok");
