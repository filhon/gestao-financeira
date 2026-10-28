import type jsPDF from "jspdf";

// jspdf + autotable pesam ~150 KB gz: carregam só quando um PDF é gerado,
// fora do bundle inicial da página.
const loadPdf = async () => {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
};
import currency from "currency.js";
import { Transaction, Entity, ChartAccount, CostCenter } from "@/lib/types";
import { withPayeeAccount } from "@/lib/entityBankAccounts";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  PaymentLine,
  PaymentsReport,
  STAGE_INFO,
  isProjection,
  periodSlug,
  periodText,
  situationOf,
  toCsv,
} from "@/lib/reports";

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

const lineStatus = (line: FlowLine) => situationOf(line.tx);

const lineDescription = (line: FlowLine) =>
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

let interFontCache: string | null = null;

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

type ReportFont = "Inter" | "helvetica";

const getDocFontList = (doc: jsPDF): Record<string, string[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (doc as any).getFontList?.();
  return (list ?? {}) as Record<string, string[]>;
};

const ensureInterFont = async (doc: jsPDF): Promise<boolean> => {
  try {
    const fontList = getDocFontList(doc);
    if (fontList.Inter) return true;

    if (!interFontCache) {
      const res = await fetch("/fonts/Inter-Regular.ttf?v=4.1", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Falha ao carregar a fonte Inter");
      const buffer = await res.arrayBuffer();
      interFontCache = arrayBufferToBase64(buffer);
    }

    doc.addFileToVFS("Inter-Regular.ttf", interFontCache);
    doc.addFont("Inter-Regular.ttf", "Inter", "normal", "Identity-H");
    // Registrar também como bold para evitar fallback para Times (serifada)
    doc.addFont("Inter-Regular.ttf", "Inter", "bold", "Identity-H");

    const updatedFontList = getDocFontList(doc);
    return !!updatedFontList.Inter;
  } catch (error) {
    console.warn("Falha ao carregar a fonte Inter. Usando padrão.", error);
    return false;
  }
};

const ensureReportFont = async (doc: jsPDF): Promise<ReportFont> => {
  const interOk = await ensureInterFont(doc);
  const font: ReportFont = interOk ? "Inter" : "helvetica";
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
) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const out = await PDFDocument.load(pdf);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const [A4W, A4H] = [595.28, 841.89];
  let failed = 0;
  for (const l of lines) {
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
        failed++;
      }
    } catch (error) {
      console.warn("Comprovante fora do PDF", l.tx.id, error);
      failed++;
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

export const reportService = {
  // ─────────────────────────────────────────────────────────────────────────
  // EXTRATO DE FLUXO DE CAIXA — redesign profissional
  // ─────────────────────────────────────────────────────────────────────────
  generateCashFlowPDF: async (report: CashFlowReport, ctx: ReportContext) => {
    const { start: startDate, end: endDate, companyName } = ctx;
    const entities = ctx.entities ?? [];
    const { jsPDF, autoTable } = await loadPdf();
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    const reportFont = await ensureReportFont(doc);

    const PAGE_W = doc.internal.pageSize.getWidth(); // 297mm
    const PAGE_H = doc.internal.pageSize.getHeight(); // 210mm
    const MARGIN = 14;
    const USABLE_W = PAGE_W - MARGIN * 2;

    // ── Paleta de cores ──────────────────────────────────────────────────
    const NAVY = [15, 23, 42] as [number, number, number];
    const GREEN_600 = [22, 163, 74] as [number, number, number];
    const RED_600 = [220, 38, 38] as [number, number, number];
    const GREEN_50 = [240, 253, 244] as [number, number, number];
    const RED_50 = [254, 242, 242] as [number, number, number];
    const GREEN_200 = [187, 247, 208] as [number, number, number];
    const RED_200 = [254, 202, 202] as [number, number, number];
    const SLATE_50 = [248, 250, 252] as [number, number, number];
    const SLATE_100 = [241, 245, 249] as [number, number, number];
    const SLATE_300 = [203, 213, 225] as [number, number, number];
    const SLATE_600 = [71, 85, 105] as [number, number, number];
    const WHITE = [255, 255, 255] as [number, number, number];
    const GRAY_400 = [156, 163, 175] as [number, number, number];
    const GRAY_300 = [209, 213, 219] as [number, number, number];

    // Atalhos para setters de cor
    const fillRGB = (c: [number, number, number]) =>
      doc.setFillColor(c[0], c[1], c[2]);
    const drawRGB = (c: [number, number, number]) =>
      doc.setDrawColor(c[0], c[1], c[2]);
    const textRGB = (c: [number, number, number]) =>
      doc.setTextColor(c[0], c[1], c[2]);

    // ── Totais: os mesmos da tela ─────────────────────────────────────────
    const totalIn = report.inflow;
    const totalOut = report.outflow;
    const closing = report.closing;

    // ── Função de rodapé (chamada depois de todas as páginas serem geradas) ──
    const drawFooter = (pageNum: number, totalPages: number) => {
      doc.setFont(reportFont, "normal");
      doc.setFontSize(7);
      textRGB(GRAY_400);
      drawRGB(SLATE_300);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
      doc.text("FinControl • Documento Confidencial", MARGIN, PAGE_H - 7);
      doc.text(companyName, PAGE_W / 2, PAGE_H - 7, { align: "center" });
      doc.text(
        `Página ${pageNum} de ${totalPages}`,
        PAGE_W - MARGIN,
        PAGE_H - 7,
        { align: "right" },
      );
    };

    // ════════════════════════════════════════════════════════════════════════
    // CABEÇALHO (primeira página)
    // ════════════════════════════════════════════════════════════════════════
    fillRGB(NAVY);
    doc.rect(0, 0, PAGE_W, 36, "F");

    // Faixa de destaque verde na base do cabeçalho
    fillRGB(GREEN_600);
    doc.rect(0, 34, PAGE_W, 2, "F");

    // Nome da empresa (topo esquerdo)
    doc.setFont(reportFont, "normal");
    doc.setFontSize(7.5);
    textRGB(GRAY_400);
    doc.text(companyName.toUpperCase(), MARGIN, 10);

    // Título do relatório
    doc.setFont(reportFont, "bold");
    doc.setFontSize(15);
    textRGB(WHITE);
    doc.text("EXTRATO DE FLUXO DE CAIXA", MARGIN, 22);

    // Período — lado direito
    doc.setFont(reportFont, "normal");
    doc.setFontSize(7.5);
    textRGB(GRAY_300);
    doc.text(
      `Período: ${periodText(startDate, endDate)}`,
      PAGE_W - MARGIN,
      15,
      { align: "right" },
    );
    doc.text(
      `Gerado em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`,
      PAGE_W - MARGIN,
      23,
      { align: "right" },
    );
    if (ctx.filters) {
      doc.text(ctx.filters, PAGE_W - MARGIN, 31, { align: "right" });
    }

    // ════════════════════════════════════════════════════════════════════════
    // KPI CARDS (4 caixas de resumo)
    // ════════════════════════════════════════════════════════════════════════
    const kpiY = 42;
    const kpiH = 22;
    const kpiGap = 5;
    const kpiW = (USABLE_W - kpiGap * 3) / 4;

    const kpis: {
      label: string;
      value: string;
      accent: [number, number, number];
      bg: [number, number, number];
      border: [number, number, number];
    }[] = [
      {
        label: "SALDO INICIAL",
        value: formatCurrency(report.opening),
        accent: SLATE_600,
        bg: SLATE_50,
        border: SLATE_300,
      },
      {
        label: "TOTAL ENTRADAS",
        value: formatCurrency(totalIn),
        accent: GREEN_600,
        bg: GREEN_50,
        border: GREEN_200,
      },
      {
        label: "TOTAL SAÍDAS",
        value: formatCurrency(totalOut),
        accent: RED_600,
        bg: RED_50,
        border: RED_200,
      },
      {
        label: "SALDO FINAL",
        value: formatCurrency(closing),
        accent: closing >= 0 ? GREEN_600 : RED_600,
        bg: closing >= 0 ? GREEN_50 : RED_50,
        border: closing >= 0 ? GREEN_200 : RED_200,
      },
    ];

    kpis.forEach((kpi, i) => {
      const x = MARGIN + i * (kpiW + kpiGap);

      fillRGB(kpi.bg);
      drawRGB(kpi.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, kpiY, kpiW, kpiH, 2, 2, "FD");

      // Barra de destaque à esquerda
      fillRGB(kpi.accent);
      doc.rect(x, kpiY, 2.5, kpiH, "F");

      // Label
      doc.setFont(reportFont, "normal");
      doc.setFontSize(6.5);
      textRGB(SLATE_600);
      doc.text(kpi.label, x + 6, kpiY + 7);

      // Valor
      doc.setFont(reportFont, "bold");
      doc.setFontSize(10.5);
      textRGB(kpi.accent);
      doc.text(kpi.value, x + 6, kpiY + 17);
    });

    // ════════════════════════════════════════════════════════════════════════
    // CONSTRUÇÃO DA TABELA
    // ════════════════════════════════════════════════════════════════════════
    const entitiesMap = entities.reduce(
      (acc, e) => {
        acc[e.id] = e;
        return acc;
      },
      {} as Record<string, Entity>,
    );

    // Agrupar por dia (as linhas já vêm em ordem de data efetiva)
    const dayMap = new Map<string, { date: Date; lines: FlowLine[] }>();
    for (const line of report.lines) {
      const key = format(line.date, "yyyy-MM-dd");
      if (!dayMap.has(key)) dayMap.set(key, { date: line.date, lines: [] });
      dayMap.get(key)!.lines.push(line);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableBody: any[][] = [];
    let running = currency(report.opening);

    dayMap.forEach(({ date, lines }) => {
      // ── Ordenar por favorecido dentro do mesmo dia ───────────────────────
      const nameOf = (t: Transaction) =>
        (
          (t.entityId ? entitiesMap[t.entityId]?.name : undefined) ||
          t.supplierOrClient ||
          ""
        ).toLowerCase();
      const linesSorted = [...lines].sort((a, b) =>
        nameOf(a.tx).localeCompare(nameOf(b.tx), "pt-BR", {
          sensitivity: "base",
        }),
      );

      const sumOf = (type: Transaction["type"]) =>
        lines
          .filter((l) => l.tx.type === type)
          .reduce((s, l) => s.add(l.amount), currency(0)).value;
      const dayIn = sumOf("receivable");
      const dayOut = sumOf("payable");
      running = running.add(dayIn).subtract(dayOut);
      const daySummary = [
        dayIn > 0 ? `+${formatCurrency(dayIn)}` : null,
        dayOut > 0 ? `-${formatCurrency(dayOut)}` : null,
        `Saldo ${formatCurrency(running.value)}`,
      ]
        .filter(Boolean)
        .join("  ");

      // ── Linha separadora de data ─────────────────────────────────────────
      tableBody.push([
        {
          content: format(date, "EEEE, dd 'de' MMMM 'de' yyyy", {
            locale: ptBR,
          }).toUpperCase(),
          colSpan: 5,
          styles: {
            fillColor: SLATE_100,
            textColor: SLATE_600,
            fontStyle: "bold",
            fontSize: 7.5,
            cellPadding: { top: 3, bottom: 3, left: 4, right: 2 },
          },
        },
        {
          content: daySummary,
          styles: {
            fillColor: SLATE_100,
            textColor: SLATE_600,
            fontStyle: "bold",
            fontSize: 7,
            halign: "right",
            cellPadding: { top: 3, bottom: 3, left: 2, right: 4 },
          },
        },
      ]);

      // ── Linhas de transação (já ordenadas por favorecido) ────────────────
      linesSorted.forEach((line) => {
        const t = line.tx;
        const entity = t.entityId ? entitiesMap[t.entityId] : undefined;
        const entityName = entity?.name || t.supplierOrClient || "-";
        const entityDoc = entity?.document || "-";
        const isIncome = t.type === "receivable";
        const statusColor: [number, number, number] =
          line.stage === "realized" ? GREEN_600 : SLATE_600;

        tableBody.push([
          {
            content: format(line.date, "dd/MM"),
            styles: { halign: "center" },
          },
          lineDescription(line),
          entityName,
          entityDoc,
          {
            content: lineStatus(line),
            styles: { textColor: statusColor, halign: "center" },
          },
          {
            content: `${isIncome ? "+" : "-"}${formatCurrency(line.amount)}`,
            styles: {
              textColor: isIncome ? GREEN_600 : RED_600,
              fontStyle: "bold",
              halign: "right",
            },
          },
        ]);
      });
    });

    // ── Larguras das colunas (landscape A4 = 297mm, usable ~269mm) ─────────
    const col0 = 20; // Data (aumentado para evitar quebra de "dd/MM")
    const col3 = 38; // CNPJ/CPF
    const col4 = 26; // Status
    const col5 = 36; // Valor
    const col1 = 68; // Descrição
    const col2 = Math.max(46, USABLE_W - col0 - col1 - col3 - col4 - col5); // Favorecido

    autoTable(doc, {
      startY: kpiY + kpiH + 6,
      head: [
        ["Data", "Descrição", "Favorecido", "CNPJ/CPF", "Status", "Valor (R$)"],
      ],
      body: tableBody,
      theme: "plain",
      columnStyles: {
        0: { cellWidth: col0 },
        1: { cellWidth: col1 },
        2: { cellWidth: col2 },
        3: { cellWidth: col3 },
        4: { cellWidth: col4 },
        5: { cellWidth: col5, halign: "right" },
      },
      styles: {
        font: reportFont,
        fontSize: 8.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
        lineColor: SLATE_300,
        lineWidth: 0.15,
        overflow: "linebreak",
      },
      headStyles: {
        font: reportFont,
        fontStyle: "bold",
        fontSize: 8,
        fillColor: NAVY,
        textColor: WHITE,
        cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: SLATE_50 },
      showHead: "everyPage",
      rowPageBreak: "auto",
      didDrawPage: () => {
        doc.setCharSpace(0);
        doc.setFont(reportFont, "normal");
      },
      margin: { top: 15, left: MARGIN, right: MARGIN, bottom: 18 },
    });

    // ════════════════════════════════════════════════════════════════════════
    // RODAPÉ EM TODAS AS PÁGINAS
    // ════════════════════════════════════════════════════════════════════════
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawFooter(p, totalPages);
    }

    // ════════════════════════════════════════════════════════════════════════
    // CAIXA DE RESUMO FINAL
    // ════════════════════════════════════════════════════════════════════════
    doc.setPage(totalPages);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finalY = (doc as any).lastAutoTable.finalY + 8;

    if (finalY + 22 > PAGE_H - 20) {
      doc.addPage();
      finalY = 20;
      drawFooter(totalPages + 1, totalPages + 1);
    }

    const summaryH = 20;
    fillRGB(NAVY);
    doc.setLineWidth(0);
    doc.roundedRect(MARGIN, finalY, USABLE_W, summaryH, 2, 2, "F");

    // Label "RESUMO"
    doc.setFont(reportFont, "bold");
    doc.setFontSize(7.5);
    textRGB(GRAY_400);
    doc.text("RESUMO DO PERÍODO", MARGIN + 5, finalY + 8);

    const summaryItems = [
      {
        label: "Saldo Inicial",
        value: formatCurrency(report.opening),
        color: GRAY_300,
      },
      {
        label: "Total Entradas",
        value: formatCurrency(totalIn),
        color: [134, 239, 172] as [number, number, number],
      },
      {
        label: "Total Saídas",
        value: formatCurrency(totalOut),
        color: [252, 165, 165] as [number, number, number],
      },
      {
        label: "Saldo Final",
        value: formatCurrency(closing),
        color:
          closing >= 0
            ? ([134, 239, 172] as [number, number, number])
            : ([252, 165, 165] as [number, number, number]),
      },
    ];

    const blockW = USABLE_W / (summaryItems.length + 1);
    summaryItems.forEach((item, i) => {
      const x = MARGIN + (i + 1) * blockW;
      doc.setFont(reportFont, "normal");
      doc.setFontSize(7);
      textRGB(GRAY_400);
      doc.text(item.label, x, finalY + 8);
      doc.setFont(reportFont, "bold");
      doc.setFontSize(9.5);
      textRGB(item.color);
      doc.text(item.value, x, finalY + 16);
    });

    doc.save(`fluxo_caixa_${periodSlug(startDate, endDate)}.pdf`);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTAR EXCEL — workbook profissional
  // ─────────────────────────────────────────────────────────────────────────
  exportCashFlowExcel: async (report: CashFlowReport, ctx: ReportContext) => {
    const { start: startDate, end: endDate, companyName } = ctx;
    const entities = ctx.entities ?? [];
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FinControl";
    workbook.created = new Date();

    // ── Mapa de entidades ─────────────────────────────────────────────────
    const entitiesMap = entities.reduce(
      (acc, e) => {
        acc[e.id] = e;
        return acc;
      },
      {} as Record<string, Entity>,
    );

    const nameOf = (t: Transaction) =>
      (
        (t.entityId ? entitiesMap[t.entityId]?.name : undefined) ||
        t.supplierOrClient ||
        ""
      ).toLowerCase();
    const sorted = [...report.lines].sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        // Ordenação secundária por favorecido (mesmo critério do PDF)
        nameOf(a.tx).localeCompare(nameOf(b.tx), "pt-BR", {
          sensitivity: "base",
        }),
    );

    // ── Totais: os mesmos da tela ─────────────────────────────────────────
    const totalIn = report.inflow;
    const totalOut = report.outflow;
    const netBal = report.net;

    // ══════════════════════════════════════════════════════════════════════
    // ABA "Extrato"
    // ══════════════════════════════════════════════════════════════════════
    const sheet = workbook.addWorksheet("Extrato", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    sheet.columns = [
      { width: 14 }, // A: Data
      { width: 14 }, // B: Vencimento
      { width: 38 }, // C: Descrição
      { width: 30 }, // D: Favorecido
      { width: 20 }, // E: CNPJ/CPF
      { width: 12 }, // F: Tipo
      { width: 18 }, // G: Status
      { width: 18 }, // H: Valor Original
      { width: 18 }, // I: Valor Final
      { width: 24 }, // J: Forma de Pagamento
      { width: 30 }, // K: Observações
      { width: 18 }, // L: NF
      { width: 18 }, // M: Comprovante
    ];

    // ── Linha 1: Empresa ──────────────────────────────────────────────────
    sheet.mergeCells("A1:M1");
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

    // ── Linha 2: Subtítulo ────────────────────────────────────────────────
    sheet.mergeCells("A2:M2");
    const r2 = sheet.getCell("A2");
    r2.value = `Extrato de Fluxo de Caixa  ·  ${periodText(startDate, endDate)}${filterSuffix(ctx)}  ·  Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
    r2.font = { size: 9, color: { argb: "FF64748B" } };
    r2.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" },
    };
    r2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    sheet.getRow(2).height = 16;

    // ── Linha 3: Espaço separador ─────────────────────────────────────────
    sheet.getRow(3).height = 4;

    // ── Linha 4: Cabeçalho das colunas ───────────────────────────────────
    const headers = [
      "Data Efetiva",
      "Vencimento",
      "Descrição",
      "Favorecido",
      "CNPJ/CPF",
      "Tipo",
      "Situação",
      "Valor Original (R$)",
      "Valor no Fluxo (R$)",
      "Forma de Pagamento",
      "Observações",
      "NF",
      "Comprovante",
    ];
    const headerRow = sheet.addRow(headers);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
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
    });

    // ── Linhas de dados ───────────────────────────────────────────────────
    const BRL_FMT = '"R$" #,##0.00';

    sorted.forEach((line, idx) => {
      const t = line.tx;
      const entity = t.entityId ? entitiesMap[t.entityId] : undefined;
      const isIncome = t.type === "receivable";
      const effAmount = line.amount;

      // Localizar URL da NF (anexo com categoria "invoice")
      const invoiceAttachment = t.attachments?.find(
        (a) => a.category === "invoice",
      );
      const nfUrl = invoiceAttachment?.url || "";
      const comprovanteUrl = t.comprovanteUrl || "";

      const row = sheet.addRow([
        format(line.date, "dd/MM/yyyy"),
        format(t.dueDate, "dd/MM/yyyy"),
        lineDescription(line),
        entity?.name || t.supplierOrClient || "",
        entity?.document || "",
        isIncome ? "Receita" : "Despesa",
        lineStatus(line),
        t.amount,
        isIncome ? effAmount : -effAmount,
        t.paymentMethod || "",
        t.notes || "",
        "", // NF (preenchido abaixo como hyperlink)
        "", // Comprovante (preenchido abaixo como hyperlink)
      ]);

      row.height = 18;

      // Hyperlink da NF
      const cellNF = row.getCell(12);
      if (nfUrl) {
        cellNF.value = { text: "Baixar NF", hyperlink: nfUrl };
        cellNF.font = {
          color: { argb: "FF2563EB" },
          underline: true,
          size: 9,
        };
      } else {
        cellNF.value = "-";
        cellNF.font = { color: { argb: "FF94A3B8" }, size: 9 };
      }
      cellNF.alignment = { horizontal: "center", vertical: "middle" };

      // Hyperlink do Comprovante
      const cellComp = row.getCell(13);
      if (comprovanteUrl) {
        cellComp.value = {
          text: "Baixar Comprovante",
          hyperlink: comprovanteUrl,
        };
        cellComp.font = {
          color: { argb: "FF2563EB" },
          underline: true,
          size: 9,
        };
      } else {
        cellComp.value = "-";
        cellComp.font = { color: { argb: "FF94A3B8" }, size: 9 };
      }
      cellComp.alignment = { horizontal: "center", vertical: "middle" };

      // Formatação das células de valor
      const cellOrig = row.getCell(8);
      const cellFinal = row.getCell(9);
      cellOrig.numFmt = BRL_FMT;
      cellFinal.numFmt = BRL_FMT;
      cellOrig.alignment = { horizontal: "right" };
      cellFinal.alignment = { horizontal: "right" };

      // Cor do valor final
      cellFinal.font = {
        bold: true,
        color: { argb: isIncome ? "FF16A34A" : "FFDC2626" },
      };

      // Zebra striping alternado por linha
      if (idx % 2 === 0) {
        const bgColor = { argb: isIncome ? "FFF0FDF4" : "FFFEF2F2" };
        for (let c = 1; c <= 13; c++) {
          const cell = row.getCell(c);
          if (
            !cell.fill ||
            (cell.fill as { type: string }).type !== "pattern"
          ) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: bgColor };
          }
        }
      }

      // Borda inferior suave
      for (let c = 1; c <= 13; c++) {
        row.getCell(c).border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      }
    });

    // ── Linha de totais: resultado do período na coluna do valor no fluxo ─
    const totalsRow = sheet.addRow([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "RESULTADO",
      netBal,
      "",
      "",
      "",
      "",
    ]);
    totalsRow.height = 20;

    const tLabel = totalsRow.getCell(8);
    tLabel.font = { bold: true, size: 9, color: { argb: "FF0F172A" } };
    tLabel.alignment = { horizontal: "right" };
    tLabel.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };

    const tBal = totalsRow.getCell(9);
    tBal.numFmt = BRL_FMT;
    tBal.font = {
      bold: true,
      color: { argb: netBal >= 0 ? "FF16A34A" : "FFDC2626" },
    };
    tBal.alignment = { horizontal: "right" };
    tBal.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };

    // ══════════════════════════════════════════════════════════════════════
    // ABA "Fluxo" — a mesma tabela da tela, com saldo acumulado
    // ══════════════════════════════════════════════════════════════════════
    const flow = workbook.addWorksheet("Fluxo", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    flow.columns = [
      { header: "Período", width: 16 },
      { header: "Entradas", width: 18 },
      { header: "Saídas", width: 18 },
      { header: "Resultado", width: 18 },
      { header: "Saldo", width: 18 },
      { header: "Tem previsto", width: 14 },
    ];
    flow.getRow(1).font = { bold: true };
    const openingRow = flow.addRow([
      "Saldo inicial",
      null,
      null,
      null,
      report.opening,
      "",
    ]);
    openingRow.font = { italic: true };
    for (const b of report.buckets) {
      flow.addRow([
        b.label,
        b.inflow,
        -b.outflow,
        b.net,
        b.balance,
        b.forecast ? "sim" : "",
      ]);
    }
    const flowTotal = flow.addRow([
      "Total",
      totalIn,
      -totalOut,
      netBal,
      report.closing,
      "",
    ]);
    flowTotal.font = { bold: true };
    flow.eachRow((row, n) => {
      if (n === 1) return;
      for (let c = 2; c <= 5; c++) row.getCell(c).numFmt = BRL_FMT;
    });

    // ══════════════════════════════════════════════════════════════════════
    // ABA "Resumo"
    // ══════════════════════════════════════════════════════════════════════
    const summary = workbook.addWorksheet("Resumo");
    summary.columns = [{ width: 28 }, { width: 22 }];

    const addSummaryTitle = (text: string) => {
      summary.mergeCells(`A${summary.rowCount + 1}:B${summary.rowCount + 1}`);
      const row = summary.lastRow!;
      row.getCell(1).value = text;
      row.getCell(1).font = {
        bold: true,
        size: 11,
        color: { argb: "FF0F172A" },
      };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      row.height = 20;
    };

    const addSummaryRow = (
      label: string,
      value: string | number,
      numFmt?: string,
      color?: string,
    ) => {
      const row = summary.addRow([label, value]);
      row.height = 18;
      row.getCell(1).font = { color: { argb: "FF475569" } };
      if (numFmt) {
        row.getCell(2).numFmt = numFmt;
        row.getCell(2).alignment = { horizontal: "right" };
      }
      if (color) row.getCell(2).font = { bold: true, color: { argb: color } };
      row.getCell(1).border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
      };
      row.getCell(2).border = {
        bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
      };
    };

    addSummaryTitle("Informações do Relatório");
    addSummaryRow("Empresa", companyName);
    addSummaryRow("Período", periodText(startDate, endDate));
    if (ctx.filters) addSummaryRow("Recorte", ctx.filters);
    addSummaryRow("Gerado em", format(new Date(), "dd/MM/yyyy HH:mm"));
    addSummaryRow("Total de lançamentos", sorted.length);
    summary.addRow([]);

    addSummaryTitle("Resultado Financeiro");
    addSummaryRow("Saldo Inicial", report.opening, BRL_FMT);
    addSummaryRow("Total Entradas", totalIn, BRL_FMT, "FF16A34A");
    addSummaryRow("Total Saídas", totalOut, BRL_FMT, "FFDC2626");
    addSummaryRow(
      "Saldo Final",
      report.closing,
      BRL_FMT,
      report.closing >= 0 ? "FF16A34A" : "FFDC2626",
    );
    addSummaryRow(
      `Menor saldo (${format(report.lowest.date, "dd/MM/yyyy")})`,
      report.lowest.balance,
      BRL_FMT,
      report.lowest.balance >= 0 ? undefined : "FFDC2626",
    );
    summary.addRow([]);

    addSummaryTitle("Por Situação (entradas − saídas)");
    for (const s of report.byStage) {
      if (s.lines.length === 0) continue;
      addSummaryRow(
        STAGE_INFO[s.stage].label,
        currency(s.inflow).subtract(s.outflow).value,
        BRL_FMT,
      );
    }
    summary.addRow([]);

    // ── Aviso de confidencialidade ────────────────────────────────────────
    addSummaryTitle("Aviso de Confidencialidade");
    const warningRow = summary.addRow([
      "Este documento contém links de acesso direto a notas fiscais e comprovantes de pagamento. " +
        "Qualquer pessoa com acesso a esta planilha poderá baixar os arquivos através dos links " +
        "nas colunas NF e Comprovante da aba Extrato. Não compartilhe este arquivo com pessoas " +
        "não autorizadas.",
    ]);
    summary.mergeCells(`A${warningRow.number}:B${warningRow.number}`);
    warningRow.getCell(1).font = {
      color: { argb: "FFDC2626" },
      size: 9,
      italic: true,
    };
    warningRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFEF2F2" },
    };
    warningRow.getCell(1).alignment = {
      wrapText: true,
      vertical: "top",
    };
    warningRow.height = 48;

    // ── Gerar arquivo e disparar download ─────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], { type: XLSX_TYPE }),
      `fluxo_caixa_${periodSlug(startDate, endDate)}.xlsx`,
    );
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
    workbook.creator = "FinControl";
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
  ): Promise<{ failed: number }> => {
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
      return { failed: 0 };
    }
    const { bytes, failed } = await appendReceipts(
      pdf,
      report.lines.filter((l) => annex.has(l.tx.id)),
      (l) => annex.get(l.tx.id)!,
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
    workbook.creator = "FinControl";
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
    workbook.creator = "FinControl";
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
    const accountById = new Map((ctx.accounts ?? []).map((a) => [a.id, a]));
    const ccName = new Map((ctx.costCenters ?? []).map((c) => [c.id, c.name]));
    const entityById = new Map((ctx.entities ?? []).map((e) => [e.id, e]));
    const costCentersOf = (t: Transaction) =>
      (t.costCenterAllocation?.length
        ? t.costCenterAllocation.map((a) => a.costCenterId)
        : t.costCenterId
          ? [t.costCenterId]
          : []
      )
        .map((id) => ccName.get(id) ?? id)
        .join(", ");

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
        const entity = t.entityId ? entityById.get(t.entityId) : undefined;
        const account = t.accountId ? accountById.get(t.accountId) : undefined;
        return [
          line.date,
          t.dueDate,
          t.paymentDate,
          lineDescription(line),
          t.type === "payable" ? "Despesa" : "Receita",
          entity?.name ?? t.supplierOrClient ?? "",
          entity?.document ?? "",
          lineStatus(line),
          t.amount,
          t.type === "payable" ? -line.amount : line.amount,
          costCentersOf(t),
          account ? `${account.code} ${account.name}` : "",
          t.competence
            ? `${t.competence.slice(5)}/${t.competence.slice(0, 4)}`
            : "",
          t.paymentMethod ? (PAYMENT_METHOD_TEXT[t.paymentMethod] ?? "") : "",
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

const PAYMENT_METHOD_TEXT: Record<string, string> = {
  pix: "PIX",
  boleto: "Boleto",
  transfer: "Transferência",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
};
