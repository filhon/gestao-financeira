import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
 * Builds an authenticated proxy URL for a comprovante stored in Firebase Storage.
 * Never use the raw storageUrl (public download token) — use this instead.
 * @param mode "download" adds Content-Disposition: attachment; "inline" renders in browser.
 */
export function comprovanteProxyUrl(
  storagePath: string,
  mode: "download" | "inline" = "download",
): string {
  const base = `/api/internal/storage-proxy?path=${encodeURIComponent(storagePath)}`;
  return mode === "inline" ? `${base}&inline=1` : base;
}

const PT_BR_CONNECTIVES = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "com",
  "para",
  "por",
]);

/** "GLOBO COMUNICACAO E PARTICIPACOES S/A" → "Globo Comunicacao e Participacoes S/A" */
export function titleCasePtBr(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[a-zà-ú]+/g, (word, offset: number) =>
      offset > 0 && PT_BR_CONNECTIVES.has(word)
        ? word
        : word[0].toUpperCase() + word.slice(1),
    );
}

/** Minúsculas e sem acento: "IPT" casa "IPTU", "agua" casa "Água". */
/** "1 linha", "3 linhas". */
export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Remove chaves `undefined` antes de gravar no Firestore, que as rejeita.
 * Desce só em arrays e objetos simples; Date, Timestamp e FieldValue passam intactos.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    ) as T;
  }
  return value;
}

const compactBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  // Precisão fixa: "R$ 4,0 mi" ao lado de "R$ 4,1 mi", nunca "R$ 4 mi".
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "R$ 1,2 mi", "R$ 400,0 mil", "-R$ 47,6 mil". Abaixo de mil, valor cheio. */
export function formatCurrencyAbbr(value: number) {
  return Math.abs(value) >= 1_000
    ? compactBRL.format(value)
    : formatCurrency(value);
}
