import currency from "currency.js";
import { format, startOfDay } from "date-fns";
import type { Transaction } from "@/lib/types";
// Relativo (não "@/"): o check:search roda este arquivo fora do Next.
import { hasComprovante, isOverdue } from "../transactionTabs";

/**
 * Linguagem da busca de transações. A mesma regra roda na rota do servidor,
 * na paleta (Ctrl+K) e na página /busca, para que as três concordem.
 *
 * Termos livres precisam casar todos, em qualquer campo pesquisável
 * (descrição, fornecedor, origem, nº do documento, CNPJ/CPF, linha digitável,
 * centro de custo, conta, lote, RD). Um número solto também casa com o valor.
 *
 *   tipo:pagar | tipo:receber
 *   status:atrasado | rascunho | aprovacao | aprovado | autorizacao | autorizado | pago | rejeitado
 *   valor:>500  valor:<1000  valor:100-500  valor:1.234,56   (ou só >500, 100-500)
 *   venc:2026  venc:2026-07  venc:07/2026  venc:01/07/2026..31/07/2026
 *   pago:...   mesmos formatos, pela data de pagamento
 *   sem:comprovante   pagas sem comprovante, desde o início do controle
 *   sem:conta         sem conta contábil (fora dos grupos da DRE)
 *   -termo     exclui      "frase exata"   casa junta
 */

export type StatusKey =
  | "late"
  | "draft"
  | "pending_approval"
  | "approved"
  | "pending_authorization"
  | "authorized"
  | "paid"
  | "rejected";

export const STATUS_ORDER: StatusKey[] = [
  "late",
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "paid",
  "rejected",
];

export const STATUS_LABELS: Record<StatusKey, string> = {
  late: "Atrasado",
  draft: "Rascunho",
  pending_approval: "Ag. aprovação",
  approved: "Aprovado",
  pending_authorization: "Ag. autorização",
  authorized: "Autorizado",
  paid: "Pago / Recebido",
  rejected: "Rejeitado",
};

const STATUS_ALIASES: Record<string, StatusKey> = {
  atrasado: "late",
  atrasada: "late",
  atrasados: "late",
  vencido: "late",
  vencida: "late",
  rascunho: "draft",
  aprovacao: "pending_approval",
  pendente: "pending_approval",
  aprovado: "approved",
  autorizacao: "pending_authorization",
  autorizado: "authorized",
  pago: "paid",
  paga: "paid",
  pagos: "paid",
  recebido: "paid",
  liquidado: "paid",
  rejeitado: "rejected",
};

/** Palavra da linguagem para cada status (inverso de STATUS_ALIASES). */
export const STATUS_TOKEN: Record<StatusKey, string> = {
  late: "atrasado",
  draft: "rascunho",
  pending_approval: "aprovacao",
  approved: "aprovado",
  pending_authorization: "autorizacao",
  authorized: "autorizado",
  paid: "pago",
  rejected: "rejeitado",
};

type Tx = Pick<
  Transaction,
  | "type"
  | "status"
  | "amount"
  | "dueDate"
  | "paymentDate"
  | "comprovanteId"
  | "comprovanteStoragePath"
  | "comprovanteUrl"
  | "accountId"
>;

export const isSettled = (t: Pick<Transaction, "status">) =>
  t.status === "paid" || t.status === "received";

/** Status de exibição: "late" é derivado do vencimento; recebido conta como pago. */
export function statusKey(t: Tx, today = startOfDay(new Date())): StatusKey {
  if (isSettled(t)) return "paid";
  if (isOverdue(t, today)) return "late";
  return t.status as StatusKey;
}

export function statusLabel(t: Tx, today?: Date) {
  const key = statusKey(t, today);
  if (key === "paid") return t.type === "receivable" ? "Recebido" : "Pago";
  return STATUS_LABELS[key] ?? t.status;
}

export function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** "1.234,56", "1234,56", "1234.56", "R$ 500" → número; o resto → undefined. */
export function parseBRL(raw: string): number | undefined {
  const v = raw.trim().replace(/^r\$\s*/i, "");
  if (!/^\d[\d.,]*$/.test(v)) return undefined;
  const ptBR = v.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(v);
  return ptBR
    ? currency(v, { separator: ".", decimal: "," }).value
    : currency(v).value;
}

// ── Datas ────────────────────────────────────────────────────────────────────

export interface DayRange {
  from: string; // yyyy-MM-dd, inclusivo
  to: string;
}

const month = (y: string, m: string): DayRange => ({
  from: `${y}-${m}-01`,
  to: `${y}-${m}-${String(new Date(+y, +m, 0).getDate()).padStart(2, "0")}`,
});

/** Um pedaço de data como intervalo: ano, mês ou dia, ISO ou dd/MM/yyyy. */
function parsePeriod(s: string): DayRange | undefined {
  let m = s.match(/^(\d{4})$/);
  if (m) return { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return month(m[1], m[2]);
  m = s.match(/^(\d{2})\/(\d{4})$/);
  if (m) return month(m[2], m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { from: s, to: s };
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const day = `${m[3]}-${m[2]}-${m[1]}`;
    return { from: day, to: day };
  }
  return undefined;
}

function parseDayRange(v: string): DayRange | undefined {
  const [a, b] = v.split("..");
  const start = parsePeriod(a);
  if (b === undefined) return start;
  const end = parsePeriod(b);
  return start && end ? { from: start.from, to: end.to } : undefined;
}

export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

const inRange = (d: Date | undefined, r: DayRange) => {
  if (!d) return false;
  const k = dayKey(d);
  return k >= r.from && k <= r.to;
};

const brDay = (k: string) => k.split("-").reverse().join("/");

const rangeLabel = (r: DayRange) =>
  r.from === r.to ? brDay(r.from) : `${brDay(r.from)} a ${brDay(r.to)}`;

// ── Parser ───────────────────────────────────────────────────────────────────

export interface AmountSpec {
  min?: number;
  max?: number;
  exact?: number;
}

function parseAmountSpec(v: string): AmountSpec | undefined {
  if (v.startsWith(">")) {
    const n = parseBRL(v.slice(1));
    return n === undefined ? undefined : { min: n };
  }
  if (v.startsWith("<")) {
    const n = parseBRL(v.slice(1));
    return n === undefined ? undefined : { max: n };
  }
  const range = v.split(/-|\.\.(?=\d)/);
  if (range.length === 2) {
    const [min, max] = range.map(parseBRL);
    return min === undefined || max === undefined ? undefined : { min, max };
  }
  const n = parseBRL(v);
  return n === undefined ? undefined : { exact: n };
}

const brl = (n: number) =>
  currency(n, { symbol: "R$ ", separator: ".", decimal: "," }).format();

function amountLabel(a: AmountSpec) {
  if (a.exact !== undefined) return `Valor ${brl(a.exact)}`;
  if (a.min !== undefined && a.max !== undefined)
    return `Valor ${brl(a.min)} a ${brl(a.max)}`;
  return a.min !== undefined
    ? `Valor acima de ${brl(a.min)}`
    : `Valor abaixo de ${brl(a.max!)}`;
}

export interface QueryTerm {
  text: string; // normalizado
  amount?: number; // número solto também casa com o valor
  digits?: string; // CNPJ, documento, linha digitável sem pontuação
}

export interface QueryToken {
  raw: string;
  label: string;
  invalid?: boolean;
  /** Palavra livre: fica no campo, não vira chip. */
  text?: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  excluded: string[];
  type?: "payable" | "receivable";
  statuses: StatusKey[];
  amount?: AmountSpec;
  due?: DayRange;
  paid?: DayRange;
  missingReceipt?: boolean;
  missingAccount?: boolean;
  tokens: QueryToken[];
}

const TOKEN = /(-?)(?:([a-zçã]+):)?(?:"([^"]*)"|(\S+))/gi;

export function parseQuery(raw: string): ParsedQuery {
  const q: ParsedQuery = { terms: [], excluded: [], statuses: [], tokens: [] };
  const input = raw.replace(/r\$\s*/gi, "");

  for (const m of input.matchAll(TOKEN)) {
    const [whole, neg, rawKey, quoted, bare] = m;
    const value = (quoted ?? bare ?? "").trim();
    const key = rawKey ? normalizeText(rawKey) : "";
    const token = (label: string, invalid = false) =>
      q.tokens.push({ raw: whole, label, ...(invalid && { invalid }) });

    if (!key) {
      // "-" e "·" soltos, comuns ao colar descrições, não são termos.
      if (!/[\p{L}\p{N}]/u.test(value)) continue;
      const amount = !neg && !quoted ? parseAmountSpec(value) : undefined;
      if (amount && amount.exact === undefined) {
        q.amount = amount;
        token(amountLabel(amount));
      } else if (neg) {
        q.excluded.push(normalizeText(value));
        token(`Exceto “${value}”`);
      } else {
        const digits = onlyDigits(value);
        q.terms.push({
          text: normalizeText(value),
          ...(amount && { amount: amount.exact }),
          ...(digits.length >= 5 &&
            digits.length >= value.length - 4 && {
              digits,
            }),
        });
        q.tokens.push({ raw: whole, label: `“${value}”`, text: true });
      }
      continue;
    }

    const v = normalizeText(value);
    switch (key) {
      case "tipo":
        if (v === "pagar" || v === "receber") {
          q.type = v === "pagar" ? "payable" : "receivable";
          token(v === "pagar" ? "A pagar" : "A receber");
        } else token(whole, true);
        break;
      case "status": {
        const s = STATUS_ALIASES[v];
        if (s) {
          if (!q.statuses.includes(s)) q.statuses.push(s);
          token(STATUS_LABELS[s]);
        } else token(whole, true);
        break;
      }
      case "valor": {
        const a = parseAmountSpec(value);
        if (a) {
          q.amount = a;
          token(amountLabel(a));
        } else token(whole, true);
        break;
      }
      case "venc":
      case "vencimento":
      case "pago":
      case "pagamento": {
        const r = parseDayRange(value);
        const isDue = key.startsWith("venc");
        if (r) {
          q[isDue ? "due" : "paid"] = r;
          token(`${isDue ? "Vencimento" : "Pago em"} ${rangeLabel(r)}`);
        } else token(whole, true);
        break;
      }
      case "sem":
        if (v === "comprovante") {
          q.missingReceipt = true;
          token("Sem comprovante");
        } else if (v === "conta") {
          q.missingAccount = true;
          token("Sem conta contábil");
        } else token(whole, true);
        break;
      default:
        token(whole, true);
    }
  }
  return q;
}

/** A consulta sem o token `raw` (chip removido). */
export function removeToken(query: string, raw: string) {
  return parseQuery(query)
    .tokens.filter((t) => t.raw !== raw)
    .map((t) => t.raw)
    .join(" ");
}

/** Só os tokens válidos: o que sobra de uma frase interpretada pela IA. */
export function sanitizeQuery(query: string) {
  return parseQuery(query)
    .tokens.filter((t) => !t.invalid)
    .map((t) => t.raw)
    .join(" ");
}

const PHRASE_HINT =
  /\b(acima|abaixo|maior|menor|mais de|menos de|entre|pag[ao]s?|pagar|receb|atrasad|vencid|vence|sem|comprovante|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|mes|semana|ano|hoje|ontem|amanha|rascunho|aprova|rejeitad|reais)\b/;

/**
 * Frase em linguagem natural que vale mandar para a IA: várias palavras soltas,
 * nenhum filtro escrito, e algum indício de filtro (valor, data, situação).
 * Um nome composto ("Filipe Honório da Silva Santos") não é frase.
 */
export function looksLikePhrase(query: string) {
  const q = parseQuery(query);
  return (
    q.tokens.length >= 3 &&
    q.tokens.every((t) => t.text) &&
    PHRASE_HINT.test(normalizeText(query))
  );
}

export const hasFilters = (q: ParsedQuery) =>
  q.terms.length > 0 ||
  q.excluded.length > 0 ||
  !!q.type ||
  q.statuses.length > 0 ||
  !!q.amount ||
  !!q.due ||
  !!q.paid ||
  !!q.missingReceipt ||
  !!q.missingAccount;

// ── Matching ─────────────────────────────────────────────────────────────────

export interface Haystack {
  text: string;
  digits: string;
}

/** Campos pesquisáveis já normalizados; `docs` também entram só com dígitos. */
export function buildHaystack(
  fields: (string | undefined | null)[],
  docs: (string | undefined | null)[] = [],
): Haystack {
  const all = [...fields, ...docs].filter(Boolean) as string[];
  return {
    text: normalizeText(all.join(" \u0001 ")),
    digits: docs
      .filter(Boolean)
      .map((d) => onlyDigits(d!))
      .join("|"),
  };
}

/**
 * Conta paga sem comprovante que a empresa cobra: mesma regra da tela de
 * Comprovantes, que ignora pagamentos anteriores ao início do controle.
 */
export const needsReceipt = (t: Tx, receiptsStart: Date | null) =>
  t.status === "paid" &&
  !hasComprovante(t as Transaction) &&
  (!receiptsStart || (!!t.paymentDate && t.paymentDate >= receiptsStart));

export function matchTransaction(
  t: Tx,
  q: ParsedQuery,
  hay: Haystack,
  today = startOfDay(new Date()),
  receiptsStart: Date | null = null,
) {
  if (q.type && t.type !== q.type) return false;
  if (q.statuses.length && !q.statuses.includes(statusKey(t, today)))
    return false;
  if (q.amount) {
    const { min, max, exact } = q.amount;
    if (exact !== undefined && Math.abs(t.amount - exact) >= 0.005)
      return false;
    if (min !== undefined && t.amount < min) return false;
    if (max !== undefined && t.amount > max) return false;
  }
  if (q.due && !inRange(t.dueDate, q.due)) return false;
  if (q.paid && !inRange(t.paymentDate, q.paid)) return false;
  if (q.missingReceipt && !needsReceipt(t, receiptsStart)) return false;
  // ponytail: só a falta do campo; conta excluída ou sintética também cai em
  // "sem conta" na DRE e aqui não aparece.
  if (q.missingAccount && (t.accountId || t.status === "rejected")) {
    return false;
  }
  for (const term of q.terms) {
    const hit =
      hay.text.includes(term.text) ||
      (term.amount !== undefined && Math.abs(t.amount - term.amount) < 0.005) ||
      (!!term.digits && hay.digits.includes(term.digits));
    if (!hit) return false;
  }
  return !q.excluded.some((x) => hay.text.includes(x));
}

// ── Destaque ─────────────────────────────────────────────────────────────────

/** Trechos de `text` que casam com os termos, ignorando acento e caixa. */
export function highlightRanges(text: string, needles: string[]) {
  let norm = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const c of normalizeText(text[i])) {
      norm += c;
      origin.push(i);
    }
  }
  const ranges: [number, number][] = [];
  for (const needle of needles) {
    if (!needle) continue;
    let at = norm.indexOf(needle);
    while (at !== -1) {
      ranges.push([origin[at], origin[at + needle.length - 1] + 1]);
      at = norm.indexOf(needle, at + needle.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
