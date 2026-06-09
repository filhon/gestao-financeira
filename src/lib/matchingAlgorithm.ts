import { Transaction } from "@/lib/types";
import { ComprovanteConfidenceLevel } from "@/lib/types";

export interface MatchScore {
  transactionId: string; // primary transaction ID
  transactionIds: string[]; // all IDs (single-element for regular match, N for consolidated)
  isConsolidated: boolean;
  score: number; // 0-100
  confidenceLevel: ComprovanteConfidenceLevel;
  matchedAmount?: number;
  matchedDate?: Date;
  matchedEntity?: string;
  reasons: string[];
}

// ── Text helpers ───────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Amount extraction (Brazilian format: R$ 1.234,56 or 1.234,56) ─────────────

function extractAmounts(text: string): number[] {
  const results: number[] = [];

  // Pattern 1: R$ 1.234,56  |  R$1234,56
  const p1 = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)/g;
  // Pattern 2: bare 1.234,56
  const p2 = /\b(\d{1,3}(?:\.\d{3})+,\d{2})\b/g;
  // Pattern 3: plain integer / decimal  1234,56
  const p3 = /\b(\d+,\d{2})\b/g;

  const parse = (raw: string) => {
    const n = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    if (!isNaN(n) && n > 0.5 && n < 100_000_000) results.push(n);
  };

  let m;
  for (const re of [p1, p2, p3]) {
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) parse(m[1]);
  }

  return [...new Set(results)];
}

// ── Date extraction (dd/MM/yyyy) ───────────────────────────────────────────────

function extractDates(text: string): Date[] {
  const re = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
  const dates: Date[] = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) dates.push(d);
  }
  return dates;
}

// ── Numeric comparators ────────────────────────────────────────────────────────

function amountsMatch(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) < 0.01; // exact centavo match (no tolerance)
}

function datesMatch(a: Date, b: Date, toleranceDays = 3): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= toleranceDays * 86_400_000;
}

// ── Day key (same calendar day regardless of time) ────────────────────────────

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── Main scoring function ──────────────────────────────────────────────────────

/**
 * Scores each transaction (and consolidated same-entity same-day groups) against
 * the text extracted from a comprovante.
 *
 * Scoring breakdown (max 100):
 *   - Amount match (exact centavo, |diff| < R$0.01): 40 pts
 *   - Date match (±3 days, closest date wins): 30 pts
 *   - Entity name in text: up to 20 pts
 *   - Description keywords: up to 10 pts
 *
 * Confidence levels:
 *   HIGH   ≥ 80
 *   MEDIUM 50–79
 *   LOW    20–49
 *
 * Consolidated matching:
 *   When multiple transactions from the same entity share the same payment date,
 *   their amounts are summed and compared against the comprovante amount. This
 *   handles the common practice of batching same-entity same-day payments into
 *   a single bank transfer to reduce transaction costs.
 */
export function matchTransactions(
  extractedText: string,
  transactions: Transaction[],
): MatchScore[] {
  const textAmounts = extractAmounts(extractedText);
  const textDates = extractDates(extractedText);
  const normText = normalizeText(extractedText);

  const scores: MatchScore[] = [];

  // ── 1. Single-transaction scoring ─────────────────────────────────────────

  for (const tx of transactions) {
    let score = 0;
    const reasons: string[] = [];
    let matchedAmount: number | undefined;
    let matchedDate: Date | undefined;
    let matchedEntity: string | undefined;

    // ── Amount (40 pts) ──────────────────────────────────────────────────────
    const txAmount = tx.finalAmount ?? tx.amount;
    const foundAmt = textAmounts.find((a) => amountsMatch(a, txAmount));
    if (foundAmt !== undefined) {
      score += 40;
      matchedAmount = foundAmt;
      reasons.push(
        `Valor R$ ${txAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} encontrado`,
      );
    }

    // ── Date (30 pts) ────────────────────────────────────────────────────────
    const txDate = tx.paymentDate ?? tx.dueDate;
    // Pick the date closest to the transaction date (not just the first match),
    // so that payment dates win over ancillary dates like issue or due dates.
    const candidateDates = textDates.filter((d) => datesMatch(d, txDate));
    const foundDate =
      candidateDates.length > 0
        ? candidateDates.sort(
            (a, b) =>
              Math.abs(a.getTime() - txDate.getTime()) -
              Math.abs(b.getTime() - txDate.getTime()),
          )[0]
        : undefined;
    if (foundDate) {
      score += 30;
      matchedDate = foundDate;
      reasons.push(`Data ${foundDate.toLocaleDateString("pt-BR")} encontrada`);
    }

    // ── Entity name (up to 20 pts) ───────────────────────────────────────────
    const entity = tx.supplierOrClient;
    if (entity && entity.length > 2) {
      const normEntity = normalizeText(entity);
      const words = normEntity.split(" ").filter((w) => w.length > 3);
      if (words.length > 0) {
        const hits = words.filter((w) => normText.includes(w));
        if (hits.length > 0) {
          const pts = Math.min(
            20,
            Math.round((hits.length / words.length) * 20),
          );
          score += pts;
          matchedEntity = entity;
          reasons.push(`Beneficiário "${entity}" identificado`);
        }
      }
    }

    // ── Description keywords (up to 10 pts) ─────────────────────────────────
    const descWords = normalizeText(tx.description)
      .split(" ")
      .filter((w) => w.length > 4);
    if (descWords.length > 0) {
      const hits = descWords.filter((w) => normText.includes(w));
      if (hits.length > 0) {
        const pts = Math.min(
          10,
          Math.round((hits.length / descWords.length) * 10),
        );
        score += pts;
        reasons.push(
          `Palavras-chave "${hits.slice(0, 2).join(", ")}" identificadas`,
        );
      }
    }

    if (score >= 20) {
      scores.push({
        transactionId: tx.id,
        transactionIds: [tx.id],
        isConsolidated: false,
        score,
        confidenceLevel: score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
        matchedAmount,
        matchedDate,
        matchedEntity,
        reasons,
      });
    }
  }

  // ── 2. Consolidated same-entity same-day group scoring ────────────────────
  //
  // When the user batches multiple same-entity same-day payables into one bank
  // transfer, the comprovante amount equals the SUM of those transactions.
  // We group candidates by (normalised entity prefix + day) and test the sum.

  // Group by (normalised entity name + entityId when available + same day).
  // entityId takes precedence over raw name so two entities with similar names
  // but different entityIds are never merged into the same consolidated group.
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.supplierOrClient) continue;
    const txDate = tx.paymentDate ?? tx.dueDate;
    const entityKey = tx.entityId
      ? `eid:${tx.entityId}`
      : normalizeText(tx.supplierOrClient).substring(0, 40);
    const key = `${entityKey}|${dayKey(txDate)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  for (const [, txGroup] of groups) {
    if (txGroup.length < 2) continue;

    const groupTotal = txGroup.reduce(
      (sum, tx) => sum + (tx.finalAmount ?? tx.amount),
      0,
    );
    const foundAmt = textAmounts.find((a) => amountsMatch(a, groupTotal));
    if (!foundAmt) continue;

    let groupScore = 40; // amount match
    let matchedDate: Date | undefined;
    const reasons: string[] = [
      `Soma consolidada de ${txGroup.length} transações: R$ ${groupTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    ];

    // Date match – use the shared payment date of the group; pick closest date
    const txDate = txGroup[0].paymentDate ?? txGroup[0].dueDate;
    const candidateDates = textDates.filter((d) => datesMatch(d, txDate));
    const foundDate =
      candidateDates.length > 0
        ? candidateDates.sort(
            (a, b) =>
              Math.abs(a.getTime() - txDate.getTime()) -
              Math.abs(b.getTime() - txDate.getTime()),
          )[0]
        : undefined;
    if (foundDate) {
      groupScore += 30;
      matchedDate = foundDate;
      reasons.push(`Data ${foundDate.toLocaleDateString("pt-BR")} encontrada`);
    }

    // Entity name match
    const entity = txGroup[0].supplierOrClient!;
    const normEntity = normalizeText(entity);
    const words = normEntity.split(" ").filter((w) => w.length > 3);
    let matchedEntity: string | undefined;
    if (words.length > 0) {
      const hits = words.filter((w) => normText.includes(w));
      if (hits.length > 0) {
        const pts = Math.min(20, Math.round((hits.length / words.length) * 20));
        groupScore += pts;
        matchedEntity = entity;
        reasons.push(`Beneficiário "${entity}" identificado`);
      }
    }

    if (groupScore >= 20) {
      scores.push({
        transactionId: txGroup[0].id,
        transactionIds: txGroup.map((tx) => tx.id),
        isConsolidated: true,
        score: groupScore,
        confidenceLevel:
          groupScore >= 80 ? "HIGH" : groupScore >= 50 ? "MEDIUM" : "LOW",
        matchedAmount: foundAmt,
        matchedDate,
        matchedEntity,
        reasons,
      });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}
