import { Transaction } from "@/lib/types";
import { ComprovanteConfidenceLevel } from "@/lib/types";

export interface MatchScore {
  transactionId: string;
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

function amountsMatch(a: number, b: number, tol = 0.02): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tol;
}

function datesMatch(a: Date, b: Date, toleranceDays = 3): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= toleranceDays * 86_400_000;
}

// ── Main scoring function ──────────────────────────────────────────────────────

/**
 * Scores each transaction against the text extracted from a comprovante.
 *
 * Scoring breakdown (max 100):
 *   - Amount match (±2 %): 40 pts
 *   - Date match (±3 days): 30 pts
 *   - Entity name in text: up to 20 pts
 *   - Description keywords: up to 10 pts
 *
 * Confidence levels:
 *   HIGH   ≥ 80
 *   MEDIUM 50–79
 *   LOW    20–49
 */
export function matchTransactions(
  extractedText: string,
  transactions: Transaction[],
): MatchScore[] {
  const textAmounts = extractAmounts(extractedText);
  const textDates = extractDates(extractedText);
  const normText = normalizeText(extractedText);

  const scores: MatchScore[] = [];

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
    const foundDate = textDates.find((d) => datesMatch(d, txDate));
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

    // Only include candidates with at least a minimal signal
    if (score >= 20) {
      scores.push({
        transactionId: tx.id,
        score,
        confidenceLevel: score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
        matchedAmount,
        matchedDate,
        matchedEntity,
        reasons,
      });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}
