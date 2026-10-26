import currency from "currency.js";
import { format } from "date-fns";
import { Comprovante, Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export type InsightTone = "ok" | "warn" | "muted";
export interface Insight {
  tone: InsightTone;
  text: string;
}

/** Títulos ligados ao comprovante: a associação confirmada ou a sugestão. */
export function linkedTransactionIds(c: Comprovante): string[] {
  if (c.transactionIds?.length) return c.transactionIds;
  if (c.transactionId) return [c.transactionId];
  if (c.matchStatus !== "pending_review") return [];
  if (c.suggestedTransactionIds?.length) return c.suggestedTransactionIds;
  return c.suggestedTransactionId ? [c.suggestedTransactionId] : [];
}

export function titlesTotal(txs: Transaction[]): number {
  return txs.reduce(
    (sum, t) => currency(sum).add(t.finalAmount ?? t.amount).value,
    0,
  );
}

/** Valor lido menos valor dos títulos; null quando batem (±R$ 0,01). */
export function amountDifference(
  c: Comprovante,
  txs: Transaction[],
): number | null {
  if (c.matchedAmount == null || txs.length === 0) return null;
  const diff = currency(c.matchedAmount).subtract(titlesTotal(txs)).value;
  return Math.abs(diff) > 0.01 ? diff : null;
}

/** Pede a confirmação em lote sem medo: Alta, sem empate, sem divergência. */
export function isSafeToBulkConfirm(c: Comprovante, txs: Transaction[]) {
  return (
    c.matchStatus === "pending_review" &&
    c.matchConfidenceLevel === "HIGH" &&
    !c.matchIsAmbiguous &&
    !c.possibleDuplicateOf &&
    txs.length > 0 &&
    txs.length === linkedTransactionIds(c).length &&
    amountDifference(c, txs) === null
  );
}

const EVIDENCE: Record<string, string> = {
  barcode: "Código de barras",
  document: "CNPJ/CPF",
  document_root: "CNPJ da matriz/filial",
  masked_document: "CPF mascarado",
  pix_key: "Chave Pix",
  bank_account: "Agência e conta",
  name: "Nome do beneficiário",
  initials: "Sigla do beneficiário",
  confirmed: "Beneficiário informado",
};

/**
 * Uma linha que responde "posso confirmar?" sem abrir o comprovante.
 * Divergências vêm primeiro: o caso mais arriscado nunca pode parecer o mais seguro.
 */
export function receiptInsight(c: Comprovante, txs: Transaction[]): Insight {
  switch (c.matchStatus) {
    case "needs_manual":
      return { tone: "warn", text: "Arquivo ilegível: vincule manualmente" };
    case "unmatched":
      return { tone: "muted", text: "Nenhum título compatível" };
    case "rejected_match":
      return { tone: "muted", text: "Sugestão rejeitada" };
    case "matched":
      if (c.autoConfirmed) {
        return {
          tone: "ok",
          text: `Automático: ${c.autoConfirmReason ?? "regra estrita"}`,
        };
      }
      return {
        tone: "ok",
        text: c.reviewedAt
          ? `Confirmado em ${format(c.reviewedAt, "dd/MM/yyyy")}`
          : "Confirmado",
      };
  }

  if (c.possibleDuplicateOf) {
    return { tone: "warn", text: "Possível duplicado" };
  }
  if (c.matchIsAmbiguous) {
    return { tone: "warn", text: "Ambígua: outro título equivalente" };
  }
  const diff = amountDifference(c, txs);
  if (diff !== null) {
    return {
      tone: "warn",
      text: `Valor diverge em ${formatCurrency(Math.abs(diff))}`,
    };
  }
  const conflict = c.matchReasons?.find((r) => r.startsWith("⚠"));
  if (conflict) {
    return { tone: "warn", text: conflict.replace(/^⚠\s*/, "") };
  }
  if (c.matchConfidenceLevel === "LOW") {
    return { tone: "warn", text: "Pouca evidência" };
  }

  const evidence = EVIDENCE[c.matchSignals?.entityEvidence ?? ""];
  const amountOk =
    c.matchSignals?.amountDelta != null
      ? c.matchSignals.amountDelta <= 0.011
      : c.matchedAmount != null && txs.length > 0;
  if (evidence) {
    return {
      tone: "ok",
      text: amountOk ? `${evidence} e valor conferem` : `${evidence} confere`,
    };
  }

  // Comprovantes antigos não guardam a evidência estruturada: deduz do que
  // dá para comparar (valor lido × título, beneficiário lido × fornecedor).
  const supplier = txs[0]?.supplierOrClient;
  if (!c.matchedEntity) {
    return {
      tone: "warn",
      text: amountOk
        ? "Valor confere; beneficiário não identificado"
        : "Beneficiário não identificado",
    };
  }
  if (supplier && !readNameDiffers(c.matchedEntity, supplier)) {
    return {
      tone: "ok",
      text: amountOk ? "Beneficiário e valor conferem" : "Beneficiário confere",
    };
  }
  return {
    tone: "ok",
    text:
      c.matchReasons?.[0] ??
      (amountOk ? "Valor confere" : "Sugestão automática"),
  };
}

/** Pagos sem comprovante: o lado inverso que o auditor cobra. */
export const lacksReceipt = (t: Transaction) =>
  t.status === "paid" &&
  !t.comprovanteId &&
  !t.comprovanteStoragePath &&
  !t.comprovanteUrl;

export const receiptsStartKey = (companyId?: string) => [
  "receipts-start",
  companyId,
];

/**
 * Data de início sugerida: 1º dia do mês do pagamento mais antigo que já tem
 * comprovante. Antes disso a empresa não controlava comprovantes no sistema.
 */
export function suggestedReceiptsStart(txs: Transaction[]): Date | null {
  let oldest: Date | null = null;
  for (const t of txs) {
    if (!t.paymentDate || !(t.comprovanteId || t.comprovanteStoragePath))
      continue;
    if (!oldest || t.paymentDate < oldest) oldest = t.paymentDate;
  }
  return oldest ? new Date(oldest.getFullYear(), oldest.getMonth(), 1) : null;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Beneficiário lido diferente do fornecedor do título (nenhum contém o outro). */
export function readNameDiffers(read?: string, registered?: string) {
  if (!read || !registered) return false;
  const a = fold(read);
  const b = fold(registered);
  return !a.includes(b) && !b.includes(a);
}
