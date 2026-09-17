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

export function formatCurrencyAbbr(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}R$\u00A0${(abs / 1_000_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}R$\u00A0${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1_000) {
    return `${sign}R$\u00A0${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  }
  return formatCurrency(value);
}
