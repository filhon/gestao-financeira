import type { MatchScore } from "./score";

/** Identidade determinística: não depende de comparar nomes. */
const STRONG_IDENTITY: Record<string, string> = {
  barcode: "Código de barras e valor conferem",
  document: "CNPJ/CPF do beneficiário e valor conferem",
  pix_key: "Chave Pix cadastrada e valor conferem",
};

/**
 * Regra estrita de confirmação sem revisão humana.
 *
 * Exige confiança Alta, nenhum empate, valor exato (±R$ 0,01), nenhum conflito
 * e identidade forte do beneficiário. Fornecedor marcado como de confiança
 * dispensa a identidade forte, mas não o resto. Devolve o motivo, que vai para
 * a auditoria, ou null quando o comprovante precisa de um humano.
 */
export function autoConfirmReason(
  best: Pick<
    MatchScore,
    "confidenceLevel" | "isAmbiguous" | "matchedAmount" | "signals"
  >,
  opts: { trustedSupplier?: boolean; possibleDuplicate?: boolean } = {},
): string | null {
  if (best.confidenceLevel !== "HIGH" || best.isAmbiguous) return null;
  if (opts.possibleDuplicate) return null;

  const { amountDelta, entityEvidence, penalties } = best.signals;
  if (best.matchedAmount == null || amountDelta == null) return null;
  if (amountDelta > 0.011) return null;
  if (penalties.length > 0) return null;

  if (STRONG_IDENTITY[entityEvidence]) return STRONG_IDENTITY[entityEvidence];
  if (opts.trustedSupplier && entityEvidence !== "none") {
    return "Fornecedor de confiança e valor conferem";
  }
  return null;
}
