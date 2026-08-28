/**
 * Leitura estruturada de um comprovante de pagamento.
 *
 * O algoritmo antigo tratava o comprovante como um saco de palavras: pegava o
 * primeiro valor e a primeira data que aparecessem. Só que um comprovante real
 * tem *vários* valores (valor pago, tarifa, saldo, limite, IOF) e *várias*
 * datas (pagamento, vencimento, emissão) — e o primeiro raramente é o certo.
 *
 * Aqui cada fato extraído carrega o rótulo que o precede no documento e um peso
 * derivado dele, de modo que "Valor do pagamento: R$ 1.234,56" pese muito mais
 * que "Tarifa: R$ 1,90" na hora de comparar com a transação.
 */

import {
  brtDate,
  expandYear,
  extractBoletos,
  extractEndToEndIds,
  extractPixKeys,
  isValidCNPJ,
  isValidCPF,
  monthFromName,
  MONTH_NAMES_PATTERN,
  parseMoney,
} from "./brazilian";
import {
  buildTokenIndex,
  digitsOnly,
  fold,
  normalize,
  type TokenIndex,
} from "./text";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type FactRole = "beneficiary" | "payer" | "unknown";

export interface ExtractedAmount {
  value: number;
  /** 0..1 — confiança de que este é o valor efetivamente pago. */
  weight: number;
  label: string | null;
  index: number;
}

export interface ExtractedDate {
  date: Date;
  /** 0..1 — confiança de que esta é a data do pagamento. */
  weight: number;
  label: string | null;
  index: number;
}

export interface ExtractedDocument {
  /** Dígitos completos quando legíveis; vazio quando mascarado. */
  digits: string;
  kind: "cpf" | "cnpj";
  masked: boolean;
  /** Dígitos visíveis de um CPF mascarado (`***.456.789-**` → "456789"). */
  visible?: string;
  role: FactRole;
  index: number;
}

export type PaymentMethodHint =
  | "pix"
  | "ted"
  | "doc"
  | "boleto"
  | "transfer"
  | "debit"
  | "card"
  | "cash";

export interface ReceiptFacts {
  folded: string;
  tokens: TokenIndex;
  amounts: ExtractedAmount[];
  dates: ExtractedDate[];
  documents: ExtractedDocument[];
  pixKeys: string[];
  boletos: string[];
  endToEndIds: string[];
  agencies: string[];
  accounts: string[];
  /** Nomes lidos de rótulos de beneficiário/favorecido/recebedor. */
  beneficiaryNames: string[];
  payerNames: string[];
  paymentMethods: PaymentMethodHint[];
  documentNumbers: string[];
  /** Texto vazio ou sem qualquer fato aproveitável. */
  isEmpty: boolean;
}

// ── Rótulos ───────────────────────────────────────────────────────────────────

interface LabelRule {
  re: RegExp;
  weight: number;
}

/**
 * Rótulos que antecedem um valor. "Latest wins": o rótulo mais próximo do
 * número (portanto o de maior índice na janela de contexto) é o que vale.
 */
const AMOUNT_LABELS: LabelRule[] = [
  {
    re: /valor\s*(total\s*)?(do|da|de)?\s*(pagamento|pago|transferencia|transacao|operacao|pix|ted|doc|boleto|titulo|documento|cobranca|fatura|nota)/g,
    weight: 1,
  },
  { re: /valor\s*(a\s*)?(pagar|cobrado|liquido|total)/g, weight: 1 },
  { re: /(total|valor)\s*(geral|pago|debitado|creditado)/g, weight: 1 },
  { re: /quantia|montante/g, weight: 0.95 },
  { re: /\bvalor\b/g, weight: 0.85 },
  { re: /\btotal\b/g, weight: 0.85 },
  { re: /valor\s*(original|nominal|do\s*titulo)/g, weight: 0.7 },
  {
    re: /tarifa|taxa|iof|multa|juros|mora|desconto|abatimento|acrescimo|saldo|limite|rendimento|disponivel|bloqueado|anterior|extrato/g,
    weight: 0.16,
  },
];

const DATE_LABELS: LabelRule[] = [
  {
    re: /data\s*(e\s*hora\s*)?(do|da|de)?\s*(pagamento|pago|transacao|transferencia|operacao|efetivacao|liquidacao|credito|debito)/g,
    weight: 1,
  },
  {
    re: /(pago|efetuado|realizado|liquidado|processado)\s*(em|no\s*dia)/g,
    weight: 1,
  },
  { re: /data\s*(e\s*hora)?\s*:/g, weight: 0.85 },
  { re: /\bdata\b/g, weight: 0.8 },
  {
    re: /vencimento|venc\b|emissao|documento|competencia|processamento/g,
    weight: 0.35,
  },
];

const BENEFICIARY_MARKERS =
  /benefici|favorecid|recebedor|creditad|cedente|destinatari|quem\s*recebeu|dados\s*(do|de)\s*(recebedor|beneficiario|favorecido|destino)|\bpara\s*:|\bdestino\b/g;

const PAYER_MARKERS =
  /pagador|remetent|debitad|sacad|quem\s*pagou|dados\s*(do|de)\s*(pagador|remetente|origem)|origem|\bde\b\s*:/g;

const METHOD_HINTS: Array<[RegExp, PaymentMethodHint]> = [
  [/\bpix\b|chave\s*pix|qr\s*code/, "pix"],
  [/\bted\b|transferencia\s*eletronica/, "ted"],
  [/\bdoc\b(?!umento)/, "doc"],
  [
    /boleto|linha\s*digitavel|codigo\s*de\s*barras|titulo\s*de\s*cobranca/,
    "boleto",
  ],
  [/transferencia|transferido/, "transfer"],
  [/debito\s*em\s*conta|debito\s*automatico/, "debit"],
  [/cartao\s*(de\s*)?(credito|debito)/, "card"],
  [/dinheiro|especie/, "cash"],
];

// ── Utilitários de contexto ───────────────────────────────────────────────────

const CONTEXT_WINDOW = 80;

/** Aplica "o rótulo mais próximo vence" sobre a janela que antecede o índice. */
function labelWeightAt(
  folded: string,
  index: number,
  rules: LabelRule[],
  fallback: number,
): { weight: number; label: string | null } {
  const start = Math.max(0, index - CONTEXT_WINDOW);
  const context = folded.slice(start, index);

  let bestPosition = -1;
  let weight = fallback;
  let label: string | null = null;

  for (const rule of rules) {
    const scanner = new RegExp(rule.re.source, rule.re.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(context)) !== null) {
      if (match.index >= bestPosition) {
        bestPosition = match.index;
        weight = rule.weight;
        label = match[0].trim();
      }
    }
  }

  return { weight, label };
}

/** Beneficiário ou pagador? Decide pelo marcador mais próximo à esquerda. */
function roleAt(folded: string, index: number): FactRole {
  const start = Math.max(0, index - 220);
  const context = folded.slice(start, index);

  const lastIndexOf = (re: RegExp): number => {
    const scanner = new RegExp(re.source, re.flags);
    let last = -1;
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(context)) !== null) last = match.index;
    return last;
  };

  const beneficiary = lastIndexOf(BENEFICIARY_MARKERS);
  const payer = lastIndexOf(PAYER_MARKERS);

  if (beneficiary < 0 && payer < 0) return "unknown";
  return beneficiary >= payer ? "beneficiary" : "payer";
}

// ── Extratores ────────────────────────────────────────────────────────────────

/**
 * Dois ramos:
 *   1. precedido de "R$" — aceita qualquer forma numérica;
 *   2. solto no texto — exige parte decimal, senão protocolos, números de
 *      conta e códigos de agência entrariam como se fossem valores.
 */
const AMOUNT_RE =
  /r\$\s*([\d.,]+)|\b(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2})\b/g;

function extractAmounts(folded: string): ExtractedAmount[] {
  const results: ExtractedAmount[] = [];
  const scanner = new RegExp(AMOUNT_RE.source, AMOUNT_RE.flags);
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(folded)) !== null) {
    const hasCurrency = match[1] !== undefined;
    const literal = match[1] ?? match[2];
    const value = parseMoney(literal);
    if (value === null || value <= 0.009 || value >= 1_000_000_000) continue;

    const { weight, label } = labelWeightAt(
      folded,
      match.index,
      AMOUNT_LABELS,
      hasCurrency ? 0.6 : 0.45,
    );

    results.push({ value, weight, label, index: match.index });
  }

  // Dedup por valor mantendo a ocorrência de maior peso.
  const byValue = new Map<number, ExtractedAmount>();
  for (const amount of results) {
    const current = byValue.get(amount.value);
    if (!current || amount.weight > current.weight)
      byValue.set(amount.value, amount);
  }

  const deduped = [...byValue.values()];

  // O maior valor de um comprovante costuma ser o valor pago — desde que não
  // esteja rotulado como saldo/limite/tarifa.
  const max = deduped.reduce((acc, a) => Math.max(acc, a.value), 0);
  for (const amount of deduped) {
    if (amount.value === max && amount.weight >= 0.45) {
      amount.weight = Math.min(1, amount.weight + 0.12);
    }
  }

  return deduped.sort((a, b) => b.weight - a.weight || b.value - a.value);
}

const DATE_PATTERNS: RegExp[] = [
  /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g,
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

function extractDates(folded: string): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const currentYear = new Date().getUTCFullYear();

  const push = (
    year: number,
    month: number,
    day: number,
    index: number,
  ): void => {
    const expanded = expandYear(year);
    if (expanded < 2015 || expanded > currentYear + 1) return;
    const date = brtDate(expanded, month, day);
    if (!date) return;
    const { weight, label } = labelWeightAt(folded, index, DATE_LABELS, 0.6);
    results.push({ date, weight, label, index });
  };

  // dd/MM/yyyy, dd-MM-yy, dd.MM.yyyy
  {
    const scanner = new RegExp(DATE_PATTERNS[0].source, DATE_PATTERNS[0].flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(folded)) !== null) {
      push(Number(match[3]), Number(match[2]), Number(match[1]), match.index);
    }
  }

  // yyyy-MM-dd
  {
    const scanner = new RegExp(DATE_PATTERNS[1].source, DATE_PATTERNS[1].flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(folded)) !== null) {
      push(Number(match[1]), Number(match[2]), Number(match[3]), match.index);
    }
  }

  // "8 de junho de 2026" / "08 jun 2026" — formato dominante em recibos.
  {
    const scanner = new RegExp(
      `\\b(\\d{1,2})\\s*(?:de\\s*)?(${MONTH_NAMES_PATTERN})\\.?\\s*(?:de\\s*)?(\\d{4}|\\d{2})\\b`,
      "g",
    );
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(folded)) !== null) {
      const month = monthFromName(match[2]);
      if (month === null) continue;
      push(Number(match[3]), month, Number(match[1]), match.index);
    }
  }

  // Dedup por dia, mantendo a ocorrência de maior peso.
  const byDay = new Map<number, ExtractedDate>();
  for (const entry of results) {
    const key = entry.date.getTime();
    const current = byDay.get(key);
    if (!current || entry.weight > current.weight) byDay.set(key, entry);
  }

  return [...byDay.values()].sort(
    (a, b) => b.weight - a.weight || b.date.getTime() - a.date.getTime(),
  );
}

const CNPJ_FORMATTED_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const CPF_FORMATTED_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CNPJ_RAW_RE = /\b\d{14}\b/g;
const CPF_RAW_RE = /\b\d{11}\b/g;
/** CPF mascarado dos comprovantes Pix: `***.456.789-**`. */
const CPF_MASKED_RE = /[*x•.]{3}\.?(\d{3})\.?(\d{3})[-.]?[*x•]{2}/g;

function extractDocuments(folded: string): ExtractedDocument[] {
  const results: ExtractedDocument[] = [];
  const seen = new Set<string>();

  const add = (
    digits: string,
    kind: "cpf" | "cnpj",
    index: number,
    masked = false,
    visible?: string,
  ): void => {
    const key = `${kind}:${digits || visible}`;
    const role = roleAt(folded, index);
    // Mesmo documento em papéis diferentes: mantém as duas leituras.
    const roleKey = `${key}:${role}`;
    if (seen.has(roleKey)) return;
    seen.add(roleKey);
    results.push({ digits, kind, masked, visible, role, index });
  };

  for (const [re, kind] of [
    [CNPJ_FORMATTED_RE, "cnpj"],
    [CNPJ_RAW_RE, "cnpj"],
    [CPF_FORMATTED_RE, "cpf"],
    [CPF_RAW_RE, "cpf"],
  ] as Array<[RegExp, "cpf" | "cnpj"]>) {
    const scanner = new RegExp(re.source, re.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(folded)) !== null) {
      const digits = digitsOnly(match[0]);
      const valid = kind === "cnpj" ? isValidCNPJ(digits) : isValidCPF(digits);
      if (!valid) continue;
      add(digits, kind, match.index);
    }
  }

  const maskedScanner = new RegExp(CPF_MASKED_RE.source, CPF_MASKED_RE.flags);
  let masked: RegExpExecArray | null;
  while ((masked = maskedScanner.exec(folded)) !== null) {
    add("", "cpf", masked.index, true, masked[1] + masked[2]);
  }

  return results;
}

const NAME_AFTER_LABEL_RE =
  /(benefici[a-z]*|favorecid[oa]|recebedor|cedente|destinatari[oa]|pagador|remetente|sacad[oa])\s*(?:\(.*?\))?\s*[:\-–]?\s*(?:nome\s*[:\-]?\s*)?([a-z0-9][^\n\r]{2,70})/g;

/** Corta a linha capturada onde começa outro campo do comprovante. */
const NAME_TERMINATORS =
  /\s+(cpf|cnpj|cpf\/cnpj|agencia|ag\b|conta|banco|instituicao|chave|tipo|valor|data|documento|identificacao|ispb|nome\s*fantasia)\b/;

function extractNames(folded: string): {
  beneficiaryNames: string[];
  payerNames: string[];
} {
  const beneficiaryNames = new Set<string>();
  const payerNames = new Set<string>();

  const scanner = new RegExp(
    NAME_AFTER_LABEL_RE.source,
    NAME_AFTER_LABEL_RE.flags,
  );
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(folded)) !== null) {
    const marker = match[1];
    let value = match[2].trim();

    const terminator = value.search(NAME_TERMINATORS);
    if (terminator > 0) value = value.slice(0, terminator);
    value = value.replace(/[\s:;,.\-–]+$/, "").trim();

    if (value.length < 3 || !/[a-z]{3}/.test(value)) continue;
    if (value.length > 70) value = value.slice(0, 70);

    const isPayer = /pagador|remetente|sacad/.test(marker);
    (isPayer ? payerNames : beneficiaryNames).add(value);
  }

  return {
    beneficiaryNames: [...beneficiaryNames],
    payerNames: [...payerNames],
  };
}

const AGENCY_RE = /\bag(?:encia)?\.?\s*[:\-]?\s*(\d{3,5})(?:\s*-\s*\d)?/g;
const ACCOUNT_RE =
  /\b(?:conta|c\/c|cc)\.?\s*(?:corrente|poupanca)?\s*[:\-]?\s*(\d{3,12})(?:\s*-\s*\d)?/g;
const DOC_NUMBER_RE =
  /(?:nota\s*fiscal|nf-?e?|nf|documento|doc|fatura|duplicata|pedido|contrato)\s*[:\-nº°.]{0,3}\s*(\d{2,12})/g;

function extractAll(re: RegExp, folded: string): string[] {
  const scanner = new RegExp(re.source, re.flags);
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(folded)) !== null) values.add(match[1]);
  return [...values];
}

// ── API ───────────────────────────────────────────────────────────────────────

/** Lê um comprovante e devolve todos os fatos aproveitáveis para o matching. */
export function parseReceipt(text: string): ReceiptFacts {
  const folded = fold(text ?? "");

  if (folded.trim().length === 0) {
    return {
      folded: "",
      tokens: buildTokenIndex([]),
      amounts: [],
      dates: [],
      documents: [],
      pixKeys: [],
      boletos: [],
      endToEndIds: [],
      agencies: [],
      accounts: [],
      beneficiaryNames: [],
      payerNames: [],
      paymentMethods: [],
      documentNumbers: [],
      isEmpty: true,
    };
  }

  const amounts = extractAmounts(folded);
  const dates = extractDates(folded);
  const documents = extractDocuments(folded);
  const boletos = extractBoletos(folded);
  const pixKeys = extractPixKeys(folded);
  const { beneficiaryNames, payerNames } = extractNames(folded);

  const paymentMethods = METHOD_HINTS.filter(([re]) => re.test(folded)).map(
    ([, hint]) => hint,
  );

  const tokens = buildTokenIndex(normalize(folded).split(" ").filter(Boolean));

  return {
    folded,
    tokens,
    amounts,
    dates,
    documents,
    pixKeys,
    boletos,
    endToEndIds: extractEndToEndIds(folded),
    agencies: extractAll(AGENCY_RE, folded),
    accounts: extractAll(ACCOUNT_RE, folded),
    beneficiaryNames,
    payerNames,
    paymentMethods,
    documentNumbers: extractAll(DOC_NUMBER_RE, folded),
    isEmpty:
      amounts.length === 0 &&
      dates.length === 0 &&
      documents.length === 0 &&
      boletos.length === 0 &&
      tokens.size < 3,
  };
}

/** Valor mais provável do pagamento — usado em logs e na UI. */
export function primaryAmount(facts: ReceiptFacts): number | undefined {
  return facts.amounts[0]?.value;
}

/** Data mais provável do pagamento. */
export function primaryDate(facts: ReceiptFacts): Date | undefined {
  return facts.dates[0]?.date;
}
