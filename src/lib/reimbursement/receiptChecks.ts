/**
 * Checagens de uma nota enviada pelo funcionário: chave de acesso da NF-e,
 * duplicata, nota antiga e leitura duvidosa. Sem I/O: o servidor junta os
 * candidatos e a tela só mostra o resultado.
 */

/** Nota mais velha que isso vira alerta. */
export const STALE_RECEIPT_DAYS = 60;
/** Abaixo disso a leitura da IA pede conferência. */
export const MIN_CONFIDENCE = 60;

/**
 * Chave de acesso NF-e/NFC-e: 44 dígitos; o último é o DV módulo 11 dos 43
 * anteriores, com pesos 2 a 9 a partir da direita (resto 0 ou 1 dá DV 0).
 */
export function isValidAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return (rest < 2 ? 0 : 11 - rest) === Number(key[43]);
}

/** Só dígitos; devolve a chave se for válida, senão null. */
export function normalizeAccessKey(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  return isValidAccessKey(digits) ? digits : null;
}

/** CNPJ do emitente e número da nota, lidos da própria chave. */
export function accessKeyParts(key: string) {
  return {
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22) === "65" ? "NFC-e" : "NF-e",
    number: String(Number(key.slice(25, 34))),
  };
}

export interface ReceiptFacts {
  amount: number | null;
  date: Date | null;
  supplierDocument: string | null;
  accessKey: string | null;
  confidence: number;
  /** O funcionário corrigiu à mão: a confiança da IA deixa de importar. */
  edited?: boolean;
}

export interface DuplicateCandidate {
  kind: "submission" | "transaction";
  id: string;
  label: string;
  amount: number | null;
  date: Date | null;
  supplierDocument?: string | null;
  accessKey?: string | null;
}

export type ReceiptFlag =
  | {
      code: "duplicate";
      kind: DuplicateCandidate["kind"];
      id: string;
      label: string;
    }
  | { code: "old"; days: number }
  | { code: "unreadable"; missing: string[] };

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const DAY_MS = 86_400_000;

export function receiptFlags(
  facts: ReceiptFacts,
  candidates: DuplicateCandidate[],
  today = new Date(),
): ReceiptFlag[] {
  const flags: ReceiptFlag[] = [];

  // Duplicata: mesma chave de NF-e; sem chave, mesmo valor no mesmo dia e,
  // quando os dois têm, mesmo CNPJ do estabelecimento.
  const dup = candidates.find((c) => {
    if (facts.accessKey && c.accessKey) return facts.accessKey === c.accessKey;
    if (facts.amount == null || c.amount == null || !facts.date || !c.date)
      return false;
    if (Math.round(facts.amount * 100) !== Math.round(c.amount * 100))
      return false;
    if (!sameDay(facts.date, c.date)) return false;
    return (
      !facts.supplierDocument ||
      !c.supplierDocument ||
      facts.supplierDocument === c.supplierDocument
    );
  });
  if (dup)
    flags.push({
      code: "duplicate",
      kind: dup.kind,
      id: dup.id,
      label: dup.label,
    });

  if (facts.date) {
    const days = Math.floor((today.getTime() - facts.date.getTime()) / DAY_MS);
    if (days > STALE_RECEIPT_DAYS) flags.push({ code: "old", days });
  }

  const missing = [
    facts.amount == null && "valor",
    !facts.date && "data",
  ].filter(Boolean) as string[];
  if (missing.length || (!facts.edited && facts.confidence < MIN_CONFIDENCE))
    flags.push({ code: "unreadable", missing });

  return flags;
}

/** Frase para a tela, a mesma para o funcionário e para o financeiro. */
export function flagMessage(flag: ReceiptFlag): string {
  if (flag.code === "duplicate")
    return flag.kind === "submission"
      ? `Parece já ter sido enviada: ${flag.label}.`
      : `Parece já estar lançada: ${flag.label}.`;
  if (flag.code === "old") return `Nota de ${flag.days} dias atrás.`;
  return flag.missing.length
    ? `Não deu para ler: ${flag.missing.join(" e ")}.`
    : "Leitura incerta: confira os valores.";
}
