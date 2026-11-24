import type jsPDF from "jspdf";
import type { Row } from "exceljs";

// jspdf + autotable pesam ~150 KB gz: carregam só quando um PDF é gerado,
// fora do bundle inicial da página.
export const loadPdf = async () => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
};
import currency from "currency.js";
import { Transaction, Entity, ChartAccount, CostCenter } from "@/lib/types";
import { withPayeeAccount } from "@/lib/entityBankAccounts";
import { format, startOfDay } from "date-fns";
import { comprovanteProxyUrl, formatCurrency } from "@/lib/utils";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import {
  DRE_MIN_COVERAGE,
  DreRegime,
  DreReport,
  DreRow,
  DRE_GROUP_LABEL,
  dreAmount,
  effectiveDate,
  groupResolver,
} from "@/lib/chartOfAccounts";
import {
  CashFlowReport,
  FlowLine,
  Granularity,
  GRANULARITY_LABEL,
  PaymentLine,
  PaymentsReport,
  STAGE_INFO,
  isProjection,
  lineSituation,
  periodSlug,
  periodText,
  situationOf,
  toCsv,
} from "@/lib/reports";
import {
  MATRIX_ROWS,
  shownNodes,
  type CashMatrix,
  type MatrixNode,
  type MatrixSection,
} from "@/lib/cashMatrix";
import {
  buildSynthesis,
  proofNote,
  type ProofState,
} from "@/lib/cashSynthesis";

/**
 * O que a tela mostrava quando o arquivo foi gerado. `filters` vai impresso
 * no cabeçalho: quem recebe o arquivo precisa saber o recorte sem perguntar.
 */
export interface ReportContext {
  start: Date;
  end: Date;
  companyName: string;
  /** Ex.: "Realizado + previsto  ·  Centro de custo: Obras". */
  filters?: string;
  entities?: Entity[];
  accounts?: ChartAccount[];
  costCenters?: CostCenter[];
  costCenterIds?: string[];
}

/** O que o arquivo do fluxo precisa dizer sobre o saldo inicial. */
export type CashFlowContext = ReportContext & {
  companyCnpj?: string;
  granularity: Granularity;
  /** Conferência do saldo final com o banco. */
  proof: ProofState;
  /** A matriz aberta na tela, se houver. */
  matrix?: CashMatrix;
  opening:
    | { source: "calculated" }
    | { source: "typed"; calculated: number | null }
    /** Recorte ou sem saldo de referência: o saldo é só o acumulado. */
    | { source: "none" };
};

const filterSuffix = (ctx: ReportContext) =>
  ctx.filters ? `  ·  ${ctx.filters}` : "";

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const PAYMENT_METHOD_TEXT: Record<string, string> = {
  pix: "PIX",
  boleto: "Boleto",
  transfer: "Transferência",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
};

/** Cadastros do arquivo, resolvidos uma vez: nomes em vez de códigos. */
export const lineLookups = (ctx: ReportContext) => {
  const entityById = new Map((ctx.entities ?? []).map((e) => [e.id, e]));
  const accountById = new Map((ctx.accounts ?? []).map((a) => [a.id, a]));
  const ccName = new Map((ctx.costCenters ?? []).map((c) => [c.id, c.name]));
  const entityOf = (t: Transaction) =>
    t.entityId ? entityById.get(t.entityId) : undefined;
  const partyOf = (t: Transaction) =>
    entityOf(t)?.name || t.supplierOrClient || "";
  return {
    partyOf,
    documentOf: (t: Transaction) => formatCpfCnpj(entityOf(t)?.document ?? ""),
    accountOf: (t: Transaction) => {
      const a = t.accountId ? accountById.get(t.accountId) : undefined;
      return a ? `${a.code} ${a.name}` : "";
    },
    costCentersOf: (t: Transaction) => {
      const split = t.costCenterAllocation ?? [];
      if (split.length > 1) {
        return split
          .map(
            (a) =>
              `${ccName.get(a.costCenterId) ?? a.costCenterId} (${a.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`,
          )
          .join(", ");
      }
      const id = split[0]?.costCenterId ?? t.costCenterId;
      return id ? (ccName.get(id) ?? id) : "";
    },
    competenceOf: (t: Transaction) =>
      t.competence
        ? `${t.competence.slice(5)}/${t.competence.slice(0, 4)}`
        : "",
    methodOf: (t: Transaction) =>
      t.paymentMethod ? (PAYMENT_METHOD_TEXT[t.paymentMethod] ?? "") : "",
    /** Por dia e, no dia, por favorecido: a mesma ordem em PDF e Excel. */
    sort: (lines: FlowLine[]) =>
      [...lines].sort(
        (a, b) =>
          startOfDay(a.date).getTime() - startOfDay(b.date).getTime() ||
          partyOf(a.tx).localeCompare(partyOf(b.tx), "pt-BR", {
            sensitivity: "base",
          }),
      ),
  };
};

/** Avisos impressos no arquivo: quem recebe não viu a tela. */
export const cashFlowNotes = (report: CashFlowReport, ctx: CashFlowContext) => {
  const { inflow, outflow, lines } = report.pending;
  const pendingText = [
    outflow > 0 ? `${formatCurrency(outflow)} a pagar` : null,
    inflow > 0 ? `${formatCurrency(inflow)} a receber` : null,
  ]
    .filter(Boolean)
    .join(" e ");
  return [
    ...(ctx.opening.source === "typed"
      ? [
          `Saldo inicial informado manualmente${
            ctx.opening.calculated !== null
              ? `; o calculado pelo sistema é ${formatCurrency(ctx.opening.calculated)}`
              : ""
          }.`,
        ]
      : []),
    ...(ctx.opening.source === "none"
      ? [
          "Sem saldo inicial: os valores mostram o acumulado deste recorte, não o saldo das contas.",
        ]
      : []),
    ...(lines.length > 0
      ? [
          `Fora do saldo: ${lines.length} ${lines.length === 1 ? "lançamento vencido" : "lançamentos vencidos"} sem baixa (${pendingText}).`,
        ]
      : []),
    ...(report.lines.some((l) => l.late)
      ? ["Vencidos a pagar em aberto entram na data de hoje."]
      : []),
  ];
};

/** A síntese que PDF e Excel mostram, com os mesmos números. */
export const synthesisOf = (report: CashFlowReport, ctx: CashFlowContext) =>
  buildSynthesis(report, {
    costCenters: ctx.costCenters ?? [],
    accounts: ctx.accounts ?? [],
    entities: ctx.entities ?? [],
    costCenterIds: ctx.costCenterIds,
    hasReceipt: (t) => !!receiptUrl(t),
  });

// ── Documentos do lançamento ────────────────────────────────────────────────

const invoicesOf = (t: Transaction) =>
  (t.attachments ?? []).filter((a) => a.category === "invoice" && !!a.url);

/** Caminho no Storage dentro da URL pública de download. */
const storagePathOf = (url: string) => {
  const m = url.match(/\/o\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

/** Arquivos do lançamento dentro do pacote; null = o download falhou. */
interface PackagedFiles {
  invoices: (string | null)[];
  receipt?: string | null;
}

export const lineDescription = (line: FlowLine) =>
  isProjection(line.tx)
    ? `${line.tx.description} (recorrência)`
    : line.tx.description || "-";

/** Saída entre parênteses, como na DRE publicada. */
const formatDreValue = (v: number) =>
  v < 0
    ? `(${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(-v)})`
    : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(v);

const formatAv = (v: number, base: number) =>
  base > 0
    ? `${((v / base) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : "";

/** Opções da DRE que mudam o que o arquivo precisa avisar. */
export type DreExportContext = ReportContext & {
  regime: DreRegime;
  /** A consulta por competência falhou: o arquivo sai sem parte dos lançamentos. */
  competenceMissing?: boolean;
};

/**
 * Notas impressas no arquivo. Os avisos de completude vêm primeiro: quem
 * recebe o PDF não viu a tela e não pode descobrir sozinho que falta algo.
 */
const dreNotes = (dre: DreReport<Transaction>, ctx: DreExportContext) => [
  ...(dre.coverage < DRE_MIN_COVERAGE
    ? [
        `ATENÇÃO: só ${formatPercentText(dre.coverage)} do movimento do período tem conta contábil. O resultado das contas classificadas não representa o período; o resultado com os lançamentos sem conta está na última linha.`,
      ]
    : []),
  ...(ctx.competenceMissing
    ? [
        "ATENÇÃO: lançamentos com competência no período e vencimento ou pagamento fora dele não foram incluídos (consulta por competência indisponível).",
      ]
    : []),
  ctx.regime === "cash"
    ? "Regime de caixa: só o que foi pago ou recebido, no mês da baixa. Rejeitadas não entram."
    : "Regime de competência: o mês de competência do lançamento; sem competência, a data efetiva (pagamento se pago, senão vencimento). Rejeitadas não entram.",
  dre.base > 0
    ? "AV % (análise vertical): participação de cada linha sobre a receita líquida do período. Valores entre parênteses são saídas."
    : "AV % indisponível: não há receita líquida classificada no período. Valores entre parênteses são saídas.",
  ...(dre.unclassifiedCount > 0
    ? [
        `${dre.unclassifiedCount} lançamento(s) sem conta contábil aparecem em linha própria e não entram nos grupos da DRE.`,
      ]
    : []),
];

const formatPercentText = (v: number) =>
  `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Lançamentos que formam a DRE, cada um uma vez, em ordem de data. */
const dreSources = (dre: DreReport<Transaction>) => {
  const seen = new Set<string>();
  return dre.rows
    .filter((r) => r.kind === "group" || r.kind === "info")
    .flatMap((r) => r.sources ?? [])
    .filter((t) => !seen.has(t.id) && !!seen.add(t.id))
    .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime());
};

const dreRowLabel = (r: DreRow<unknown>) => {
  if (r.kind === "account") {
    return `${"    ".repeat(Math.max(r.level - 1, 0))}${r.code}  ${r.label}`;
  }
  if (r.kind === "info") return `    ${r.label}`;
  if (r.kind === "subtotal" || r.kind === "result") return `(=) ${r.label}`;
  return r.label;
};

const fontCache = new Map<string, string>();

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const REPORT_FONT = "IBMPlexSans";
const FONT_FILES = {
  normal: "IBMPlexSans-Regular.ttf",
  bold: "IBMPlexSans-SemiBold.ttf",
} as const;

type ReportFont = typeof REPORT_FONT | "helvetica";

export const ensureReportFont = async (doc: jsPDF): Promise<ReportFont> => {
  let font: ReportFont = REPORT_FONT;
  try {
    await Promise.all(
      Object.entries(FONT_FILES).map(async ([style, file]) => {
        if (!fontCache.has(file)) {
          const res = await fetch(`/fonts/pdf/${file}`);
          if (!res.ok) throw new Error(`Falha ao carregar a fonte ${file}`);
          fontCache.set(file, arrayBufferToBase64(await res.arrayBuffer()));
        }
        doc.addFileToVFS(file, fontCache.get(file)!);
        doc.addFont(file, REPORT_FONT, style, "Identity-H");
      }),
    );
  } catch (error) {
    console.warn("Fonte do relatório indisponível. Usando a padrão.", error);
    font = "helvetica";
  }
  doc.setFont(font, "normal");
  doc.setCharSpace(0);
  return font;
};

// ── Pagamentos ───────────────────────────────────────────────────────────────

export type PaymentsExportContext = ReportContext & {
  type: Transaction["type"];
  /** Entidade filtrada: nome e documento vão no cabeçalho. */
  entity?: Entity;
  /** Nome da conta da entidade que recebeu; ausente quando ela só tem uma. */
  accountOf?: (t: Transaction) => string;
  /** Anexa os comprovantes ao PDF. */
  withReceipts?: boolean;
  onReceiptProgress?: (current: number, total: number) => void;
};

type PaymentKey =
  | "date"
  | "description"
  | "party"
  | "document"
  | "account"
  | "amount"
  | "receipt";

const paymentColumns = (
  ctx: PaymentsExportContext,
): { key: PaymentKey; header: string; width: number }[] => {
  const payable = ctx.type === "payable";
  return [
    { key: "date", header: payable ? "Pago em" : "Recebido em", width: 12 },
    { key: "description", header: "Descrição", width: 44 },
    ...(ctx.entity
      ? []
      : [
          {
            key: "party" as const,
            header: payable ? "Favorecido" : "Cliente",
            width: 30,
          },
        ]),
    { key: "document", header: "Nº documento", width: 16 },
    ...(ctx.accountOf
      ? [{ key: "account" as const, header: "Conta", width: 22 }]
      : []),
    {
      key: "amount",
      header: payable ? "Valor pago" : "Valor recebido",
      width: 15,
    },
    { key: "receipt", header: "Comprovante", width: 13 },
  ];
};

const paymentCell = (
  key: PaymentKey,
  l: PaymentLine,
  ctx: PaymentsExportContext,
): string => {
  if (key === "date") return format(l.date, "dd/MM/yyyy");
  if (key === "description") return l.tx.description || "-";
  if (key === "party") return l.tx.supplierOrClient || "-";
  if (key === "document") return l.tx.documentNumber || "";
  if (key === "account") return ctx.accountOf?.(l.tx) ?? "";
  if (key === "amount") return formatCurrency(l.amount);
  return "";
};

const paymentsTitle = (ctx: PaymentsExportContext) =>
  ctx.type === "payable" ? "Pagamentos realizados" : "Recebimentos";

const paymentsHeader = (ctx: PaymentsExportContext) => [
  ctx.companyName,
  ...(ctx.entity
    ? [
        `${ctx.type === "payable" ? "Favorecido" : "Cliente"}: ${ctx.entity.name}${
          ctx.entity.document
            ? `  ·  ${formatCpfCnpj(ctx.entity.document)}`
            : ""
        }`,
      ]
    : []),
  `Período: ${periodText(ctx.start, ctx.end)}${filterSuffix(ctx)}`,
];

const paymentsFile = (ctx: PaymentsExportContext, ext: string) => {
  const who = ctx.entity
    ? `_${ctx.entity.name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 40)}`
    : "";
  return `${ctx.type === "payable" ? "pagamentos" : "recebimentos"}${who}_${periodSlug(ctx.start, ctx.end)}.${ext}`;
};

/** Arquivo do comprovante: o caminho no Storage (via proxy) ou a URL antiga. */
export const receiptUrl = (t: Transaction) =>
  t.comprovanteStoragePath
    ? comprovanteProxyUrl(t.comprovanteStoragePath, "inline")
    : t.comprovanteUrl;

/** A fonte padrão do pdf-lib só tem Latin-1. */
const latin1 = (s: string) => s.replace(/[^\x20-\xff]/g, " ");

/**
 * Comprovantes no fim do PDF, cada um com "Anexo N" no rodapé. PDF entra
 * página a página; JPG/PNG numa página A4. Outro formato ou falha de
 * download conta em `failed` e o resto segue.
 */
async function appendReceipts(
  pdf: ArrayBuffer,
  lines: PaymentLine[],
  numberOf: (l: PaymentLine) => number,
  onProgress?: (current: number, total: number) => void,
) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const out = await PDFDocument.load(pdf);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const [A4W, A4H] = [595.28, 841.89];
  const failed: string[] = [];
  const failedName = (l: PaymentLine) =>
    `Anexo ${numberOf(l)}: ${l.tx.description ?? "sem descrição"}`;
  for (const [index, l] of lines.entries()) {
    onProgress?.(index + 1, lines.length);
    const caption = latin1(
      `Anexo ${numberOf(l)}  -  ${format(l.date, "dd/MM/yyyy")}  -  ${formatCurrency(l.amount)}  -  ${l.tx.description ?? ""}`,
    ).slice(0, 120);
    try {
      const res = await fetch(receiptUrl(l.tx)!);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      const head = String.fromCharCode(...data.slice(0, 4));
      if (head === "%PDF") {
        const src = await PDFDocument.load(data, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p, i) => {
          out.addPage(p);
          if (i === 0) p.drawText(caption, { x: 14, y: 8, size: 7, font });
        });
      } else if (head.startsWith("\x89PNG") || head.startsWith("\xff\xd8")) {
        const img = head.startsWith("\x89PNG")
          ? await out.embedPng(data)
          : await out.embedJpg(data);
        const page = out.addPage([A4W, A4H]);
        const m = 36;
        const scale = Math.min(
          (A4W - 2 * m) / img.width,
          (A4H - 2 * m - 24) / img.height,
          1,
        );
        page.drawText(caption, { x: m, y: A4H - m, size: 9, font });
        page.drawImage(img, {
          x: m,
          y: A4H - m - 16 - img.height * scale,
          width: img.width * scale,
          height: img.height * scale,
        });
      } else {
        failed.push(failedName(l));
      }
    } catch (error) {
      console.warn("Comprovante fora do PDF", l.tx.id, error);
      failed.push(failedName(l));
    }
  }
  return { bytes: await out.save(), failed };
}

// Status labels PT-BR
const STATUS_LABEL: Record<string, string> = {
  paid: "Pago",
  approved: "Aprovado",
  pending_approval: "Pend. Aprov.",
  pending_authorization: "Pend. Autor.",
  authorized: "Autorizado",
  draft: "Rascunho",
  rejected: "Rejeitado",
};

/**
 * Planilha do fluxo: datas e fórmulas de verdade, para filtrar e conferir.
 * Com `files`, as colunas de documento apontam para os arquivos do pacote;
 * sem, só dizem se o documento existe (um link pediria login).
 */
async function buildCashFlowWorkbook(
  report: CashFlowReport,
  ctx: CashFlowContext,
  files?: Map<string, PackagedFiles>,
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hebron ASEEC · Financeiro";
  workbook.created = new Date();

  const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  const DATE = "dd/mm/yyyy";
  /** O ExcelJS grava em UTC: meia-noite daqui viraria 03:00 na célula. */
  const day = (d: Date) =>
    new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const formula = (f: string, result: number) => ({ formula: f, result });
  const known = ctx.opening.source !== "none";
  const balanceLabel = known ? "Saldo" : "Acumulado";
  const look = lineLookups(ctx);
  const landscape = {
    orientation: "landscape" as const,
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  const headStyle = (row: Row) => {
    row.height = 20;
    row.eachCell((c) => {
      c.font = { bold: true, size: 10, color: { argb: "FF12161F" } };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F5F9" },
      };
      c.border = { bottom: { style: "thin", color: { argb: "FF12161F" } } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
  };

  // A ordem das abas é a da leitura: a conclusão antes dos lançamentos.
  const summary = workbook.addWorksheet("Resumo");
  const data = synthesisOf(report, ctx);

  // ── Extrato ───────────────────────────────────────────────────────────────
  const HEAD = 4;
  const sheet = workbook.addWorksheet("Extrato", {
    views: [{ state: "frozen", ySplit: HEAD, xSplit: 2 }],
    pageSetup: { ...landscape, printTitlesRow: `${HEAD}:${HEAD}` },
  });
  const columns: { header: string; width: number; numFmt?: string }[] = [
    { header: "Nº", width: 6 },
    { header: "Data", width: 12, numFmt: DATE },
    { header: "Vencimento", width: 12, numFmt: DATE },
    { header: "Descrição", width: 46 },
    { header: "Favorecido ou pagador", width: 38 },
    { header: "CNPJ/CPF", width: 20 },
    { header: "Nº documento", width: 16 },
    { header: "Centro de custo", width: 28 },
    { header: "Conta contábil", width: 28 },
    { header: "Competência", width: 13 },
    { header: "Situação", width: 22 },
    { header: "Forma de pagamento", width: 18 },
    { header: "Valor original", width: 16, numFmt: BRL },
    { header: "Entrada", width: 16, numFmt: BRL },
    { header: "Saída", width: 16, numFmt: BRL },
    { header: balanceLabel, width: 16, numFmt: BRL },
    { header: "Nota fiscal", width: 14 },
    { header: "Comprovante", width: 14 },
  ];
  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width;
  });
  sheet.getCell("A1").value = ctx.companyName;
  sheet.getCell("A1").font = { bold: true, size: 13 };
  sheet.getCell("A2").value =
    `Fluxo de caixa  ·  ${periodText(ctx.start, ctx.end)}${filterSuffix(ctx)}  ·  Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
  sheet.getCell("A2").font = { size: 9, color: { argb: "FF60636C" } };
  sheet.getCell("O3").value = known ? "Saldo inicial" : "Sem saldo inicial";
  sheet.getCell("O3").alignment = { horizontal: "right" };
  sheet.getCell("P3").value = report.opening;
  sheet.getCell("P3").numFmt = BRL;
  sheet.getRow(HEAD).values = columns.map((c) => c.header);
  headStyle(sheet.getRow(HEAD));

  const link = (path: string | null | undefined, label: string) =>
    path ? { text: label, hyperlink: path } : "não baixado";
  const first = HEAD + 1;
  let running = currency(report.opening);
  const sorted = look.sort(report.lines);
  sorted.forEach((line, i) => {
    const t = line.tx;
    const n = first + i;
    const income = t.type === "receivable";
    running = income ? running.add(line.amount) : running.subtract(line.amount);
    const invoices = invoicesOf(t);
    const packed = files?.get(t.id);
    const row = sheet.addRow([
      i + 1,
      day(line.date),
      day(t.dueDate),
      lineDescription(line),
      look.partyOf(t),
      look.documentOf(t),
      t.documentNumber ?? "",
      look.costCentersOf(t),
      look.accountOf(t),
      look.competenceOf(t),
      lineSituation(line),
      look.methodOf(t),
      t.amount,
      income ? line.amount : null,
      income ? null : line.amount,
      formula(
        `$P$3+SUM(N$${first}:N${n})-SUM(O$${first}:O${n})`,
        running.value,
      ),
      invoices.length === 0
        ? ""
        : packed
          ? link(
              packed.invoices.find(Boolean),
              invoices.length > 1 ? `${invoices.length} notas` : "Abrir",
            )
          : "Sim",
      !receiptUrl(t) ? "" : packed ? link(packed.receipt, "Abrir") : "Sim",
    ]);
    columns.forEach((c, k) => {
      const cell = row.getCell(k + 1);
      if (c.numFmt) cell.numFmt = c.numFmt;
      cell.border = { bottom: { style: "hair", color: { argb: "FFD5D7DD" } } };
      if (
        typeof cell.value === "object" &&
        cell.value &&
        "hyperlink" in cell.value
      )
        cell.font = { color: { argb: "FF202C85" }, underline: true };
    });
  });
  const last = HEAD + sorted.length;
  if (sorted.length > 0) {
    sheet.autoFilter = {
      from: { row: HEAD, column: 1 },
      to: { row: last, column: columns.length },
    };
    // SUBTOTAL: o total acompanha o filtro.
    const total = sheet.addRow([]);
    total.getCell(13).value = "Total";
    total.getCell(14).value = formula(
      `SUBTOTAL(9,N${first}:N${last})`,
      report.inflow,
    );
    total.getCell(15).value = formula(
      `SUBTOTAL(9,O${first}:O${last})`,
      report.outflow,
    );
    total.getCell(16).value = formula(
      `P3+N${last + 1}-O${last + 1}`,
      report.closing,
    );
    total.font = { bold: true };
    [14, 15, 16].forEach((c) => {
      total.getCell(c).numFmt = BRL;
      total.getCell(c).border = { top: { style: "thin" } };
    });
  }

  // ── Fluxo: a tabela da tela ───────────────────────────────────────────────
  const flow = workbook.addWorksheet("Fluxo", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { ...landscape, printTitlesRow: "1:1" },
  });
  flow.columns = [
    {
      header:
        ctx.granularity === "day" ? "Data" : GRANULARITY_LABEL[ctx.granularity],
      width: 18,
    },
    { header: "Entradas", width: 18 },
    { header: "Saídas", width: 18 },
    { header: "Resultado", width: 18 },
    { header: balanceLabel, width: 18 },
    { header: "Tem previsto", width: 14 },
  ];
  headStyle(flow.getRow(1));
  flow.addRow([
    known ? "Saldo inicial" : "Sem saldo inicial",
    null,
    null,
    null,
    report.opening,
  ]);
  report.buckets.forEach((b, i) => {
    const n = i + 3;
    const row = flow.addRow([
      // Semana e trimestre não são uma data: vão como texto.
      ctx.granularity === "day" || ctx.granularity === "month"
        ? day(b.start)
        : b.label,
      b.inflow,
      b.outflow,
      formula(`B${n}-C${n}`, b.net),
      formula(`E${n - 1}+D${n}`, b.balance),
      b.forecast ? "sim" : "",
    ]);
    row.getCell(1).numFmt = ctx.granularity === "day" ? DATE : "mmm/yyyy";
    row.getCell(1).alignment = { horizontal: "left" };
  });
  const lastBucket = report.buckets.length + 2;
  if (report.buckets.length > 0) {
    flow.addRow([
      "Total",
      formula(`SUM(B3:B${lastBucket})`, report.inflow),
      formula(`SUM(C3:C${lastBucket})`, report.outflow),
      formula(`B${lastBucket + 1}-C${lastBucket + 1}`, report.net),
      formula(`E${lastBucket}`, report.closing),
    ]).font = { bold: true };
  }
  flow.eachRow((row, n) => {
    if (n > 1) for (let c = 2; c <= 5; c++) row.getCell(c).numFmt = BRL;
  });

  // ── Resumo ────────────────────────────────────────────────────────────────
  summary.columns = [{ width: 38 }, { width: 24 }, { width: 18 }];
  const heading = (t: string) => {
    summary.addRow([]);
    summary.addRow([t]).font = { bold: true, size: 11 };
  };
  const item = (label: string, value: string | number | object) => {
    const row = summary.addRow([label, value]);
    if (typeof value !== "string") row.getCell(2).numFmt = BRL;
    return row;
  };
  summary.addRow([ctx.companyName]).font = { bold: true, size: 13 };
  item("Período", periodText(ctx.start, ctx.end));
  if (ctx.filters) item("Recorte", ctx.filters);
  item("Gerado em", format(new Date(), "dd/MM/yyyy HH:mm"));
  item("Lançamentos", String(sorted.length));
  heading("Resultado");
  const open = item("Saldo inicial", known ? report.opening : 0).number;
  item("Entradas", report.inflow);
  item("Saídas", report.outflow);
  item(
    known ? "Saldo final" : "Acumulado",
    formula(`B${open}+B${open + 1}-B${open + 2}`, report.closing),
  ).font = { bold: true };
  if (known) {
    item(
      `Menor saldo (${format(report.lowest.date, "dd/MM/yyyy")})`,
      report.lowest.balance,
    );
  }
  heading("Conferência com o banco");
  const proof = ctx.proof;
  if ("rows" in proof) {
    for (const r of proof.rows) {
      const row = item(r.name, r.balance ?? "sem extrato");
      if (r.date) {
        row.getCell(3).value = day(r.date);
        row.getCell(3).numFmt = DATE;
      }
    }
    if (proof.total !== null && proof.rows.length > 0) {
      const lastRow = summary.lastRow!.number;
      const firstRow = lastRow - proof.rows.length + 1;
      const bank = item(
        "Saldo no banco",
        formula(`SUM(B${firstRow}:B${lastRow})`, proof.total),
      );
      bank.font = { bold: true };
      item(
        "Diferença (sistema menos banco)",
        formula(`B${open + 3}-B${bank.number}`, proof.difference!),
      ).font = { bold: true };
    }
  }
  const proofText = proofNote(proof);
  if (proofText) summary.addRow([proofText]);

  heading("O que falta");
  if (data.gaps.length === 0) summary.addRow(["Nada pendente."]);
  for (const g of data.gaps) {
    const row = item(g.label, g.value);
    row.getCell(3).value = g.lines.length;
    row.getCell(3).numFmt = '0 "lanç."';
  }
  heading("Por situação (entradas menos saídas)");
  for (const s of report.byStage) {
    if (s.lines.length === 0) continue;
    item(
      STAGE_INFO[s.stage].label,
      currency(s.inflow).subtract(s.outflow).value,
    );
  }
  const notes = [
    ...cashFlowNotes(report, ctx),
    files
      ? "Notas e comprovantes estão nas pastas ao lado desta planilha: extraia o ZIP inteiro antes de abrir os links."
      : "As colunas Nota fiscal e Comprovante só indicam que o documento existe no sistema.",
    "Contém dados pessoais e bancários: envie só a quem precisa deles.",
  ];
  heading("Observações");
  notes.forEach((note) => {
    const row = summary.addRow([note]);
    summary.mergeCells(row.number, 1, row.number, 3);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.height = 15 * Math.ceil(note.length / 60);
  });

  // ── Matriz: a da tela, com fórmulas e níveis que recolhem ─────────────────
  if (ctx.matrix) addMatrixSheet(ctx.matrix);

  function addMatrixSheet(m: CashMatrix) {
    const ws = workbook.addWorksheet("Matriz", {
      views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
      pageSetup: { ...landscape, printTitlesRow: "1:2" },
      // O total de um grupo fica acima das linhas dele.
      properties: { outlineLevelRow: 1 },
    });
    ws.properties.outlineProperties = {
      summaryBelow: false,
      summaryRight: false,
    };
    const step = m.hasPlan ? 2 : 1;
    /** Coluna do período i: previsto e realizado, ou só o fluxo. */
    const colOf = (i: number) => 2 + i * step;
    const totalCol = colOf(m.buckets.length);
    const L = (c: number) => ws.getColumn(c).letter;
    const width = totalCol + (m.hasPlan ? 3 : m.hasPrevious ? 2 : 0);
    ws.getColumn(1).width = 46;
    for (let c = 2; c <= width; c++) ws.getColumn(c).width = 16;

    const h1 = ws.getRow(1);
    const h2 = ws.getRow(2);
    h1.getCell(1).value = MATRIX_ROWS[m.rows];
    m.buckets.forEach((b, i) => {
      h1.getCell(colOf(i)).value = b.label;
      if (m.hasPlan) {
        h2.getCell(colOf(i)).value = "Previsto";
        h2.getCell(colOf(i) + 1).value = "Realizado";
      }
    });
    if (m.hasPlan) {
      h1.getCell(totalCol).value = "Total";
      ["Previsto", "Realizado", "Desvio", "Desvio %"].forEach((t, k) => {
        h2.getCell(totalCol + k).value = t;
      });
      h1.getCell(totalCol).note =
        "O previsto do total vai até a data em que o arquivo foi gerado.";
    } else {
      h1.getCell(totalCol).value = "Total";
      if (m.hasPrevious) {
        h1.getCell(totalCol + 1).value = "Anterior";
        h1.getCell(totalCol + 2).value = "Variação";
      }
    }
    headStyle(h1);
    headStyle(h2);

    const finish = (row: Row, strong: boolean) => {
      for (let c = 2; c <= width; c++) row.getCell(c).numFmt = BRL;
      if (m.hasPlan) row.getCell(width).numFmt = "0.0%";
      else if (m.hasPrevious) row.getCell(width).numFmt = "0.0%";
      if (strong) row.font = { bold: true };
    };
    const totals = (
      row: Row,
      v: { total: number; planTotal: number; previous: number },
    ) => {
      const n = row.number;
      if (m.hasPlan) {
        row.getCell(totalCol).value = v.planTotal;
        row.getCell(totalCol + 1).value = formula(
          m.buckets.map((_, i) => `${L(colOf(i) + 1)}${n}`).join("+"),
          v.total,
        );
        const dev = currency(v.total).subtract(v.planTotal).value;
        row.getCell(totalCol + 2).value = formula(
          `${L(totalCol + 1)}${n}-${L(totalCol)}${n}`,
          dev,
        );
        row.getCell(totalCol + 3).value = v.planTotal
          ? formula(
              `${L(totalCol + 2)}${n}/ABS(${L(totalCol)}${n})`,
              dev / Math.abs(v.planTotal),
            )
          : null;
      } else {
        row.getCell(totalCol).value = formula(
          `SUM(${L(2)}${n}:${L(totalCol - 1)}${n})`,
          v.total,
        );
        if (m.hasPrevious) {
          row.getCell(totalCol + 1).value = v.previous;
          row.getCell(totalCol + 2).value = v.previous
            ? formula(
                `(${L(totalCol)}${n}-${L(totalCol + 1)}${n})/ABS(${L(totalCol + 1)}${n})`,
                (v.total - v.previous) / Math.abs(v.previous),
              )
            : null;
        }
      }
    };
    const numbersOf = (r: MatrixNode | MatrixSection) =>
      m.buckets.flatMap((_, i) =>
        m.hasPlan ? [r.plan[i], r.values[i]] : [r.values[i]],
      );
    const sum = (xs: number[]) =>
      xs.reduce((s, x) => s.add(x), currency(0)).value;

    if (m.buckets.length === 0) return;
    let openingRow: Row | null = null;
    if (m.closing) {
      openingRow = ws.addRow(["Saldo inicial"]);
      finish(openingRow, false);
    }

    const write = (s: MatrixSection, name: string) => {
      const head = ws.addRow([name, ...numbersOf(s)]);
      const rowOf = new Map<string, number>();
      const shown = shownNodes(m, s);
      for (const n of shown) {
        const row = ws.addRow([n.label, ...numbersOf(n)]);
        row.outlineLevel = Math.min(7, n.depth + 1);
        row.getCell(1).alignment = { indent: n.depth + 1 };
        rowOf.set(n.key, row.number);
        totals(row, n);
        finish(row, false);
      }
      // Pai por fórmula só quando os filhos somam tudo: um centro com
      // lançamento próprio mantém o valor.
      const link = (
        row: Row,
        r: MatrixNode | MatrixSection,
        kids: MatrixNode[],
      ) => {
        if (kids.length === 0 || kids.length > 200) return;
        const cells = numbersOf(r);
        const parts = kids.map(numbersOf);
        cells.forEach((v, k) => {
          if (sum(parts.map((p) => p[k])) !== v) return;
          row.getCell(2 + k).value = formula(
            `SUM(${kids.map((c) => `${L(2 + k)}${rowOf.get(c.key)}`).join(",")})`,
            v,
          );
        });
      };
      link(
        head,
        s,
        shown.filter((n) => n.depth === 0),
      );
      for (const n of shown.filter((x) => x.hasChildren)) {
        link(
          ws.getRow(rowOf.get(n.key)!),
          n,
          shown.filter((x) => x.parent === n.key),
        );
      }
      totals(head, s);
      finish(head, true);
      return head.number;
    };
    const inRow = write(m.inflow, "Entradas");
    const outRow = write(m.outflow, "Saídas");

    const netOf = (a: number, b: number) => currency(a).subtract(b).value;
    const net = ws.addRow(["Resultado"]);
    const ins = numbersOf(m.inflow);
    const outs = numbersOf(m.outflow);
    ins.forEach((v, k) => {
      net.getCell(2 + k).value = formula(
        `${L(2 + k)}${inRow}-${L(2 + k)}${outRow}`,
        netOf(v, outs[k]),
      );
    });
    totals(net, {
      total: m.netTotal,
      planTotal: netOf(m.inflow.planTotal, m.outflow.planTotal),
      previous: netOf(m.inflow.previous, m.outflow.previous),
    });
    finish(net, true);

    if (m.closing && openingRow) {
      const close = ws.addRow(["Saldo final"]);
      m.closing.forEach((v, i) => {
        const c = L(colOf(i));
        openingRow!.getCell(colOf(i)).value =
          i === 0
            ? m.opening
            : formula(`${L(colOf(i - 1))}${close.number}`, m.closing![i - 1]);
        close.getCell(colOf(i)).value = formula(
          `${c}${openingRow!.number}+${c}${net.number}`,
          v,
        );
      });
      openingRow.getCell(totalCol).value = m.opening;
      close.getCell(totalCol).value = formula(
        `${L(totalCol - 1)}${close.number}`,
        m.closing.at(-1) ?? m.opening,
      );
      finish(close, true);
    }
  }

  // ── Para onde foi ─────────────────────────────────────────────────────────
  const plain = (
    name: string,
    cols: { header: string; width: number; numFmt?: string }[],
    rows: (string | number | Date | null)[][],
    /** Colunas (1 = A) que fecham em total por fórmula. */
    totals: number[],
  ) => {
    const ws = workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { ...landscape, printTitlesRow: "1:1" },
    });
    ws.columns = cols.map(({ header, width }) => ({ header, width }));
    headStyle(ws.getRow(1));
    const format = (row: Row) =>
      cols.forEach((c, i) => {
        if (c.numFmt) row.getCell(i + 1).numFmt = c.numFmt;
      });
    rows.forEach((r) => format(ws.addRow(r)));
    const end = rows.length + 1;
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: end, column: cols.length },
    };
    const total = ws.addRow(["Total"]);
    for (const c of totals) {
      const letter = ws.getColumn(c).letter;
      total.getCell(c).value = formula(
        `SUBTOTAL(9,${letter}2:${letter}${end})`,
        rows.reduce((s, r) => s.add(Number(r[c - 1] ?? 0)), currency(0)).value,
      );
    }
    format(total);
    total.font = { bold: true };
  };

  if (data.areas.length > 0) {
    plain(
      "Centros de custo",
      [
        { header: "Área", width: 34 },
        { header: "Centro de custo", width: 38 },
        { header: "Lançamentos", width: 14 },
        { header: "Saídas", width: 18, numFmt: BRL },
      ],
      data.areas.flatMap((a) =>
        (a.children ?? [a]).map((c) => [a.label, c.label, c.count, c.value]),
      ),
      [3, 4],
    );
  }
  if (data.accounts.length > 0) {
    plain(
      "Contas contábeis",
      [
        { header: "Conta", width: 50 },
        { header: "Lançamentos", width: 14 },
        { header: "Entradas", width: 18, numFmt: BRL },
        { header: "Saídas", width: 18, numFmt: BRL },
      ],
      data.accounts.map((a) => [a.label, a.count, a.inflow, a.outflow]),
      [2, 3, 4],
    );
  }
  if (data.people.length > 0) {
    plain(
      "Pessoas físicas",
      [
        { header: "Nome", width: 44 },
        { header: "CPF", width: 18 },
        { header: "Pagamentos", width: 14 },
        { header: "Total pago", width: 18, numFmt: BRL },
        { header: "Do que se trata", width: 80 },
      ],
      data.people.map((p) => [
        p.name,
        formatCpfCnpj(p.document),
        p.count,
        p.value,
        p.what,
      ]),
      [3, 4],
    );
  }
  if (data.undocumented.length > 0) {
    plain(
      "Pendências",
      [
        { header: "Data", width: 12, numFmt: DATE },
        { header: "Descrição", width: 46 },
        { header: "Favorecido", width: 38 },
        { header: "CNPJ/CPF", width: 20 },
        { header: "Centro de custo", width: 28 },
        { header: "Falta", width: 24 },
        { header: "Valor", width: 16, numFmt: BRL },
      ],
      look
        .sort(data.undocumented)
        .map((l) => [
          day(l.date),
          lineDescription(l),
          look.partyOf(l.tx),
          look.documentOf(l.tx),
          look.costCentersOf(l.tx),
          "nota e comprovante",
          l.amount,
        ]),
      [7],
    );
  }

  // ── Vencidos sem baixa ────────────────────────────────────────────────────
  if (report.pending.lines.length > 0) {
    const late = workbook.addWorksheet("Vencidos sem baixa", {
      views: [{ state: "frozen", ySplit: 1 }],
      pageSetup: { ...landscape, printTitlesRow: "1:1" },
    });
    late.columns = [
      { header: "Vencimento", width: 12 },
      { header: "Descrição", width: 46 },
      { header: "Favorecido ou pagador", width: 38 },
      { header: "CNPJ/CPF", width: 20 },
      { header: "Centro de custo", width: 28 },
      { header: "Situação", width: 22 },
      { header: "A receber", width: 16 },
      { header: "A pagar", width: 16 },
    ];
    headStyle(late.getRow(1));
    for (const l of look.sort(report.pending.lines)) {
      const income = l.tx.type === "receivable";
      const row = late.addRow([
        day(l.tx.dueDate),
        lineDescription(l),
        look.partyOf(l.tx),
        look.documentOf(l.tx),
        look.costCentersOf(l.tx),
        situationOf(l.tx),
        income ? l.amount : null,
        income ? null : l.amount,
      ]);
      row.getCell(1).numFmt = DATE;
      row.getCell(7).numFmt = BRL;
      row.getCell(8).numFmt = BRL;
    }
  }
  return workbook;
}

/**
 * O que a contabilidade externa recebe: a síntese em PDF e a planilha com
 * as notas e os comprovantes em pastas, ligados por caminho relativo. Nenhum link do
 * arquivo abre documento pela internet.
 */
export async function buildCashFlowPackage(
  report: CashFlowReport,
  ctx: CashFlowContext,
  onProgress?: (done: number, total: number) => void,
) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const look = lineLookups(ctx);
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 40);

  const files = new Map<string, PackagedFiles>();
  const failed: string[] = [];
  const jobs: (() => Promise<void>)[] = [];
  /** O mesmo arquivo em vários lançamentos entra uma vez só. */
  const fetched = new Map<string, Promise<string | null>>();

  const enqueue = (
    path: string | null,
    name: string,
    label: string,
    done: (saved: string | null) => void,
  ) =>
    jobs.push(async () => {
      const load = async () => {
        if (!path) return null;
        try {
          const res = await fetch(comprovanteProxyUrl(path));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const ext = path.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1] ?? "pdf";
          const saved = `${name}.${ext.toLowerCase()}`;
          zip.file(saved, await res.arrayBuffer());
          return saved;
        } catch (error) {
          console.warn("Documento fora do pacote", path, error);
          return null;
        }
      };
      const pending = (path && fetched.get(path)) || load();
      if (path) fetched.set(path, pending);
      const saved = await pending;
      if (!saved) failed.push(label);
      done(saved);
    });

  look.sort(report.lines).forEach((line, i) => {
    const t = line.tx;
    const n = String(i + 1).padStart(3, "0");
    const who = slug(look.partyOf(t)) || "sem-nome";
    const invoices = invoicesOf(t);
    const entry: PackagedFiles = { invoices: invoices.map(() => null) };
    files.set(t.id, entry);
    invoices.forEach((a, k) =>
      enqueue(
        storagePathOf(a.url),
        `notas/${n}${invoices.length > 1 ? `-${k + 1}` : ""}_${who}`,
        `Nota da linha ${i + 1}: ${t.description}`,
        (saved) => {
          entry.invoices[k] = saved;
        },
      ),
    );
    const receipt =
      t.comprovanteStoragePath ??
      (t.comprovanteUrl ? storagePathOf(t.comprovanteUrl) : undefined);
    if (receipt !== undefined) {
      entry.receipt = null;
      enqueue(
        receipt,
        `comprovantes/${n}_${who}`,
        `Comprovante da linha ${i + 1}: ${t.description}`,
        (saved) => {
          entry.receipt = saved;
        },
      );
    }
  });

  let done = 0;
  let next = 0;
  onProgress?.(0, jobs.length);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < jobs.length) {
        await jobs[next++]();
        onProgress?.(++done, jobs.length);
      }
    }),
  );

  const slugged = periodSlug(ctx.start, ctx.end);
  const base = `fluxo_caixa_${slugged}`;
  const [workbook, { buildCashFlowPdf }] = await Promise.all([
    buildCashFlowWorkbook(report, ctx, files),
    import("@/lib/services/cashFlowPdf"),
  ]);
  zip.file(`${base}.xlsx`, await workbook.xlsx.writeBuffer());
  const pdf = (await buildCashFlowPdf(report, ctx)).output("blob");
  zip.file(`sintese_caixa_${slugged}.pdf`, pdf);
  // Os documentos já são comprimidos: só empacotar.
  return { zip: await zip.generateAsync({ type: "blob" }), pdf, failed };
}

export const reportService = {
  // ─────────────────────────────────────────────────────────────────────────
  // FLUXO DE CAIXA
  // ─────────────────────────────────────────────────────────────────────────
  /** Síntese do período e, em anexo, as pendências e o extrato. */
  generateCashFlowPDF: async (report: CashFlowReport, ctx: CashFlowContext) => {
    const { buildCashFlowPdf } = await import("@/lib/services/cashFlowPdf");
    const doc = await buildCashFlowPdf(report, ctx);
    doc.save(`sintese_caixa_${periodSlug(ctx.start, ctx.end)}.pdf`);
  },

  exportCashFlowExcel: async (report: CashFlowReport, ctx: CashFlowContext) => {
    const workbook = await buildCashFlowWorkbook(report, ctx);
    downloadBlob(
      new Blob([await workbook.xlsx.writeBuffer()], { type: XLSX_TYPE }),
      `fluxo_caixa_${periodSlug(ctx.start, ctx.end)}.xlsx`,
    );
  },

  exportCashFlowPackage: async (
    report: CashFlowReport,
    ctx: CashFlowContext,
    onProgress?: (done: number, total: number) => void,
  ) => {
    const { zip, failed } = await buildCashFlowPackage(report, ctx, onProgress);
    downloadBlob(zip, `fluxo_caixa_${periodSlug(ctx.start, ctx.end)}.zip`);
    return { failed };
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DRE
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * DRE gerencial já montada na tela (`buildDre`), em PDF. Sem plano de
   * contas, todo lançamento cai em "sem conta contábil" e o relatório vira o
   * resumo receitas − despesas.
   */
  generateDREPDF: async (
    dre: DreReport<Transaction>,
    ctx: DreExportContext,
  ) => {
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF();
    const reportFont = await ensureReportFont(doc);
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text("Demonstração do Resultado — DRE Gerencial", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(ctx.companyName, 14, 25);
    doc.text(
      `Período: ${periodText(ctx.start, ctx.end)}${filterSuffix(ctx)}`,
      14,
      30.5,
    );

    // Avisos de completude também no topo: é o que quem recebe lê primeiro.
    let tableY = 37;
    const warnings = dreNotes(dre, ctx).filter((n) => n.startsWith("ATENÇÃO"));
    if (warnings.length) {
      doc.setFontSize(8.5);
      doc.setTextColor(180, 83, 9);
      for (const w of warnings) {
        const lines = doc.splitTextToSize(w, pageWidth - 28);
        doc.text(lines, 14, tableY);
        tableY += lines.length * 4;
      }
      tableY += 3;
    }

    autoTable(doc, {
      startY: tableY,
      head: [["Conta", "Valor (R$)", "AV %"]],
      body: dre.rows.map((r) => [
        dreRowLabel(r),
        r.kind === "heading" ? "" : formatDreValue(r.total),
        r.kind === "heading" ? "" : formatAv(r.total, dre.base),
      ]),
      showHead: "everyPage",
      theme: "plain",
      styles: {
        font: reportFont,
        fontSize: 8.5,
        cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
        textColor: [30, 41, 59],
      },
      headStyles: {
        font: reportFont,
        fontStyle: "bold",
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
      },
      columnStyles: {
        1: { halign: "right", cellWidth: 38 },
        2: { halign: "right", cellWidth: 18 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const row = dre.rows[data.row.index];
        const s = data.cell.styles;
        if (row.kind === "group") {
          s.fontStyle = "bold";
          s.fillColor = [241, 245, 249];
        } else if (row.kind === "subtotal") {
          s.fontStyle = "bold";
          s.fillColor = [226, 232, 240];
        } else if (row.kind === "result") {
          s.fontStyle = "bold";
          s.fillColor = [15, 23, 42];
          s.textColor = [255, 255, 255];
        } else if (row.kind === "heading") {
          s.fontStyle = "bold";
          s.textColor = [100, 116, 139];
          s.cellPadding = { top: 4, bottom: 1.6, left: 2, right: 2 };
        } else {
          s.textColor = row.kind === "info" ? [180, 83, 9] : [51, 65, 85];
        }
        if (data.column.index > 0 && row.total < 0 && row.kind !== "result") {
          s.textColor = [185, 28, 28];
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable.finalY + 6;
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    for (const note of dreNotes(dre, ctx)) {
      const lines = doc.splitTextToSize(note, pageWidth - 28);
      doc.text(lines, 14, y);
      y += lines.length * 3.6;
    }

    doc.save(`dre_${periodSlug(ctx.start, ctx.end)}.pdf`);
  },

  /**
   * DRE em Excel, mês a mês, com total e análise vertical, e uma segunda aba
   * com os lançamentos que formam cada linha — para conferir ou entregar ao
   * contador.
   */
  exportDREExcel: async (
    dre: DreReport<Transaction>,
    ctx: DreExportContext,
  ) => {
    const accounts = ctx.accounts ?? [];
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Hebron ASEEC · Financeiro";
    workbook.created = new Date();

    const MONEY = '#,##0.00;[Red](#,##0.00);"-"';
    const sheet = workbook.addWorksheet("DRE", {
      views: [{ state: "frozen", ySplit: 4, xSplit: 2 }],
      properties: { outlineLevelRow: 3 },
    });
    sheet.columns = [
      { width: 12 },
      { width: 52 },
      ...dre.columns.map(() => ({ width: 14 })),
      { width: 16 },
      { width: 9 },
    ];
    const lastCol = 2 + dre.columns.length + 2;

    sheet.mergeCells(1, 1, 1, lastCol);
    sheet.getCell(1, 1).value = `${ctx.companyName} — DRE Gerencial`;
    sheet.getCell(1, 1).font = { bold: true, size: 13 };
    sheet.mergeCells(2, 1, 2, lastCol);
    sheet.getCell(2, 1).value =
      `Período: ${periodText(ctx.start, ctx.end)}${filterSuffix(ctx)}` +
      `  ·  Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
    sheet.getCell(2, 1).font = { size: 9, color: { argb: "FF64748B" } };
    // Linha congelada logo acima do cabeçalho: os avisos ficam sempre à vista.
    const warnings = dreNotes(dre, ctx).filter((n) => n.startsWith("ATENÇÃO"));
    if (warnings.length) {
      sheet.mergeCells(3, 1, 3, lastCol);
      sheet.getCell(3, 1).value = warnings.join("  ");
      sheet.getCell(3, 1).font = {
        size: 9,
        bold: true,
        color: { argb: "FFB45309" },
      };
      sheet.getCell(3, 1).alignment = { wrapText: true, vertical: "middle" };
      sheet.getRow(3).height = 18 * warnings.length + 6;
    } else {
      sheet.getRow(3).height = 4;
    }

    const header = sheet.addRow([
      "Código",
      "Conta",
      ...dre.columns.map((c) => c.label),
      "Total",
      "AV %",
    ]);
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    header.height = 20;

    for (const r of dre.rows) {
      const isHeading = r.kind === "heading";
      const row = sheet.addRow([
        r.code ?? "",
        r.kind === "account" || r.kind === "info"
          ? r.label
          : r.label.toUpperCase(),
        ...(isHeading ? dre.columns.map(() => null) : r.values),
        isHeading ? null : r.total,
        isHeading || dre.base <= 0 ? null : r.total / dre.base,
      ]);
      row.getCell(2).alignment = { indent: r.kind === "account" ? r.level : 0 };
      for (let c = 3; c <= lastCol - 1; c++) row.getCell(c).numFmt = MONEY;
      row.getCell(lastCol).numFmt = "0.0%";
      if (r.kind === "account") row.outlineLevel = Math.min(r.level, 3);

      const fill = (argb: string) =>
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        });
      if (r.kind === "group") {
        row.font = { bold: true };
        fill("FFF1F5F9");
      } else if (r.kind === "subtotal") {
        row.font = { bold: true };
        fill("FFE2E8F0");
      } else if (r.kind === "result") {
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        fill("FF0F172A");
      } else if (isHeading) {
        row.font = { bold: true, color: { argb: "FF64748B" } };
      } else if (r.kind === "info") {
        row.font = { italic: true, color: { argb: "FFB45309" } };
      }
    }

    sheet.addRow([]);
    for (const note of dreNotes(dre, ctx)) {
      sheet.addRow(["", note]).font = { size: 8, color: { argb: "FF64748B" } };
    }

    // Aba de lançamentos: a origem de cada número da DRE, exatamente os que
    // entraram nas linhas (mesmo regime, mesmo recorte de centro de custo).
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const groupOf = groupResolver(accounts);
    const detail = workbook.addWorksheet("Lançamentos", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    detail.columns = [
      { header: "Data efetiva", width: 13 },
      { header: "Competência", width: 12 },
      { header: "Descrição", width: 42 },
      { header: "Favorecido", width: 30 },
      { header: "Tipo", width: 10 },
      { header: "Status", width: 13 },
      { header: "Código", width: 11 },
      { header: "Conta", width: 36 },
      { header: "Linha da DRE", width: 30 },
      { header: "Valor", width: 15 },
    ];
    detail.getRow(1).font = { bold: true };
    for (const t of dreSources(dre)) {
      const account = t.accountId ? byId.get(t.accountId) : undefined;
      const group = account ? groupOf(account.code) : undefined;
      const amount = dreAmount(t, ctx.costCenterIds);
      const row = detail.addRow([
        effectiveDate(t),
        t.competence
          ? `${t.competence.slice(5)}/${t.competence.slice(0, 4)}`
          : "",
        t.description,
        t.supplierOrClient ?? "",
        t.type === "payable" ? "Despesa" : "Receita",
        STATUS_LABEL[t.status] ?? t.status,
        account?.code ?? "",
        account?.name ?? "Sem conta contábil",
        group ? DRE_GROUP_LABEL[group] : "",
        t.type === "payable" ? -amount : amount,
      ]);
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(10).numFmt = MONEY;
    }
    detail.autoFilter = { from: "A1", to: "J1" };

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], { type: XLSX_TYPE }),
      `dre_${periodSlug(ctx.start, ctx.end)}.xlsx`,
    );
  },

  /** DRE em CSV: a mesma tabela da tela, com os meses em colunas. */
  exportDRECSV: (dre: DreReport<Transaction>, ctx: DreExportContext) => {
    const rows = [
      ["Código", "Conta", ...dre.columns.map((c) => c.label), "Total", "AV %"],
      ...dre.rows
        .filter((r) => r.kind !== "heading")
        .map((r) => [
          r.code ?? "",
          dreRowLabel(r).trim(),
          ...r.values,
          r.total,
          dre.base > 0 ? formatAv(r.total, dre.base) : "",
        ]),
    ];
    downloadBlob(
      new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" }),
      `dre_${periodSlug(ctx.start, ctx.end)}.csv`,
    );
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAGAMENTOS — extrato do que foi pago a uma entidade, para enviar a ela
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * PDF com a lista e, se pedido, cada comprovante anexado no fim (PDF copiado
   * página a página; imagem numa página A4). Devolve os anexos que não deu
   * para incluir, para a tela avisar.
   */
  generatePaymentsPDF: async (
    report: PaymentsReport,
    ctx: PaymentsExportContext,
  ): Promise<{ failed: string[] }> => {
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF();
    const reportFont = await ensureReportFont(doc);
    const cols = paymentColumns(ctx);
    const annex = new Map<string, number>();
    if (ctx.withReceipts) {
      for (const l of report.lines) {
        if (receiptUrl(l.tx)) annex.set(l.tx.id, annex.size + 1);
      }
    }

    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(paymentsTitle(ctx), 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    let y = 25;
    for (const line of paymentsHeader(ctx)) {
      doc.text(line, 14, y);
      y += 5.5;
    }

    autoTable(doc, {
      startY: y + 1,
      head: [cols.map((c) => c.header)],
      body: report.lines.map((l) =>
        cols.map((c) =>
          c.key === "receipt"
            ? annex.has(l.tx.id)
              ? `Anexo ${annex.get(l.tx.id)}`
              : receiptUrl(l.tx)
                ? "Sim"
                : "—"
            : paymentCell(c.key, l, ctx),
        ),
      ),
      foot: [
        cols.map((c, i) =>
          i === 0
            ? `Total (${report.lines.length})`
            : c.key === "amount"
              ? formatCurrency(report.total)
              : "",
        ),
      ],
      showHead: "everyPage",
      showFoot: "lastPage",
      theme: "plain",
      styles: {
        font: reportFont,
        fontSize: 8.5,
        cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 },
        textColor: [30, 41, 59],
      },
      headStyles: {
        font: reportFont,
        fontStyle: "bold",
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
      },
      footStyles: {
        font: reportFont,
        fontStyle: "bold",
        fillColor: [226, 232, 240],
      },
      columnStyles: Object.fromEntries(
        cols.flatMap((c, i) =>
          c.key === "amount" ? [[i, { halign: "right", cellWidth: 28 }]] : [],
        ),
      ),
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    const name = paymentsFile(ctx, "pdf");
    const pdf = doc.output("arraybuffer");
    if (annex.size === 0) {
      downloadBlob(new Blob([pdf], { type: "application/pdf" }), name);
      return { failed: [] };
    }
    const { bytes, failed } = await appendReceipts(
      pdf,
      report.lines.filter((l) => annex.has(l.tx.id)),
      (l) => annex.get(l.tx.id)!,
      ctx.onReceiptProgress,
    );
    downloadBlob(
      new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
      name,
    );
    return { failed };
  },

  exportPaymentsExcel: async (
    report: PaymentsReport,
    ctx: PaymentsExportContext,
  ) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Hebron ASEEC · Financeiro";
    workbook.created = new Date();
    const cols = paymentColumns(ctx);
    const sheet = workbook.addWorksheet(
      ctx.type === "payable" ? "Pagamentos" : "Recebimentos",
      { views: [{ state: "frozen", ySplit: 5 }] },
    );
    sheet.columns = cols.map((c) => ({ width: c.width }));

    const [company, ...details] = paymentsHeader(ctx);
    const top = [
      `${company} — ${paymentsTitle(ctx)}`,
      details.join("  ·  "),
      `Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`,
    ];
    top.forEach((text, i) => {
      sheet.mergeCells(i + 1, 1, i + 1, cols.length);
      sheet.getCell(i + 1, 1).value = text;
      sheet.getCell(i + 1, 1).font =
        i === 0
          ? { bold: true, size: 13 }
          : { size: 9, color: { argb: "FF64748B" } };
    });

    sheet.addRow([]);
    const header = sheet.addRow(cols.map((c) => c.header));
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
    });
    const amountCol = cols.findIndex((c) => c.key === "amount") + 1;
    for (const l of report.lines) {
      const row = sheet.addRow(
        cols.map((c) =>
          c.key === "date"
            ? l.date
            : c.key === "amount"
              ? l.amount
              : c.key === "receipt"
                ? receiptUrl(l.tx)
                  ? "Sim"
                  : "Não"
                : paymentCell(c.key, l, ctx),
        ),
      );
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(amountCol).numFmt = '"R$" #,##0.00';
    }
    const total = sheet.addRow(
      cols.map((c, i) =>
        i === 0
          ? `Total (${report.lines.length})`
          : c.key === "amount"
            ? report.total
            : null,
      ),
    );
    total.font = { bold: true };
    total.getCell(amountCol).numFmt = '"R$" #,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], { type: XLSX_TYPE }),
      paymentsFile(ctx, "xlsx"),
    );
  },

  exportPaymentsCSV: (report: PaymentsReport, ctx: PaymentsExportContext) => {
    const cols = paymentColumns(ctx);
    const rows = [
      cols.map((c) => c.header),
      ...report.lines.map((l) =>
        cols.map((c) =>
          c.key === "date"
            ? l.date
            : c.key === "amount"
              ? l.amount
              : c.key === "receipt"
                ? receiptUrl(l.tx)
                  ? "Sim"
                  : "Não"
                : paymentCell(c.key, l, ctx),
        ),
      ),
    ];
    downloadBlob(
      new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" }),
      paymentsFile(ctx, "csv"),
    );
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GUIA DE TRANSFERÊNCIAS — Excel com abas PIX, Boletos, Outros e Resumo
  // ─────────────────────────────────────────────────────────────────────────
  exportTransferGuide: async (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
    entities: Entity[] = [],
  ) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Hebron ASEEC · Financeiro";
    workbook.created = new Date();

    const entitiesMap = entities.reduce(
      (acc, e) => {
        acc[e.id] = e;
        return acc;
      },
      {} as Record<string, Entity>,
    );
    // Dados bancários da conta que o lançamento escolheu.
    const payeeOf = (t: Transaction) => {
      const e = t.entityId ? entitiesMap[t.entityId] : undefined;
      return e && withPayeeAccount(e, t.entityBankAccountId);
    };

    const eff = (t: Transaction) =>
      t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;

    const payables = transactions.filter((t) => t.type === "payable");
    const pixTransactions = payables.filter((t) => t.paymentMethod === "pix");
    const boletoTransactions = payables.filter(
      (t) => t.paymentMethod === "boleto",
    );
    const outrosTransactions = payables.filter(
      (t) => t.paymentMethod !== "pix" && t.paymentMethod !== "boleto",
    );

    const PIX_KEY_TYPE_LABEL: Record<string, string> = {
      cpf: "CPF",
      cnpj: "CNPJ",
      email: "E-mail",
      phone: "Telefone",
      random: "Aleatória",
    };
    const ACCOUNT_TYPE_LABEL: Record<string, string> = {
      checking: "Corrente",
      savings: "Poupança",
    };
    const PAYMENT_METHOD_LABEL: Record<string, string> = {
      transfer: "Transferência",
      credit_card: "Cartão de Crédito",
      cash: "Dinheiro",
    };

    const BRL_FMT = '"R$" #,##0.00';
    const MISSING_BG = { argb: "FFFEE2E2" };
    const MISSING_FONT = { italic: true, color: { argb: "FFDC2626" } };

    const styleHeaderRow = (row: import("exceljs").Row, cols: number) => {
      row.height = 22;
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF0F172A" },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: false,
        };
        cell.border = {
          bottom: { style: "medium", color: { argb: "FF16A34A" } },
        };
      }
    };

    const addTitleRows = (
      sheet: import("exceljs").Worksheet,
      subtitle: string,
      totalCols: number,
    ) => {
      const colLetter = String.fromCharCode(64 + totalCols);
      sheet.mergeCells(`A1:${colLetter}1`);
      const r1 = sheet.getCell("A1");
      r1.value = companyName;
      r1.font = { bold: true, size: 13, color: { argb: "FF0F172A" } };
      r1.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      r1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      sheet.getRow(1).height = 22;

      sheet.mergeCells(`A2:${colLetter}2`);
      const r2 = sheet.getCell("A2");
      r2.value = `${subtitle}  ·  ${format(startDate, "dd/MM/yyyy")} — ${format(endDate, "dd/MM/yyyy")}  ·  Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
      r2.font = { size: 9, color: { argb: "FF64748B" } };
      r2.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      r2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      sheet.getRow(2).height = 16;
      sheet.getRow(3).height = 4;
    };

    // Helper: linha de total
    const addTotalRow = (
      sheet: import("exceljs").Worksheet,
      labelCol: number,
      valueCol: number,
      totalCols: number,
      totalValue: number,
      valueColor: string,
    ) => {
      const cells = Array.from({ length: totalCols }, (_, i) =>
        i + 1 === labelCol ? "TOTAL" : i + 1 === valueCol ? totalValue : "",
      );
      const totRow = sheet.addRow(cells);
      totRow.height = 20;
      const tLabel = totRow.getCell(labelCol);
      tLabel.font = { bold: true, size: 9, color: { argb: "FF0F172A" } };
      tLabel.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      tLabel.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };
      const tVal = totRow.getCell(valueCol);
      tVal.numFmt = BRL_FMT;
      tVal.font = { bold: true, color: { argb: valueColor } };
      tVal.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      tVal.alignment = { horizontal: "right" };
      tVal.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };
    };

    // ════════════════════════════════════════════════════════════════════════
    // ABA "PIX"  — grupos entidade+dia com sub-linhas de detalhe
    // ════════════════════════════════════════════════════════════════════════
    const pixSheet = workbook.addWorksheet("PIX", {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    pixSheet.columns = [
      { width: 14 }, // A: Data
      { width: 42 }, // B: Favorecido / Descrição sub-linha
      { width: 20 }, // C: CNPJ/CPF
      { width: 22 }, // D: Banco
      { width: 12 }, // E: Agência
      { width: 18 }, // F: Conta
      { width: 14 }, // G: Tipo Conta
      { width: 16 }, // H: Tipo Chave PIX
      { width: 36 }, // I: Chave PIX
      { width: 18 }, // J: Valor (R$)
      { width: 8 }, //  K: Qtd.
      { width: 12 }, // L: ✓ Conferido
    ];

    addTitleRows(pixSheet, "Guia de Transferências — PIX", 12);

    const pixHeaders = [
      "Data",
      "Favorecido",
      "CNPJ/CPF",
      "Banco",
      "Agência",
      "Conta",
      "Tipo Conta",
      "Tipo Chave PIX",
      "Chave PIX",
      "Valor (R$)",
      "Qtd.",
      "✓ Conferido",
    ];
    styleHeaderRow(pixSheet.addRow(pixHeaders), pixHeaders.length);

    // Agrupar por entidade + data — armazenando lançamentos individuais
    type PixGroup = {
      entityName: string;
      entityDoc: string;
      date: Date;
      totalAmount: number;
      count: number;
      entity: Entity | undefined;
      items: Array<{ description: string; amount: number }>;
    };

    const pixGroupsMap = new Map<string, PixGroup>();

    pixTransactions.forEach((t) => {
      const effDate =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const dateKey = format(effDate, "yyyy-MM-dd");
      const entityKey =
        (t.entityId && `${t.entityId}:${t.entityBankAccountId ?? ""}`) ||
        `name:${t.supplierOrClient ?? "desconhecido"}`;
      const key = `${entityKey}|${dateKey}`;

      const entity = payeeOf(t);
      const entityName = entity?.name || t.supplierOrClient || "-";
      const entityDoc = entity?.document || "";

      if (!pixGroupsMap.has(key)) {
        pixGroupsMap.set(key, {
          entityName,
          entityDoc,
          date: effDate,
          totalAmount: 0,
          count: 0,
          entity,
          items: [],
        });
      }
      const g = pixGroupsMap.get(key)!;
      g.totalAmount += eff(t);
      g.count += 1;
      g.items.push({
        description: t.description || "(sem descrição)",
        amount: eff(t),
      });
    });

    const sortedPixGroups = Array.from(pixGroupsMap.values()).sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      return a.entityName.localeCompare(b.entityName, "pt-BR", {
        sensitivity: "base",
      });
    });

    let missingPixKeyCount = 0;

    sortedPixGroups.forEach((g, idx) => {
      const missingKey = !g.entity?.pixKey;
      if (missingKey) missingPixKeyCount++;

      const groupBg = { argb: idx % 2 === 0 ? "FFE0F2FE" : "FFFFFFFF" };

      // Linha de grupo (sumário da transferência)
      const groupRow = pixSheet.addRow([
        format(g.date, "dd/MM/yyyy"),
        g.entityName,
        g.entityDoc,
        g.entity?.bankName || "",
        g.entity?.agency || "",
        g.entity?.account || "",
        g.entity?.accountType
          ? (ACCOUNT_TYPE_LABEL[g.entity.accountType] ?? "")
          : "",
        g.entity?.pixKeyType
          ? (PIX_KEY_TYPE_LABEL[g.entity.pixKeyType] ?? "")
          : "",
        g.entity?.pixKey || "",
        g.totalAmount,
        g.count,
        "",
      ]);
      groupRow.height = 18;

      const cellVal = groupRow.getCell(10);
      cellVal.numFmt = BRL_FMT;
      cellVal.alignment = { horizontal: "right" };
      cellVal.font = { bold: true, color: { argb: "FF0F172A" } };

      // Alerta visual: chave PIX ausente
      const cellPix = groupRow.getCell(9);
      if (missingKey) {
        cellPix.value = "⚠ Não cadastrada";
        cellPix.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: MISSING_BG,
        };
        cellPix.font = MISSING_FONT;
      }

      for (let c = 1; c <= 12; c++) {
        if (c !== 9 || !missingKey) {
          groupRow.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: groupBg,
          };
        }
        groupRow.getCell(c).border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      }

      // Sub-linhas de detalhe (lançamentos individuais que compõem o grupo)
      const subBg = { argb: "FFF8FAFC" };
      g.items.forEach((item) => {
        const subRow = pixSheet.addRow([
          "",
          `└ ${item.description}`,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          item.amount,
          "",
          "",
        ]);
        subRow.height = 15;

        const subB = subRow.getCell(2);
        subB.font = { size: 8, color: { argb: "FF64748B" } };
        subB.alignment = { indent: 2 };

        const subJ = subRow.getCell(10);
        subJ.numFmt = BRL_FMT;
        subJ.alignment = { horizontal: "right" };
        subJ.font = { size: 8, color: { argb: "FF64748B" } };

        for (let c = 1; c <= 12; c++) {
          subRow.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: subBg,
          };
          subRow.getCell(c).border = {
            bottom: { style: "hair", color: { argb: "FFF1F5F9" } },
          };
        }
      });
    });

    const totalPixAmount = sortedPixGroups.reduce(
      (s, g) => s + g.totalAmount,
      0,
    );
    if (sortedPixGroups.length > 0) {
      addTotalRow(pixSheet, 9, 10, 12, totalPixAmount, "FF0F172A");
    }

    // ════════════════════════════════════════════════════════════════════════
    // ABA "Boletos"  — individual com linha digitável e alerta de ausência
    // ════════════════════════════════════════════════════════════════════════
    const boletoSheet = workbook.addWorksheet("Boletos", {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    boletoSheet.columns = [
      { width: 14 }, // A: Vencimento
      { width: 30 }, // B: Favorecido
      { width: 20 }, // C: CNPJ/CPF
      { width: 22 }, // D: Banco
      { width: 38 }, // E: Descrição
      { width: 18 }, // F: Valor (R$)
      { width: 60 }, // G: Linha Digitável
      { width: 12 }, // H: ✓ Conferido
    ];

    addTitleRows(boletoSheet, "Guia de Transferências — Boletos", 8);

    const boletoHeaders = [
      "Vencimento",
      "Favorecido",
      "CNPJ/CPF",
      "Banco",
      "Descrição",
      "Valor (R$)",
      "Linha Digitável",
      "✓ Conferido",
    ];
    styleHeaderRow(boletoSheet.addRow(boletoHeaders), boletoHeaders.length);

    const sortedBoletos = [...boletoTransactions].sort((a, b) => {
      const dA =
        a.status === "paid" && a.paymentDate ? a.paymentDate : a.dueDate;
      const dB =
        b.status === "paid" && b.paymentDate ? b.paymentDate : b.dueDate;
      const diff = dA.getTime() - dB.getTime();
      if (diff !== 0) return diff;
      const entA = a.entityId ? entitiesMap[a.entityId] : undefined;
      const entB = b.entityId ? entitiesMap[b.entityId] : undefined;
      return (entA?.name || a.supplierOrClient || "").localeCompare(
        entB?.name || b.supplierOrClient || "",
        "pt-BR",
        { sensitivity: "base" },
      );
    });

    let missingBarcodeCount = 0;

    sortedBoletos.forEach((t, idx) => {
      const effDate =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const entity = payeeOf(t);
      const entityName = entity?.name || t.supplierOrClient || "-";
      const amount = eff(t);
      const missingBarcode = !t.barcode;
      if (missingBarcode) missingBarcodeCount++;

      const row = boletoSheet.addRow([
        format(effDate, "dd/MM/yyyy"),
        entityName,
        entity?.document || "",
        entity?.bankName || "",
        t.description || "",
        amount,
        t.barcode || "",
        "",
      ]);
      row.height = 18;

      const cellAmt = row.getCell(6);
      cellAmt.numFmt = BRL_FMT;
      cellAmt.alignment = { horizontal: "right" };
      cellAmt.font = { bold: true, color: { argb: "FFDC2626" } };

      const cellBarcode = row.getCell(7);
      if (missingBarcode) {
        cellBarcode.value = "⚠ Linha digitável não cadastrada";
        cellBarcode.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: MISSING_BG,
        };
        cellBarcode.font = { ...MISSING_FONT, name: "Courier New", size: 9 };
      } else {
        cellBarcode.font = { name: "Courier New", size: 9 };
      }

      const bg = { argb: idx % 2 === 0 ? "FFFFF7ED" : "FFFFFFFF" };
      for (let c = 1; c <= 8; c++) {
        if (c !== 7 || !missingBarcode) {
          row.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: bg,
          };
        }
        row.getCell(c).border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      }
    });

    const totalBoletoAmount = sortedBoletos.reduce((s, t) => s + eff(t), 0);
    if (sortedBoletos.length > 0) {
      addTotalRow(boletoSheet, 5, 6, 8, totalBoletoAmount, "FFDC2626");
    }

    // ════════════════════════════════════════════════════════════════════════
    // ABA "Outros"  — demais formas de pagamento ou sem método definido
    // ════════════════════════════════════════════════════════════════════════
    if (outrosTransactions.length > 0) {
      const outrosSheet = workbook.addWorksheet("Outros", {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      outrosSheet.columns = [
        { width: 14 }, // A: Data
        { width: 30 }, // B: Favorecido
        { width: 20 }, // C: CNPJ/CPF
        { width: 22 }, // D: Banco
        { width: 12 }, // E: Agência
        { width: 18 }, // F: Conta
        { width: 20 }, // G: Forma Pagamento
        { width: 38 }, // H: Descrição
        { width: 18 }, // I: Valor (R$)
        { width: 12 }, // J: ✓ Conferido
      ];

      addTitleRows(outrosSheet, "Guia de Transferências — Outros", 10);

      const outrosHeaders = [
        "Data",
        "Favorecido",
        "CNPJ/CPF",
        "Banco",
        "Agência",
        "Conta",
        "Forma Pagamento",
        "Descrição",
        "Valor (R$)",
        "✓ Conferido",
      ];
      styleHeaderRow(outrosSheet.addRow(outrosHeaders), outrosHeaders.length);

      const sortedOutros = [...outrosTransactions].sort((a, b) => {
        const dA =
          a.status === "paid" && a.paymentDate ? a.paymentDate : a.dueDate;
        const dB =
          b.status === "paid" && b.paymentDate ? b.paymentDate : b.dueDate;
        const diff = dA.getTime() - dB.getTime();
        if (diff !== 0) return diff;
        const entA = a.entityId ? entitiesMap[a.entityId] : undefined;
        const entB = b.entityId ? entitiesMap[b.entityId] : undefined;
        return (entA?.name || a.supplierOrClient || "").localeCompare(
          entB?.name || b.supplierOrClient || "",
          "pt-BR",
          { sensitivity: "base" },
        );
      });

      sortedOutros.forEach((t, idx) => {
        const effDate =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        const entity = payeeOf(t);
        const entityName = entity?.name || t.supplierOrClient || "-";
        const amount = eff(t);
        const methodLabel = t.paymentMethod
          ? (PAYMENT_METHOD_LABEL[t.paymentMethod] ?? t.paymentMethod)
          : "Não definida";

        const row = outrosSheet.addRow([
          format(effDate, "dd/MM/yyyy"),
          entityName,
          entity?.document || "",
          entity?.bankName || "",
          entity?.agency || "",
          entity?.account || "",
          methodLabel,
          t.description || "",
          amount,
          "",
        ]);
        row.height = 18;

        const cellAmt = row.getCell(9);
        cellAmt.numFmt = BRL_FMT;
        cellAmt.alignment = { horizontal: "right" };
        cellAmt.font = { bold: true, color: { argb: "FF0F172A" } };

        if (idx % 2 === 0) {
          const bg = { argb: "FFF5F3FF" }; // violeta claro
          for (let c = 1; c <= 10; c++) {
            row.getCell(c).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: bg,
            };
          }
        }
        for (let c = 1; c <= 10; c++) {
          row.getCell(c).border = {
            bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
          };
        }
      });

      const totalOutros = sortedOutros.reduce((s, t) => s + eff(t), 0);
      addTotalRow(outrosSheet, 8, 9, 10, totalOutros, "FF0F172A");
    }

    // ════════════════════════════════════════════════════════════════════════
    // ABA "Resumo"  — totais financeiros + alertas de dados faltando
    // ════════════════════════════════════════════════════════════════════════
    const resumoSheet = workbook.addWorksheet("Resumo");
    resumoSheet.columns = [
      { width: 42 }, // A: Label
      { width: 22 }, // B: Lançamentos
      { width: 22 }, // C: Transferências
      { width: 18 }, // D: Total (R$)
    ];

    addTitleRows(resumoSheet, "Guia de Transferências — Resumo", 4);

    const addResumoSectionTitle = (text: string) => {
      const row = resumoSheet.addRow([text]);
      resumoSheet.mergeCells(`A${row.number}:D${row.number}`);
      row.getCell(1).font = {
        bold: true,
        size: 10,
        color: { argb: "FF0F172A" },
      };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      row.height = 20;
    };

    const addResumoDataRow = (
      label: string,
      lancamentos: string,
      transferencias: string,
      total: number,
      totalColor: string,
    ) => {
      const row = resumoSheet.addRow([
        label,
        lancamentos,
        transferencias,
        total,
      ]);
      row.height = 18;
      row.getCell(1).font = { color: { argb: "FF475569" } };
      row.getCell(2).alignment = { horizontal: "center" };
      row.getCell(3).alignment = { horizontal: "center" };
      row.getCell(4).numFmt = BRL_FMT;
      row.getCell(4).alignment = { horizontal: "right" };
      row.getCell(4).font = { bold: true, color: { argb: totalColor } };
      for (let c = 1; c <= 4; c++) {
        row.getCell(c).border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      }
    };

    addResumoSectionTitle("RESUMO FINANCEIRO");

    // Cabeçalho da tabela
    const resumoHeaderRow = resumoSheet.addRow([
      "Categoria",
      "Lançamentos",
      "Transferências",
      "Total (R$)",
    ]);
    resumoHeaderRow.height = 20;
    for (let c = 1; c <= 4; c++) {
      resumoHeaderRow.getCell(c).font = {
        bold: true,
        size: 9,
        color: { argb: "FFFFFFFF" },
      };
      resumoHeaderRow.getCell(c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
      resumoHeaderRow.getCell(c).alignment = { horizontal: "center" };
    }

    const totalOutrosAmountFinal = outrosTransactions.reduce(
      (s, t) => s + eff(t),
      0,
    );
    const grandTotal =
      totalPixAmount + totalBoletoAmount + totalOutrosAmountFinal;

    addResumoDataRow(
      "PIX",
      `${pixTransactions.length} lançamentos`,
      `${sortedPixGroups.length} transferências`,
      totalPixAmount,
      "FF0369A1",
    );
    addResumoDataRow(
      "Boletos",
      `${sortedBoletos.length} boletos`,
      `${sortedBoletos.length} pagamentos`,
      totalBoletoAmount,
      "FFDC2626",
    );
    if (outrosTransactions.length > 0) {
      addResumoDataRow(
        "Outros",
        `${outrosTransactions.length} lançamentos`,
        "-",
        totalOutrosAmountFinal,
        "FF7C3AED",
      );
    }

    // Linha de total geral
    const grandTotRow = resumoSheet.addRow([
      "TOTAL GERAL",
      `${payables.length} lançamentos`,
      "-",
      grandTotal,
    ]);
    grandTotRow.height = 22;
    grandTotRow.getCell(1).font = {
      bold: true,
      size: 10,
      color: { argb: "FF0F172A" },
    };
    grandTotRow.getCell(2).alignment = { horizontal: "center" };
    grandTotRow.getCell(3).alignment = { horizontal: "center" };
    grandTotRow.getCell(4).numFmt = BRL_FMT;
    grandTotRow.getCell(4).alignment = { horizontal: "right" };
    grandTotRow.getCell(4).font = {
      bold: true,
      size: 11,
      color: { argb: "FF0F172A" },
    };
    for (let c = 1; c <= 4; c++) {
      grandTotRow.getCell(c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      grandTotRow.getCell(c).border = {
        top: { style: "medium", color: { argb: "FF0F172A" } },
      };
    }

    // Alertas de dados faltando
    if (missingPixKeyCount > 0 || missingBarcodeCount > 0) {
      resumoSheet.addRow([]);
      addResumoSectionTitle("⚠  ATENÇÃO: DADOS FALTANDO");

      const alertHeaderRow = resumoSheet.addRow([
        "Pendência",
        "Quantidade",
        "",
        "",
      ]);
      alertHeaderRow.height = 18;
      for (let c = 1; c <= 4; c++) {
        alertHeaderRow.getCell(c).font = {
          bold: true,
          size: 9,
          color: { argb: "FFFFFFFF" },
        };
        alertHeaderRow.getCell(c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDC2626" },
        };
        if (c <= 2) {
          alertHeaderRow.getCell(c).alignment = { horizontal: "center" };
        }
      }

      const addAlertRow = (label: string, count: number) => {
        const row = resumoSheet.addRow([label, `${count}`, "", ""]);
        row.height = 18;
        for (let c = 1; c <= 2; c++) {
          row.getCell(c).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: MISSING_BG,
          };
          row.getCell(c).border = {
            bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
          };
        }
        row.getCell(1).font = { color: { argb: "FFDC2626" } };
        row.getCell(2).font = { bold: true, color: { argb: "FFDC2626" } };
        row.getCell(2).alignment = { horizontal: "center" };
      };

      if (missingPixKeyCount > 0) {
        addAlertRow(
          "PIX sem chave cadastrada (aba PIX, coluna destacada em vermelho)",
          missingPixKeyCount,
        );
      }
      if (missingBarcodeCount > 0) {
        addAlertRow(
          "Boletos sem linha digitável (aba Boletos, coluna destacada em vermelho)",
          missingBarcodeCount,
        );
      }
    }

    // Gerar e disparar download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `guia_transferencias_${format(new Date(), "yyyyMMdd")}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTAR CSV
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Lançamentos do fluxo em CSV para o Excel em português: um por linha, com
   * o valor que entrou no fluxo, nomes em vez de códigos internos.
   */
  exportCashFlowCSV: (report: CashFlowReport, ctx: ReportContext) => {
    const { partyOf, documentOf, accountOf, costCentersOf, ...look } =
      lineLookups(ctx);
    const rows = [
      [
        "Data Efetiva",
        "Vencimento",
        "Pagamento",
        "Descrição",
        "Tipo",
        "Favorecido",
        "CNPJ/CPF",
        "Situação",
        "Valor Original",
        "Valor no Fluxo",
        "Centro de Custo",
        "Conta Contábil",
        "Competência",
        "Forma de Pagamento",
        "Detalhes",
      ],
      ...report.lines.map((line) => {
        const t = line.tx;
        return [
          line.date,
          t.dueDate,
          t.paymentDate,
          lineDescription(line),
          t.type === "payable" ? "Despesa" : "Receita",
          partyOf(t),
          documentOf(t),
          lineSituation(line),
          t.amount,
          t.type === "payable" ? -line.amount : line.amount,
          costCentersOf(t),
          accountOf(t),
          look.competenceOf(t),
          look.methodOf(t),
          t.details ?? "",
        ];
      }),
    ];
    downloadBlob(
      new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" }),
      `fluxo_caixa_${periodSlug(ctx.start, ctx.end)}.csv`,
    );
  },
};
