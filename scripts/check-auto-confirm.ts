/**
 * Verificação da regra de confirmação automática de comprovantes.
 *   npm run check:auto-confirm
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import { autoConfirmReason } from "../src/lib/matching/autoConfirm";
import type { MatchScore } from "../src/lib/matching";

type Input = Parameters<typeof autoConfirmReason>[0];

const base = (
  over: Partial<Input> = {},
  signals: Partial<MatchScore["signals"]> = {},
): Input => ({
  confidenceLevel: "HIGH",
  isAmbiguous: false,
  matchedAmount: 1200,
  ...over,
  signals: {
    amount: 1,
    date: 1,
    entity: 1,
    description: 0,
    amountDelta: 0,
    entityEvidence: "document",
    penalties: [],
    ...signals,
  },
});

// Caminho feliz: CNPJ + valor exato.
assert.match(autoConfirmReason(base()) ?? "", /CNPJ/);
assert.match(
  autoConfirmReason(base({}, { entityEvidence: "barcode" })) ?? "",
  /barras/,
);
assert.match(
  autoConfirmReason(base({}, { entityEvidence: "pix_key" })) ?? "",
  /Pix/,
);

// Qualquer um destes manda para a fila.
assert.equal(autoConfirmReason(base({ confidenceLevel: "MEDIUM" })), null);
assert.equal(autoConfirmReason(base({ isAmbiguous: true })), null);
assert.equal(autoConfirmReason(base({ matchedAmount: undefined })), null);
assert.equal(autoConfirmReason(base({}, { amountDelta: 0.02 })), null);
assert.equal(autoConfirmReason(base({}, { amountDelta: undefined })), null);
assert.equal(
  autoConfirmReason(base({}, { penalties: ["metodo_divergente"] })),
  null,
);
assert.equal(autoConfirmReason(base(), { possibleDuplicate: true }), null);

// Centavo de arredondamento passa.
assert.notEqual(autoConfirmReason(base({}, { amountDelta: 0.01 })), null);

// Só nome: precisa do fornecedor de confiança, e ele não dispensa o resto.
assert.equal(autoConfirmReason(base({}, { entityEvidence: "name" })), null);
assert.match(
  autoConfirmReason(base({}, { entityEvidence: "name" }), {
    trustedSupplier: true,
  }) ?? "",
  /confiança/,
);
assert.equal(
  autoConfirmReason(base({}, { entityEvidence: "none" }), {
    trustedSupplier: true,
  }),
  null,
);
assert.equal(
  autoConfirmReason(base({}, { entityEvidence: "name", amountDelta: 5 }), {
    trustedSupplier: true,
  }),
  null,
);

console.log("auto-confirm: ok");
