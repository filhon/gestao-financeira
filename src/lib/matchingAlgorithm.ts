/**
 * Ponto de entrada legado do matching de comprovantes.
 *
 * A implementação vive em `src/lib/matching/` — veja o cabeçalho de
 * `src/lib/matching/index.ts` para o modelo de pontuação. Este arquivo
 * preserva a assinatura antiga (`matchTransactions`) para quem já a importa.
 */

import type { Transaction } from "@/lib/types";
import { matchComprovante } from "@/lib/matching";
import type { MatchOptions, MatchScore } from "@/lib/matching";

export type { MatchOptions, MatchScore, MatchOutcome } from "@/lib/matching";
export {
  matchComprovante,
  parseReceipt,
  scoreCandidates,
} from "@/lib/matching";

/**
 * Pontua transações contra o texto de um comprovante, da mais provável para a
 * menos provável.
 *
 * Prefira `matchComprovante`, que devolve também as alternativas e o sinal de
 * ambiguidade — necessários para uma revisão manual que não seja adivinhação.
 */
export function matchTransactions(
  extractedText: string,
  transactions: Transaction[],
  options: MatchOptions = {},
): MatchScore[] {
  return matchComprovante(extractedText, transactions, options).candidates;
}
