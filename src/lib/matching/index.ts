/**
 * Motor de matching comprovante ↔ transação.
 *
 * Pipeline:
 *
 *   texto extraído (OCR / camada de texto do PDF)
 *        │
 *        ├─ parseReceipt ──► fatos estruturados
 *        │                   valores e datas com rótulo e peso, CPF/CNPJ com DV
 *        │                   validado e papel (beneficiário × pagador), chaves
 *        │                   Pix, linha digitável, agência/conta, nomes
 *        │
 *        └─ scoreCandidates ► candidatos pontuados
 *                            evidência ponderada + penalidade por conflito +
 *                            consolidação por subset-sum + detecção de empate
 *
 * Modelo de pontuação (0-100):
 *
 *   Valor        40   tolerância graduada; pondera pelo rótulo do valor no
 *                     documento ("Valor do pagamento" ≫ "Tarifa")
 *   Contraparte  28   CNPJ/CPF, chave Pix, agência+conta, nome (fuzzy + IDF)
 *   Data         20   distância em dias civis (fuso de Brasília)
 *   Descrição    12   cobertura de termos ponderada por IDF, nº de documento
 *
 *   Pisos por evidência determinística: linha digitável do boleto (97),
 *   documento/chave Pix + valor exato (94), valor + data exatos com
 *   contraparte compatível (90).
 *
 *   Penalidades multiplicativas: CNPJ do beneficiário divergente (×0.30),
 *   transação já conciliada com outro comprovante (×0.35), soma consolidada
 *   ambígua (×0.72), método de pagamento incompatível (×0.96).
 *
 * Níveis: HIGH ≥ 82 (e sem empate) · MEDIUM ≥ 55 · LOW ≥ 25.
 */

import type { Transaction } from "@/lib/types";
import { parseReceipt, type ReceiptFacts } from "./receipt";
import { scoreCandidates, type MatchOptions, type MatchOutcome } from "./score";

export { parseReceipt, primaryAmount, primaryDate } from "./receipt";
export type {
  ExtractedAmount,
  ExtractedDate,
  ExtractedDocument,
  FactRole,
  PaymentMethodHint,
  ReceiptFacts,
} from "./receipt";
export { scoreCandidates } from "./score";
export { autoConfirmReason } from "./autoConfirm";
export {
  entityIdentifiers,
  hasAliases,
  learnableAliases,
  type ReceiptAliases,
} from "./learn";

/** Campos que o usuário corrigiu: substituem a leitura automática. */
export interface FactOverrides {
  amount?: number;
  date?: Date;
}

export function applyOverrides(
  facts: ReceiptFacts,
  overrides?: FactOverrides,
): ReceiptFacts {
  if (!overrides) return facts;
  const label = "informado pelo usuário";
  return {
    ...facts,
    amounts:
      overrides.amount != null
        ? [{ value: overrides.amount, weight: 1, label, index: 0 }]
        : facts.amounts,
    dates: overrides.date
      ? [{ date: overrides.date, weight: 1, label, index: 0 }]
      : facts.dates,
    isEmpty: facts.isEmpty && overrides.amount == null && !overrides.date,
  };
}
export type {
  EntityEvidence,
  MatchOptions,
  MatchOutcome,
  MatchScore,
  MatchSignals,
} from "./score";

/**
 * Lê um comprovante e o confronta com as transações candidatas.
 *
 * Devolve o melhor candidato, as alternativas plausíveis (para a revisão
 * manual não precisar buscar na lista inteira) e se a decisão está ambígua.
 */
export function matchComprovante(
  extractedText: string,
  transactions: Transaction[],
  options: MatchOptions & { overrides?: FactOverrides } = {},
): MatchOutcome {
  let facts = applyOverrides(parseReceipt(extractedText), options.overrides);
  // Beneficiário afirmado pelo usuário já é fato, mesmo com texto ilegível.
  if (options.confirmedEntityId) facts = { ...facts, isEmpty: false };
  return scoreCandidates(facts, transactions, options);
}
