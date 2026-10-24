/**
 * Leitura da linha digitável (ou do código de barras) de boletos.
 *
 * Dois formatos Febraban:
 *   • bancário: 47 dígitos na linha, 44 no código; traz valor e vencimento;
 *   • arrecadação (concessionárias, tributos): 48 na linha, 44 no código,
 *     começa com 8; traz valor, mas o vencimento não tem posição padrão.
 *
 * Sem dependências: o check em `scripts/check-boleto.mjs` importa este arquivo
 * direto pelo Node.
 */

export interface ParsedBoleto {
  valid: boolean;
  kind: "bank" | "collection" | null;
  /** Só dígitos, como deve ser gravado. */
  digits: string;
  /** Em reais; ausente quando o boleto não fixa valor. */
  amount?: number;
  dueDate?: Date;
  /** Código do banco emissor (boleto bancário). */
  bankCode?: string;
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

function mod10(block: string) {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    const p = Number(block[i]) * weight;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(block: string) {
  let sum = 0;
  let weight = 2;
  for (let i = block.length - 1; i >= 0; i--) {
    sum += Number(block[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum;
}

/** DV geral do código de barras bancário: 0, 10 e 11 viram 1. */
function mod11Bank(block: string) {
  const dv = 11 - (mod11Sum(block) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV da arrecadação: resto 0 ou 1 vira 0. */
function mod11Collection(block: string) {
  const r = mod11Sum(block) % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
}

const DAY = 86_400_000;
const BASE_1997 = Date.UTC(1997, 9, 7);
// O fator chegou a 9999 em 21/02/2025 e recomeçou em 1000 no dia seguinte.
const BASE_2025 = Date.UTC(2025, 1, 22);

/** O fator se repete a cada ciclo: vale o ciclo mais perto de hoje. */
function dueDateFromFactor(factor: number, today: Date) {
  if (factor === 0) return undefined;
  const candidates = [BASE_1997 + factor * DAY];
  if (factor >= 1000) candidates.push(BASE_2025 + (factor - 1000) * DAY);
  const now = today.getTime();
  const best = candidates.reduce((a, b) =>
    Math.abs(b - now) < Math.abs(a - now) ? b : a,
  );
  const d = new Date(best);
  // Meio-dia local: a data não escorrega de dia por fuso, como no resto do app.
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
}

function parseBankBarcode(code: string, today: Date): ParsedBoleto {
  const valid = mod11Bank(code.slice(0, 4) + code.slice(5)) === Number(code[4]);
  const cents = Number(code.slice(9, 19));
  return {
    valid,
    kind: "bank",
    digits: code,
    bankCode: code.slice(0, 3),
    amount: cents > 0 ? cents / 100 : undefined,
    dueDate: dueDateFromFactor(Number(code.slice(5, 9)), today),
  };
}

function parseCollectionBarcode(code: string): ParsedBoleto {
  const id = code[2];
  const check = id === "6" || id === "7" ? mod10 : mod11Collection;
  const valid = check(code.slice(0, 3) + code.slice(4)) === Number(code[3]);
  // 6 e 8 trazem valor efetivo; 7 e 9, valor de referência (índice).
  const cents = id === "6" || id === "8" ? Number(code.slice(4, 15)) : 0;
  return {
    valid,
    kind: "collection",
    digits: code,
    amount: cents > 0 ? cents / 100 : undefined,
  };
}

export function parseBoleto(input: string, today = new Date()): ParsedBoleto {
  const d = onlyDigits(input);
  const invalid: ParsedBoleto = { valid: false, kind: null, digits: d };

  if (d.length === 44) {
    return d[0] === "8"
      ? parseCollectionBarcode(d)
      : parseBankBarcode(d, today);
  }

  if (d.length === 47) {
    const fieldsOk =
      mod10(d.slice(0, 9)) === Number(d[9]) &&
      mod10(d.slice(10, 20)) === Number(d[20]) &&
      mod10(d.slice(21, 31)) === Number(d[31]);
    const barcode =
      d.slice(0, 4) +
      d[32] +
      d.slice(33, 47) +
      d.slice(4, 9) +
      d.slice(10, 20) +
      d.slice(21, 31);
    const parsed = parseBankBarcode(barcode, today);
    return { ...parsed, digits: d, valid: fieldsOk && parsed.valid };
  }

  if (d.length === 48 && d[0] === "8") {
    const blocks = [0, 12, 24, 36].map((i) => d.slice(i, i + 12));
    const check = d[2] === "6" || d[2] === "7" ? mod10 : mod11Collection;
    const blocksOk = blocks.every(
      (b) => check(b.slice(0, 11)) === Number(b[11]),
    );
    const parsed = parseCollectionBarcode(
      blocks.map((b) => b.slice(0, 11)).join(""),
    );
    return { ...parsed, digits: d, valid: blocksOk && parsed.valid };
  }

  return invalid;
}

/** Linha digitável agrupada como vem impressa no boleto. */
export function formatBoletoLine(digits: string) {
  const d = onlyDigits(digits);
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  }
  if (d.length === 48) {
    return [0, 12, 24, 36]
      .map((i) => `${d.slice(i, i + 11)}-${d[i + 11]}`)
      .join(" ");
  }
  return d;
}
