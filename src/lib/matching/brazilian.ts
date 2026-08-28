/**
 * Primitivas de domínio brasileiro usadas pelo motor de matching:
 * validação de CPF/CNPJ, linha digitável de boleto, chaves Pix,
 * parsing de valores em R$ e de datas em português.
 *
 * Puro, sem I/O e sem dependências — reutilizável em qualquer contexto.
 */

import { digitsOnly } from "./text";

// ── CPF / CNPJ ────────────────────────────────────────────────────────────────

/**
 * Valida os dígitos verificadores do CPF.
 *
 * Isto não é preciosismo: comprovantes contêm dezenas de sequências numéricas
 * (NSU, protocolo, código de autenticação, conta). Sem validar o DV, qualquer
 * corrida de 11 dígitos vira um "CPF" e produz falso positivo de beneficiário.
 */
export function isValidCPF(value: string): boolean {
  const cpf = digitsOnly(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (const [length, position] of [
    [9, 10],
    [10, 11],
  ]) {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(cpf[i]) * (position - i);
    }
    const remainder = ((sum * 10) % 11) % 10;
    if (remainder !== Number(cpf[length])) return false;
  }
  return true;
}

/** Valida os dígitos verificadores do CNPJ (mesma motivação do CPF). */
export function isValidCNPJ(value: string): boolean {
  const cnpj = digitsOnly(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const check = (length: number): boolean => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += Number(cnpj[i]) * weight;
      weight = weight - 1 < 2 ? 9 : weight - 1;
    }
    const remainder = sum % 11;
    const digit = remainder < 2 ? 0 : 11 - remainder;
    return digit === Number(cnpj[length]);
  };

  return check(12) && check(13);
}

/** Raiz do CNPJ (8 primeiros dígitos) — matriz e filiais compartilham. */
export function cnpjRoot(cnpj: string): string {
  const digits = digitsOnly(cnpj);
  return digits.length === 14 ? digits.slice(0, 8) : "";
}

/**
 * Compara um CPF completo com a forma mascarada dos comprovantes Pix
 * (`***.456.789-**` expõe apenas os dígitos 4 a 9).
 */
export function cpfMatchesMask(cpf: string, visibleDigits: string): boolean {
  const full = digitsOnly(cpf);
  if (full.length !== 11 || visibleDigits.length !== 6) return false;
  return full.slice(3, 9) === visibleDigits;
}

// ── Boleto: linha digitável ↔ código de barras ────────────────────────────────

/**
 * Converte qualquer representação de boleto para o código de barras canônico
 * de 44 dígitos, para que a linha digitável impressa no comprovante case com o
 * `barcode` gravado na transação (e vice-versa).
 *
 * Suporta:
 *   - código de barras (44 dígitos) — devolvido como está;
 *   - linha digitável de cobrança (47 dígitos);
 *   - linha digitável de arrecadação/concessionária (48 dígitos).
 */
export function toBarcode(value: string): string | null {
  const d = digitsOnly(value);

  if (d.length === 44) return d;

  // Cobrança: 5 campos → posições fixas do código de barras.
  if (d.length === 47) {
    return (
      d.slice(0, 4) + // banco (3) + moeda (1)
      d[32] + // DV geral
      d.slice(33, 47) + // fator de vencimento (4) + valor (10)
      d.slice(4, 9) + // campo livre 1
      d.slice(10, 20) + // campo livre 2
      d.slice(21, 31) // campo livre 3
    );
  }

  // Arrecadação: 4 blocos de 12 (11 dígitos úteis + DV de bloco).
  if (d.length === 48) {
    return d.slice(0, 11) + d.slice(12, 23) + d.slice(24, 35) + d.slice(36, 47);
  }

  return null;
}

/** Forma impressa da linha digitável de cobrança: 5.5 5.6 5.6 1 14. */
const LINHA_COBRANCA_RE =
  /\d{5}[.\s]?\d{5}[\s.]{0,3}\d{5}[.\s]?\d{6}[\s.]{0,3}\d{5}[.\s]?\d{6}[\s.]{0,3}\d[\s.]{0,3}\d{14}/g;

/** Forma impressa da arrecadação/concessionária: 4 blocos de 11+1. */
const LINHA_ARRECADACAO_RE =
  /\d{11}[-\s.]{0,3}\d[\s.]{0,3}\d{11}[-\s.]{0,3}\d[\s.]{0,3}\d{11}[-\s.]{0,3}\d[\s.]{0,3}\d{11}[-\s.]{0,3}\d/g;

const BARCODE_RE = /\b\d{44}\b/g;

/**
 * Extrai todo boleto citado no texto, normalizado para o código de barras de
 * 44 dígitos. Casa tanto a forma impressa (com pontos e espaços) quanto a
 * sequência crua, e ainda linhas em que o OCR devolveu só os dígitos.
 */
export function extractBoletos(folded: string): string[] {
  const found = new Set<string>();

  for (const re of [LINHA_COBRANCA_RE, LINHA_ARRECADACAO_RE, BARCODE_RE]) {
    const scanner = new RegExp(re.source, re.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(folded)) !== null) {
      const barcode = toBarcode(match[0]);
      if (barcode) found.add(barcode);
    }
  }

  // Linhas que contêm exclusivamente a linha digitável, em qualquer formatação.
  for (const line of folded.split(/[\n\r]+/)) {
    if (!/\d/.test(line)) continue;
    if (/[a-z]/.test(line)) continue;
    const barcode = toBarcode(line);
    if (barcode) found.add(barcode);
  }

  return [...found];
}

// ── Chaves Pix ────────────────────────────────────────────────────────────────

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g;
const PHONE_KEY_RE = /\+55\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g;

/** Normaliza uma chave Pix para comparação (telefone → só dígitos, e-mail → minúsculo). */
export function normalizePixKey(key: string): string {
  const trimmed = key.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed;
  const digits = digitsOnly(trimmed);
  // Telefone: compara pelos 11 dígitos finais (DDD + número), ignorando o +55.
  if (digits.length >= 10 && digits.length <= 13) return digits.slice(-11);
  if (digits.length === 11 || digits.length === 14) return digits;
  return trimmed;
}

export function extractPixKeys(folded: string): string[] {
  const keys = new Set<string>();
  for (const re of [UUID_RE, EMAIL_RE, PHONE_KEY_RE]) {
    const scanner = new RegExp(re.source, re.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(folded)) !== null) {
      keys.add(normalizePixKey(match[0]));
    }
  }
  return [...keys];
}

/** Identificador ponta a ponta do Pix (E + ISPB + timestamp + aleatório). */
export function extractEndToEndIds(folded: string): string[] {
  // E + ISPB(8) + aaaammddhhmm(12) + aleatório(11) = 32 caracteres.
  const re = /\be\d{8}\d{4}[01]\d[0-3]\d\d{4}[0-9a-z]{11}\b/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(folded)) !== null) ids.add(match[0]);
  return [...ids];
}

// ── Valores monetários ────────────────────────────────────────────────────────

/**
 * Converte um literal numérico brasileiro (ou americano) em número.
 * Regra: quando há os dois separadores, o último é o decimal.
 */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/[.,]+$/, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // "1.234,56" já tratado acima; aqui é "1234,56" ou "1,234" (milhar en-US raro).
    const decimals = cleaned.length - lastComma - 1;
    normalized =
      decimals === 3 ? cleaned.split(",").join("") : cleaned.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1;
    // "1.234" em pt-BR é milhar; "1.23" é decimal.
    normalized = decimals === 3 ? cleaned.split(".").join("") : cleaned;
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// ── Datas ─────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  abr: 4,
  abril: 4,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  setembro: 9,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dez: 12,
  dezembro: 12,
};

/** Mais longos primeiro: "janeiro" precisa ser tentado antes de "jan". */
export const MONTH_NAMES_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

export function monthFromName(name: string): number | null {
  return MONTHS[name] ?? null;
}

/**
 * O Brasil não observa horário de verão desde 2019, então UTC-3 é constante.
 * Ancorar toda data em "meia-noite de Brasília" faz a comparação por dia
 * civil bater independentemente do fuso do servidor (Vercel roda em UTC).
 */
const BRT_OFFSET_HOURS = 3;

export function brtDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, BRT_OFFSET_HOURS));
  // Rejeita datas "roladas" como 31/02.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return date;
}

/** Número do dia civil em Brasília — base para diferença em dias entre datas. */
export function civilDay(date: Date): number {
  return Math.floor(
    (date.getTime() - BRT_OFFSET_HOURS * 3_600_000) / 86_400_000,
  );
}

export function dayDiff(a: Date, b: Date): number {
  return Math.abs(civilDay(a) - civilDay(b));
}

/** Ano de 2 dígitos → 4 dígitos, ancorado no século atual. */
export function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year + (year <= 79 ? 2000 : 1900);
}
