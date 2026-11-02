/**
 * Decisões sobre a fila inteira de sugestões, não sobre uma de cada vez.
 * Puro e sem I/O. Verificação: `npm run check:matching-queue`.
 */

export type Suggested = { id: string; ids: string[]; score: number };

/**
 * Cada título fica com uma sugestão só. Comprovantes são casados um a um, e
 * dez de R$ 1.000 do mesmo favorecido apontavam todos para a mesma conta. A
 * sugestão mais forte fica com o título; a que perdeu é casada de novo
 * (`rematch`) só com o que sobrou. `taken` entra com os títulos que já têm
 * comprovante confirmado.
 *
 * Devolve só o que mudou: a nova sugestão, ou `null` quando não sobrou opção
 * (a disputa fica para a pessoa).
 */
export function distributeSuggestions<T extends Suggested>(
  queue: T[],
  taken: Set<string>,
  rematch: (item: T, taken: Set<string>) => { ids: string[] } | null,
): Map<string, { ids: string[] } | null> {
  const used = new Set(taken);
  const changed = new Map<string, { ids: string[] } | null>();
  for (const item of [...queue].sort((a, b) => b.score - a.score)) {
    if (item.ids.length === 0) continue;
    if (!item.ids.some((id) => used.has(id))) {
      item.ids.forEach((id) => used.add(id));
      continue;
    }
    const next = rematch(item, used);
    changed.set(item.id, next);
    next?.ids.forEach((id) => used.add(id));
  }
  return changed;
}

// ── Acerto das sugestões ──────────────────────────────────────────────────────

/**
 * O que a pessoa fez com uma sugestão: aceitou como veio, trocou por outro
 * título, recusou, ou aceitou e desfez depois.
 */
export type FeedbackOutcome = "accepted" | "changed" | "rejected" | "undone";
export type Feedback = { score: number; outcome: FeedbackOutcome };

export type AccuracyRow = {
  /** Faixa [min, max] da pontuação. */
  min: number;
  max: number;
  total: number;
  accepted: number;
  changed: number;
  rejected: number;
  undone: number;
  /** Aceitas e não desfeitas, sobre o total. */
  rate: number;
};

/**
 * Taxa de acerto por faixa de pontuação. É a régua para calibrar os pesos:
 * se a faixa "forte" acerta menos que a média, o peso está errado.
 * `cuts` em ordem decrescente, ex.: [90, 70, 0].
 */
export function accuracyByBand(
  items: Feedback[],
  cuts: number[],
): AccuracyRow[] {
  return cuts.map((min, i) => {
    const max = i === 0 ? 100 : cuts[i - 1] - 1;
    const band = items.filter((f) => f.score >= min && f.score <= max);
    const count = (o: FeedbackOutcome) =>
      band.filter((f) => f.outcome === o).length;
    const accepted = count("accepted");
    return {
      min,
      max,
      total: band.length,
      accepted,
      changed: count("changed"),
      rejected: count("rejected"),
      undone: count("undone"),
      rate: band.length ? accepted / band.length : 0,
    };
  });
}

export const sameIds = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * O que a pessoa fez com a sugestão de um comprovante. A confirmação
 * automática não conta: ninguém julgou.
 */
export function receiptFeedback(c: {
  matchStatus?: string;
  reviewedBy?: string | null;
  matchConfidence?: number | null;
  suggestedTransactionIds?: string[] | null;
  transactionIds?: string[] | null;
}): Feedback | null {
  if (c.matchConfidence == null) return null;
  const score = c.matchConfidence;
  if (c.matchStatus === "rejected_match") return { score, outcome: "rejected" };
  if (
    c.matchStatus !== "matched" ||
    c.reviewedBy === "auto" ||
    !c.suggestedTransactionIds?.length
  )
    return null;
  return {
    score,
    outcome: sameIds(c.suggestedTransactionIds, c.transactionIds ?? [])
      ? "accepted"
      : "changed",
  };
}
