/**
 * Leitura de NF, boleto e fatura para o lançamento de contas a pagar e a
 * receber. O que a IA (ou o XML da NF-e) devolve passa por aqui antes de
 * chegar ao formulário:
 *
 *   • o que tem dígito verificador (linha digitável, chave de acesso,
 *     CNPJ/CPF) prevalece sobre o que a IA leu;
 *   • a contraparte é a parte que não é a própria empresa;
 *   • a forma de pagamento só sai de evidência (linha digitável, Pix, XML);
 *   • cada conferência vira uma linha, e a confiança é a fração das que
 *     passaram, não um número que a IA declara.
 *
 * Puro, sem I/O: `npm run check:document-reading` testa direto.
 */
import currency from "currency.js";
import { parseBoleto, type ParsedBoleto } from "./boleto";
import {
  cnpjRoot,
  extractBoletos,
  isValidCNPJ,
  isValidCPF,
  toBarcode,
} from "./matching/brazilian";
import {
  accessKeyParts,
  isValidAccessKey,
} from "./reimbursement/receiptChecks";

/** Muda quando o prompt muda: o registro da leitura diz com qual foi feita. */
export const PROMPT_VERSION = "2026-11-10";

export type DocumentKind =
  | "nfe"
  | "nfse"
  | "boleto"
  | "fatura"
  | "recibo"
  | "outro";
export type ReadPaymentMethod =
  | "pix"
  | "boleto"
  | "transfer"
  | "credit_card"
  | "cash";

export interface Party {
  name: string | null;
  document: string | null;
}

export interface Withholdings {
  iss: number | null;
  irrf: number | null;
  pis: number | null;
  cofins: number | null;
  csll: number | null;
  inss: number | null;
}

/** O que a IA devolve; o esquema da chamada espelha esta interface. */
export interface RawReading {
  documentType: DocumentKind | null;
  summary: string | null;
  /** Emitente, prestador, beneficiário: quem recebe o dinheiro. */
  issuer: Party | null;
  /** Destinatário, tomador, pagador: quem paga. */
  payer: Party | null;
  documentNumber: string | null;
  accessKey: string | null;
  issueDate: string | null;
  dueDate: string | null;
  /** AAAA-MM, só quando o documento diz "referência" ou "competência". */
  referenceMonth: string | null;
  totalAmount: number | null;
  amountDue: number | null;
  withholdings: Withholdings | null;
  barcode: string | null;
  pixCode: string | null;
  installments:
    | { number: number | null; dueDate: string | null; amount: number | null }[]
    | null;
  /** Só o XML informa a forma de pagamento de fato (tPag). */
  paymentHint?: ReadPaymentMethod | null;
}

export interface ReadingCheck {
  label: string;
  ok: boolean;
}

export interface DocumentReading {
  source: "xml" | "ai";
  model: string | null;
  promptVersion: string;
  documentType: DocumentKind | null;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  documentNumber: string | null;
  accessKey: string | null;
  issueDate: string | null;
  dueDate: string | null;
  competence: string | null;
  /** Do lançamento: o total quando há parcelas, senão o valor a pagar. */
  amount: number | null;
  grossAmount: number | null;
  withholdings: Partial<Record<keyof Withholdings, number>> | null;
  barcode: string | null;
  pixCode: string | null;
  paymentMethod: ReadPaymentMethod | null;
  /** Só com duas ou mais; ordenadas por vencimento. */
  installments: { dueDate: string; amount: number }[];
  /** Linhas padronizadas para o campo "Lido do documento". */
  notes: string | null;
  checks: ReadingCheck[];
  /** 0 a 100: fração das conferências que passaram. */
  confidence: number;
}

export interface ReadingContext {
  type: "payable" | "receivable";
  /** CNPJ/CPF da própria empresa, só dígitos. */
  companyDocument?: string | null;
  /** Texto embutido do PDF ou do XML: de onde saem linha e chave exatas. */
  text?: string;
  model?: string | null;
  today?: Date;
}

// ── Primitivas ────────────────────────────────────────────────────────────────

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const brDay = (iso: string) => iso.split("-").reverse().join("/");
const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    n,
  );
const sameCents = (a: number, b: number) =>
  currency(a).intValue === currency(b).intValue;

function isoDay(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])
    ? `${m[1]}-${m[2]}-${m[3]}`
    : null;
}

function money(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? currency(n).value
    : null;
}

function validDocument(d: string) {
  return d.length === 14
    ? isValidCNPJ(d)
    : d.length === 11
      ? isValidCPF(d)
      : false;
}

/** Chave de NF-e/NFC-e: DV, UF existente e modelo 55 ou 65. */
export function isAccessKey(key: string) {
  const uf = Number(key.slice(0, 2));
  const model = key.slice(20, 22);
  return (
    isValidAccessKey(key) &&
    uf >= 11 &&
    uf <= 53 &&
    (model === "55" || model === "65")
  );
}

/** Boleto válido; no bancário, a moeda (4º dígito) é 9, o que o separa da chave. */
function validBoleto(
  raw: string | null | undefined,
  today: Date,
): ParsedBoleto | null {
  const d = digits(raw);
  if (!d) return null;
  const parsed = parseBoleto(d, today);
  if (!parsed.valid) return null;
  if (parsed.kind === "bank" && d[3] !== "9") return null;
  return parsed;
}

// ── Texto embutido ────────────────────────────────────────────────────────────

const PIX_RE = /000201\S*?br\.gov\.bcb\.pix\S*?6304[0-9a-f]{4}/i;

/** Linha digitável, chave de acesso e Pix encontrados no texto do arquivo. */
export function findInText(text: string, today = new Date()) {
  const barcode =
    extractBoletos(text.toLowerCase()).find(
      (b) => !isAccessKey(b) && validBoleto(b, today),
    ) ?? null;
  const accessKey =
    [...text.matchAll(/(?<!\d)(?:\d{4}[\s.]?){10}\d{4}(?!\d)/g)]
      .map((m) => digits(m[0]))
      .find(isAccessKey) ?? null;
  const pixCode = text.match(PIX_RE)?.[0] ?? null;
  return { barcode, accessKey, pixCode };
}

// ── Conferência ───────────────────────────────────────────────────────────────

const WITHHOLDING_LABEL: Record<keyof Withholdings, string> = {
  iss: "ISS",
  irrf: "IRRF",
  pis: "PIS",
  cofins: "COFINS",
  csll: "CSLL",
  inss: "INSS",
};

const KIND_LABEL: Partial<Record<DocumentKind, string>> = {
  nfe: "NF-e",
  nfse: "NFS-e",
  fatura: "Fatura",
  boleto: "Boleto",
  recibo: "Recibo",
};

function cleanParty(p: Party | null | undefined): Party | null {
  const name = p?.name?.trim() || null;
  const document = digits(p?.document) || null;
  return name || document ? { name, document } : null;
}

export function reconcile(
  raw: RawReading,
  source: "xml" | "ai",
  ctx: ReadingContext,
): DocumentReading {
  const today = ctx.today ?? new Date();
  const checks: ReadingCheck[] = [];
  const check = (label: string, ok: boolean) => checks.push({ label, ok });
  const hints = ctx.text
    ? findInText(ctx.text, today)
    : { barcode: null, accessKey: null, pixCode: null };
  const who = ctx.type === "payable" ? "Fornecedor" : "Cliente";

  // ── Partes: a contraparte é quem não é a própria empresa ──
  const company = digits(ctx.companyDocument);
  const isOwn = (d: string | null) =>
    !!company &&
    !!d &&
    (d.length === 14 && company.length === 14
      ? cnpjRoot(d) === cnpjRoot(company)
      : d === company);
  const parties = [cleanParty(raw.issuer), cleanParty(raw.payer)];
  for (const p of parties) {
    if (p?.document && !validDocument(p.document)) {
      check(
        `CNPJ/CPF ${p.document} não fecha o dígito verificador: descartado`,
        false,
      );
      p.document = null;
    }
  }
  const [issuer, payer] = parties;
  const [main, other] =
    ctx.type === "payable" ? [issuer, payer] : [payer, issuer];
  let counterparty: Party | null = null;
  if (main && !isOwn(main.document)) counterparty = { ...main };
  else if (main && other && !isOwn(other.document)) {
    counterparty = { ...other };
    check(
      `O CNPJ da própria empresa não foi usado como ${who.toLowerCase()}`,
      true,
    );
  }

  // ── Chave de acesso: número da nota, CNPJ do emitente e mês de emissão ──
  const aiKey = digits(raw.accessKey);
  const accessKey =
    [aiKey, hints.accessKey].find((k) => k && isAccessKey(k)) || null;
  let documentNumber = raw.documentNumber?.trim().slice(0, 60) || null;
  if (accessKey) {
    const parts = accessKeyParts(accessKey);
    check("Chave de acesso válida", true);
    if (
      documentNumber &&
      digits(documentNumber).replace(/^0+/, "") !== parts.number
    ) {
      check(
        `Nº ${documentNumber} difere da chave de acesso: vale ${parts.number}`,
        false,
      );
    }
    documentNumber = parts.number;
    const emitterIsCounterparty = ctx.type === "payable" && !isOwn(parts.cnpj);
    if (emitterIsCounterparty) {
      if (!counterparty)
        counterparty = { name: issuer?.name ?? null, document: parts.cnpj };
      else if (counterparty.document && counterparty.document !== parts.cnpj) {
        check(
          `CNPJ do ${who.toLowerCase()} difere do da chave de acesso: vale o da chave`,
          false,
        );
      }
      counterparty.document = parts.cnpj;
    }
  } else if (aiKey) {
    check(
      "Chave de acesso lida não fecha o dígito verificador: descartada",
      false,
    );
  }

  if (counterparty?.document)
    check(`CNPJ/CPF do ${who.toLowerCase()} válido`, true);
  else if (!counterparty) check(`${who} não identificado`, false);

  // ── Linha digitável: valor e vencimento do código prevalecem ──
  const aiBoleto = validBoleto(raw.barcode, today);
  const textBoleto = hints.barcode ? validBoleto(hints.barcode, today) : null;
  // A linha impressa (47/48) é mais legível que o código de 44: fica com ela
  // quando é o mesmo boleto do texto.
  const boleto =
    aiBoleto &&
    (!textBoleto || toBarcode(aiBoleto.digits) === textBoleto.digits)
      ? aiBoleto
      : textBoleto;
  if (boleto) check("Linha digitável válida (dígitos verificadores)", true);
  else if (raw.barcode) {
    check(
      "Linha digitável lida não fecha os dígitos verificadores: descartada",
      false,
    );
  }

  // ── Parcelas ──
  const installments = (raw.installments ?? [])
    .map((i) => ({ dueDate: isoDay(i.dueDate), amount: money(i.amount) }))
    .filter(
      (i): i is { dueDate: string; amount: number } =>
        !!i.dueDate && !!i.amount,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 120);
  const multi = installments.length >= 2;

  // ── Valores ──
  const total = money(raw.totalAmount);
  const withholdings = Object.fromEntries(
    Object.entries(raw.withholdings ?? {})
      .map(([k, v]) => [k, money(v as number | null)])
      .filter(([, v]) => v != null),
  ) as Partial<Record<keyof Withholdings, number>>;
  const withheld = Object.values(withholdings).reduce(
    (sum, v) => sum.add(v),
    currency(0),
  );
  const due = money(raw.amountDue);
  const net =
    due ??
    (total && withheld.value > 0
      ? money(currency(total).subtract(withheld).value)
      : null);
  if (total && due && withheld.value > 0) {
    check(
      "Total menos retenções bate com o valor líquido",
      sameCents(currency(total).subtract(withheld).value, due),
    );
  }
  const documentAmount = net ?? total;

  let amount: number | null;
  if (multi) {
    const sum = installments.reduce(
      (s, i) => s.add(i.amount),
      currency(0),
    ).value;
    if (documentAmount) {
      check(
        "Soma das parcelas bate com o total do documento",
        sameCents(sum, documentAmount),
      );
    }
    if (boleto?.amount) {
      check(
        "Valor da linha digitável confere com uma das parcelas",
        installments.some((i) => sameCents(i.amount, boleto.amount!)),
      );
    }
    amount = sum;
  } else if (boleto?.amount) {
    if (documentAmount) {
      const same = sameCents(documentAmount, boleto.amount);
      check(
        same
          ? "Valor confere com a linha digitável"
          : `Valor do documento (${brl(documentAmount)}) difere da linha digitável (${brl(boleto.amount)}): vale a linha`,
        same,
      );
    }
    amount = boleto.amount;
  } else {
    amount = documentAmount ?? installments[0]?.amount ?? null;
  }
  if (!amount) check("Valor não encontrado", false);

  // ── Datas ──
  const issueDate = isoDay(raw.issueDate);
  let dueDate = multi
    ? installments[0].dueDate
    : (isoDay(raw.dueDate) ?? installments[0]?.dueDate ?? null);
  const boletoDue = boleto?.dueDate ? ymd(boleto.dueDate) : null;
  if (boletoDue && multi) {
    check(
      "Vencimento da linha digitável confere com uma das parcelas",
      installments.some((i) => i.dueDate === boletoDue),
    );
  } else if (boletoDue) {
    if (dueDate) {
      const same = dueDate === boletoDue;
      check(
        same
          ? "Vencimento confere com a linha digitável"
          : `Vencimento impresso (${brDay(dueDate)}) difere da linha digitável (${brDay(boletoDue)}): vale a linha`,
        same,
      );
    }
    dueDate = boletoDue;
  }
  if (!dueDate) check("Vencimento não encontrado", false);
  else if (issueDate && dueDate < issueDate)
    check("Vencimento anterior à emissão", false);

  // ── Competência: referência impressa > mês da chave > mês de emissão ──
  const reference = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.referenceMonth ?? "")
    ? raw.referenceMonth
    : null;
  const keyMonth =
    accessKey && /^(0[1-9]|1[0-2])$/.test(accessKey.slice(4, 6))
      ? `20${accessKey.slice(2, 4)}-${accessKey.slice(4, 6)}`
      : null;
  const competence = reference ?? keyMonth ?? issueDate?.slice(0, 7) ?? null;

  // ── Forma de pagamento: só com evidência ──
  const aiPix =
    raw.pixCode && PIX_RE.test(raw.pixCode.replace(/\s/g, ""))
      ? raw.pixCode.replace(/\s/g, "")
      : null;
  const pixCode = aiPix ?? hints.pixCode;
  const paymentMethod: ReadPaymentMethod | null = boleto
    ? "boleto"
    : pixCode
      ? "pix"
      : (raw.paymentHint ?? null);

  // ── Observações padronizadas ──
  const summary = raw.summary?.trim().slice(0, 80) || null;
  const lines: string[] = [];
  if (summary) lines.push(summary);
  const kind = raw.documentType ? KIND_LABEL[raw.documentType] : undefined;
  if (kind && documentNumber) {
    lines.push(
      `${kind} nº ${documentNumber}${issueDate ? ` · emitida em ${brDay(issueDate)}` : ""}`,
    );
  }
  if (accessKey) lines.push(`Chave de acesso: ${accessKey}`);
  if (withheld.value > 0) {
    const list = Object.entries(withholdings)
      .map(
        ([k, v]) => `${WITHHOLDING_LABEL[k as keyof Withholdings]} ${brl(v)}`,
      )
      .join(" · ");
    lines.push(
      `Retenções: ${list}${total ? ` (bruto ${brl(total)}${net ? `, líquido ${brl(net)}` : ""})` : ""}`,
    );
  }
  if (multi) {
    lines.push(
      `Parcelas: ${installments.map((i) => `${brDay(i.dueDate)} ${brl(i.amount)}`).join(" · ")}`,
    );
  }
  if (pixCode) lines.push(`Pix copia e cola: ${pixCode}`);

  const passed = checks.filter((c) => c.ok).length;
  return {
    source,
    model: source === "ai" ? (ctx.model ?? null) : null,
    promptVersion: PROMPT_VERSION,
    documentType: raw.documentType ?? null,
    counterpartyName: counterparty?.name ?? null,
    counterpartyDocument: counterparty?.document ?? null,
    documentNumber,
    accessKey,
    issueDate,
    dueDate,
    competence,
    amount,
    grossAmount: total,
    withholdings: withheld.value > 0 ? withholdings : null,
    barcode: boleto?.digits ?? null,
    pixCode,
    paymentMethod,
    installments: multi ? installments : [],
    notes: lines.length ? lines.join("\n") : null,
    checks,
    confidence: checks.length ? Math.round((100 * passed) / checks.length) : 0,
  };
}

/** O que fica gravado no lançamento para medir o acerto por campo depois. */
export function readingSnapshot(r: DocumentReading) {
  return {
    source: r.source,
    model: r.model,
    promptVersion: r.promptVersion,
    confidence: r.confidence,
    failedChecks: r.checks.filter((c) => !c.ok).map((c) => c.label),
    fields: {
      counterpartyDocument: r.counterpartyDocument,
      documentNumber: r.documentNumber,
      accessKey: r.accessKey,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      competence: r.competence,
      amount: r.amount,
      barcode: r.barcode,
      paymentMethod: r.paymentMethod,
      installments: r.installments.length,
    },
  };
}

// ── XML da NF-e: leitura exata, sem IA ────────────────────────────────────────

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const TAG_PAYMENT: Record<string, ReadPaymentMethod> = {
  "01": "cash",
  "03": "credit_card",
  "15": "boleto",
  "16": "transfer",
  "17": "pix",
  "18": "transfer",
};

/** NF-e/NFC-e (com ou sem `nfeProc`). Outro XML (NFS-e etc.): null. */
export function parseNfeXml(xml: string): RawReading | null {
  const id = xml.match(/<(?:\w+:)?infNFe\b[^>]*\bId="NFe(\d{44})"/);
  if (!id) return null;
  const block = (src: string | null, name: string) =>
    src?.match(
      new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`),
    )?.[1] ?? null;
  const all = (src: string | null, name: string) =>
    [
      ...(src ?? "").matchAll(
        new RegExp(
          `<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
          "g",
        ),
      ),
    ].map((m) => m[1]);
  const num = (s: string | null) =>
    s != null && s.trim() !== "" ? Number(s) : null;
  const party = (b: string | null): Party | null =>
    b
      ? {
          name: block(b, "xNome") ? decodeXml(block(b, "xNome")!.trim()) : null,
          document: block(b, "CNPJ") ?? block(b, "CPF"),
        }
      : null;

  const ide = block(xml, "ide");
  const total = block(xml, "ICMSTot");
  const ret = block(xml, "retTrib");
  const cobr = block(xml, "cobr");
  const products = all(xml, "xProd").map((s) => decodeXml(s.trim()));
  const tPag = block(block(xml, "pag"), "tPag");

  return {
    documentType: "nfe",
    summary: products.length
      ? `${products[0]}${products.length > 1 ? ` e mais ${products.length - 1} ite${products.length > 2 ? "ns" : "m"}` : ""}`
      : null,
    issuer: party(block(xml, "emit")),
    payer: party(block(xml, "dest")),
    documentNumber: block(ide, "nNF"),
    accessKey: id[1],
    issueDate:
      (block(ide, "dhEmi") ?? block(ide, "dEmi"))?.slice(0, 10) ?? null,
    dueDate: null,
    referenceMonth: null,
    totalAmount: num(block(total, "vNF")),
    amountDue: num(block(block(cobr, "fat"), "vLiq")),
    withholdings: {
      iss: num(block(block(xml, "ISSQNtot"), "vISSRet")),
      irrf: num(block(ret, "vIRRF")),
      pis: num(block(ret, "vRetPIS")),
      cofins: num(block(ret, "vRetCOFINS")),
      csll: num(block(ret, "vRetCSLL")),
      inss: num(block(ret, "vRetPrev")),
    },
    barcode: null,
    pixCode: null,
    installments: all(cobr, "dup").map((d) => ({
      number: num(block(d, "nDup")),
      dueDate: block(d, "dVenc"),
      amount: num(block(d, "vDup")),
    })),
    paymentHint: tPag ? (TAG_PAYMENT[tPag] ?? null) : null,
  };
}
