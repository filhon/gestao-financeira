import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Transaction, Entity } from "@/lib/types";
import { format, addDays, startOfDay, isAfter, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatCurrency } from "@/lib/utils";

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
  generateCashFlowPDF: async (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
    entities: Entity[] = [],
  ) => {
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

    // ── Pré-calcular totais ───────────────────────────────────────────────
    const eff = (t: Transaction) =>
      t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;

    const totalIn = transactions
      .filter((t) => t.type === "receivable")
      .reduce((s, t) => s + eff(t), 0);
    const totalOut = transactions
      .filter((t) => t.type === "payable")
      .reduce((s, t) => s + eff(t), 0);
    const netBal = totalIn - totalOut;

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
      `Período: ${format(startDate, "dd/MM/yyyy")} — ${format(endDate, "dd/MM/yyyy")}`,
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

    // ════════════════════════════════════════════════════════════════════════
    // KPI CARDS (3 caixas de resumo)
    // ════════════════════════════════════════════════════════════════════════
    const kpiY = 42;
    const kpiH = 22;
    const kpiGap = 5;
    const kpiW = (USABLE_W - kpiGap * 2) / 3;

    const kpis: {
      label: string;
      value: string;
      accent: [number, number, number];
      bg: [number, number, number];
      border: [number, number, number];
    }[] = [
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
        label: "SALDO DO PERÍODO",
        value: formatCurrency(netBal),
        accent: netBal >= 0 ? GREEN_600 : RED_600,
        bg: netBal >= 0 ? GREEN_50 : RED_50,
        border: netBal >= 0 ? GREEN_200 : RED_200,
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

    // Ordenar por data efetiva
    const sorted = [...transactions].sort((a, b) => {
      const dA =
        a.status === "paid" && a.paymentDate ? a.paymentDate : a.dueDate;
      const dB =
        b.status === "paid" && b.paymentDate ? b.paymentDate : b.dueDate;
      return dA.getTime() - dB.getTime();
    });

    // Agrupar por dia
    const dayMap = new Map<string, { date: Date; txs: Transaction[] }>();
    const dayOrder: string[] = [];

    sorted.forEach((t) => {
      const d =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const key = format(d, "yyyy-MM-dd");
      if (!dayMap.has(key)) {
        dayMap.set(key, { date: d, txs: [] });
        dayOrder.push(key);
      }
      dayMap.get(key)!.txs.push(t);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableBody: any[][] = [];

    dayOrder.forEach((dateKey) => {
      const { date, txs } = dayMap.get(dateKey)!;

      // ── Ordenar por favorecido dentro do mesmo dia ───────────────────────
      const txsSorted = [...txs].sort((a, b) => {
        const entA = a.entityId ? entitiesMap[a.entityId] : undefined;
        const entB = b.entityId ? entitiesMap[b.entityId] : undefined;
        const nameA = (entA?.name || a.supplierOrClient || "").toLowerCase();
        const nameB = (entB?.name || b.supplierOrClient || "").toLowerCase();
        return nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" });
      });

      const dayIn = txs
        .filter((t) => t.type === "receivable")
        .reduce((s, t) => s + eff(t), 0);
      const dayOut = txs
        .filter((t) => t.type === "payable")
        .reduce((s, t) => s + eff(t), 0);
      const daySummary = [
        dayIn > 0 ? `+${formatCurrency(dayIn)}` : null,
        dayOut > 0 ? `-${formatCurrency(dayOut)}` : null,
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
      txsSorted.forEach((t) => {
        const effectiveDate =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        const effectiveAmount = eff(t);
        const entity = t.entityId ? entitiesMap[t.entityId] : undefined;
        const entityName = entity?.name || t.supplierOrClient || "-";
        const entityDoc = entity?.document || "-";
        const isIncome = t.type === "receivable";
        const statusText = STATUS_LABEL[t.status] || t.status;
        const statusColor: [number, number, number] =
          t.status === "paid"
            ? GREEN_600
            : t.status === "rejected"
              ? RED_600
              : SLATE_600;

        tableBody.push([
          {
            content: format(effectiveDate, "dd/MM"),
            styles: { halign: "center" },
          },
          t.description || "-",
          entityName,
          entityDoc,
          {
            content: statusText,
            styles: { textColor: statusColor, halign: "center" },
          },
          {
            content: `${isIncome ? "+" : "-"}${formatCurrency(effectiveAmount)}`,
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
        label: "Saldo Líquido",
        value: formatCurrency(netBal),
        color:
          netBal >= 0
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

    doc.save(`fluxo_caixa_${format(new Date(), "yyyyMMdd")}.pdf`);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTAR EXCEL — workbook profissional
  // ─────────────────────────────────────────────────────────────────────────
  exportToExcel: async (
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

    // ── Mapa de entidades ─────────────────────────────────────────────────
    const entitiesMap = entities.reduce(
      (acc, e) => {
        acc[e.id] = e;
        return acc;
      },
      {} as Record<string, Entity>,
    );

    const eff = (t: Transaction) =>
      t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;

    const sorted = [...transactions].sort((a, b) => {
      const dA =
        a.status === "paid" && a.paymentDate ? a.paymentDate : a.dueDate;
      const dB =
        b.status === "paid" && b.paymentDate ? b.paymentDate : b.dueDate;
      const dateDiff = dA.getTime() - dB.getTime();
      if (dateDiff !== 0) return dateDiff;
      // Ordenação secundária por favorecido (mesmo critério do PDF)
      const entA = a.entityId ? entitiesMap[a.entityId] : undefined;
      const entB = b.entityId ? entitiesMap[b.entityId] : undefined;
      const nameA = (entA?.name || a.supplierOrClient || "").toLowerCase();
      const nameB = (entB?.name || b.supplierOrClient || "").toLowerCase();
      return nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" });
    });

    // ── Totais ────────────────────────────────────────────────────────────
    const totalIn = sorted
      .filter((t) => t.type === "receivable")
      .reduce((s, t) => s + eff(t), 0);
    const totalOut = sorted
      .filter((t) => t.type === "payable")
      .reduce((s, t) => s + eff(t), 0);
    const netBal = totalIn - totalOut;

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
    ];

    // ── Linha 1: Empresa ──────────────────────────────────────────────────
    sheet.mergeCells("A1:K1");
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
    sheet.mergeCells("A2:K2");
    const r2 = sheet.getCell("A2");
    r2.value = `Extrato de Fluxo de Caixa  ·  ${format(startDate, "dd/MM/yyyy")} — ${format(endDate, "dd/MM/yyyy")}  ·  Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`;
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
      "Status",
      "Valor Original (R$)",
      "Valor Final (R$)",
      "Forma de Pagamento",
      "Observações",
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

    sorted.forEach((t, idx) => {
      const effectiveDate =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const entity = t.entityId ? entitiesMap[t.entityId] : undefined;
      const isIncome = t.type === "receivable";
      const effAmount = eff(t);

      const row = sheet.addRow([
        format(effectiveDate, "dd/MM/yyyy"),
        format(t.dueDate, "dd/MM/yyyy"),
        t.description || "",
        entity?.name || t.supplierOrClient || "",
        entity?.document || "",
        isIncome ? "Receita" : "Despesa",
        STATUS_LABEL[t.status] || t.status,
        t.amount,
        isIncome ? effAmount : -effAmount,
        t.paymentMethod || "",
        t.notes || "",
      ]);

      row.height = 18;

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
        for (let c = 1; c <= 11; c++) {
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
      for (let c = 1; c <= 11; c++) {
        row.getCell(c).border = {
          bottom: { style: "hair", color: { argb: "FFE2E8F0" } },
        };
      }
    });

    // ── Linha de totais ───────────────────────────────────────────────────
    const totalsRow = sheet.addRow([
      "",
      "",
      "",
      "",
      "",
      "",
      "TOTAL",
      totalIn,
      netBal,
      "",
      "",
    ]);
    totalsRow.height = 20;

    const tLabel = totalsRow.getCell(7);
    tLabel.font = { bold: true, size: 9, color: { argb: "FF0F172A" } };
    tLabel.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" },
    };
    tLabel.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };

    const tIn = totalsRow.getCell(8);
    tIn.numFmt = BRL_FMT;
    tIn.font = { bold: true, color: { argb: "FF16A34A" } };
    tIn.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0FDF4" },
    };
    tIn.alignment = { horizontal: "right" };
    tIn.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };

    const tBal = totalsRow.getCell(9);
    tBal.numFmt = BRL_FMT;
    tBal.font = {
      bold: true,
      color: { argb: netBal >= 0 ? "FF16A34A" : "FFDC2626" },
    };
    tBal.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: netBal >= 0 ? "FFF0FDF4" : "FFFEF2F2" },
    };
    tBal.alignment = { horizontal: "right" };
    tBal.border = { top: { style: "medium", color: { argb: "FF0F172A" } } };

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
    addSummaryRow(
      "Período",
      `${format(startDate, "dd/MM/yyyy")} — ${format(endDate, "dd/MM/yyyy")}`,
    );
    addSummaryRow("Gerado em", format(new Date(), "dd/MM/yyyy HH:mm"));
    addSummaryRow("Total de lançamentos", sorted.length);
    summary.addRow([]);

    addSummaryTitle("Resultado Financeiro");
    addSummaryRow("Total Entradas", totalIn, BRL_FMT, "FF16A34A");
    addSummaryRow("Total Saídas", totalOut, BRL_FMT, "FFDC2626");
    addSummaryRow(
      "Saldo Líquido",
      netBal,
      BRL_FMT,
      netBal >= 0 ? "FF16A34A" : "FFDC2626",
    );
    summary.addRow([]);

    addSummaryTitle("Entradas por Status");
    const byStatus = sorted.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + eff(t);
        return acc;
      },
      {} as Record<string, number>,
    );
    Object.entries(byStatus).forEach(([status, total]) => {
      addSummaryRow(STATUS_LABEL[status] || status, total, BRL_FMT);
    });

    // ── Gerar arquivo e disparar download ─────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fluxo_caixa_${format(new Date(), "yyyyMMdd")}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FLUXO DE CAIXA CONSOLIDADO (projeções)
  // ─────────────────────────────────────────────────────────────────────────
  generateConsolidatedCashFlowPDF: async (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
    initialBalance: number = 0,
  ) => {
    const doc = new jsPDF();
    const reportFont = await ensureReportFont(doc);

    const headerColor = [34, 47, 62];

    doc.setFontSize(22);
    doc.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
    doc.text("Fluxo de Caixa Consolidado", 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(companyName, 14, 28);
    doc.text(
      `Período de Análise: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`,
      14,
      33,
    );
    doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 38);

    const dayMap = new Map<string, { in: number; out: number }>();

    transactions.forEach((t) => {
      const date =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      if (isBefore(date, startOfDay(startDate)) || isAfter(date, endDate))
        return;

      const dateKey = format(date, "yyyy-MM-dd");
      const current = dayMap.get(dateKey) || { in: 0, out: 0 };

      const effectiveAmount =
        t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;

      if (t.type === "receivable") {
        current.in += effectiveAmount;
      } else {
        current.out += effectiveAmount;
      }
      dayMap.set(dateKey, current);
    });

    let currentBalance = initialBalance;
    let minBalance = initialBalance;
    let minBalanceDate = startDate;

    const tableRows: (string | number)[][] = [];
    let currDate = startOfDay(startDate);
    const end = startOfDay(endDate);

    if (initialBalance !== 0) {
      tableRows.push([
        format(startDate, "dd/MM/yyyy"),
        "-",
        "-",
        formatCurrency(initialBalance),
      ]);
    }

    while (!isAfter(currDate, end)) {
      const dateKey = format(currDate, "yyyy-MM-dd");
      const dayData = dayMap.get(dateKey);

      if (dayData) {
        currentBalance += dayData.in - dayData.out;

        if (currentBalance < minBalance) {
          minBalance = currentBalance;
          minBalanceDate = new Date(currDate);
        }

        tableRows.push([
          format(currDate, "dd/MM/yyyy"),
          formatCurrency(dayData.in),
          formatCurrency(dayData.out),
          formatCurrency(currentBalance),
        ]);
      }

      currDate = addDays(currDate, 1);
    }

    autoTable(doc, {
      startY: 45,
      head: [["Data", "Entradas", "Saídas", "Saldo Acumulado"]],
      body: tableRows,
      theme: "plain",
      showHead: "firstPage",
      styles: {
        font: reportFont,
        fontSize: 10,
        cellPadding: 3,
        lineColor: [220, 220, 220],
        lineWidth: 0.1,
      },
      headStyles: {
        font: reportFont,
        fillColor: [245, 245, 245],
        textColor: [50, 50, 50],
        fontStyle: "bold",
        lineWidth: 0,
      },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 40, halign: "right", textColor: [27, 94, 32] },
        2: { cellWidth: 40, halign: "right", textColor: [183, 28, 28] },
        3: { cellWidth: 40, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 3) {
          const balanceStr = data.cell.raw as string;
          if (balanceStr.includes("-")) {
            data.cell.styles.textColor = [192, 57, 43];
          }
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finalY = (doc as any).lastAutoTable.finalY + 15;

    if (finalY > 250) {
      doc.addPage();
      finalY = 20;
    }

    doc.setFontSize(14);
    doc.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
    doc.text("Análise de Riscos & Sugestões", 14, finalY);

    doc.setFontSize(10);
    doc.setTextColor(60);
    finalY += 8;

    const saldoFinal = currentBalance;

    doc.text(
      `Saldo Inicial Informado: ${formatCurrency(initialBalance)}`,
      14,
      finalY,
    );
    finalY += 6;
    doc.text(
      `Saldo Final do Período: ${formatCurrency(saldoFinal)}`,
      14,
      finalY,
    );
    finalY += 10;

    if (minBalance < 0) {
      doc.setFillColor(253, 237, 236);
      doc.setDrawColor(192, 57, 43);
      doc.rect(14, finalY, 180, 25, "FD");

      doc.setTextColor(192, 57, 43);
      doc.setFont("helvetica", "bold");
      doc.text("ALERTA DE CAIXA: QUEBRA IDENTIFICADA", 20, finalY + 8);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(50);
      doc.text(
        `Identificamos que o saldo atingirá o valor mínimo de ${formatCurrency(minBalance)} no dia ${format(minBalanceDate, "dd/MM/yyyy")}.`,
        20,
        finalY + 16,
      );
      doc.text(
        `Sugestão de Aporte: Recomenda-se um aporte de pelo menos ${formatCurrency(Math.abs(minBalance))} antes desta data.`,
        20,
        finalY + 22,
      );
    } else {
      doc.setFillColor(232, 248, 245);
      doc.setDrawColor(39, 174, 96);
      doc.rect(14, finalY, 180, 15, "FD");

      doc.setTextColor(39, 174, 96);
      doc.setFont("helvetica", "bold");
      doc.text("CENÁRIO SAUDÁVEL", 20, finalY + 10);
    }

    doc.save(`fluxo_caixa_consolidado_${format(new Date(), "yyyyMMdd")}.pdf`);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DRE
  // ─────────────────────────────────────────────────────────────────────────
  generateDREPDF: async (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
  ) => {
    const doc = new jsPDF();
    const reportFont = await ensureReportFont(doc);

    doc.setFontSize(18);
    doc.text("Demonstrativo de Resultados (DRE)", 14, 20);
    doc.setFontSize(12);
    doc.text(companyName, 14, 30);
    doc.text(
      `Período: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`,
      14,
      36,
    );

    const revenue = transactions
      .filter((t) => t.type === "receivable")
      .reduce((acc, t) => acc + t.amount, 0);
    const expenses = transactions
      .filter((t) => t.type === "payable")
      .reduce((acc, t) => acc + t.amount, 0);
    const result = revenue - expenses;

    const tableData = [
      ["Receita Bruta", formatCurrency(revenue)],
      ["(-) Despesas Operacionais", formatCurrency(expenses)],
      ["(=) Resultado Operacional", formatCurrency(result)],
    ];

    autoTable(doc, {
      startY: 45,
      head: [["Descrição", "Valor"]],
      body: tableData,
      showHead: "firstPage",
      styles: { font: reportFont, fontSize: 10, cellPadding: 3 },
      headStyles: { font: reportFont, fontStyle: "bold" },
    });

    doc.save(`dre_${format(new Date(), "yyyyMMdd")}.pdf`);
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORTAR CSV
  // ─────────────────────────────────────────────────────────────────────────
  exportToCSV: (transactions: Transaction[]) => {
    const escapeCSV = (value: string | undefined | null): string => {
      const str = value ?? "";
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      "Data Vencimento",
      "Data Pagamento",
      "Descrição",
      "Tipo",
      "Entidade",
      "Valor Original",
      "Valor Final",
      "Status",
      "Centro de Custo",
      "Forma de Pagamento",
      "Observações",
    ];

    const rows = transactions.map((t) => [
      format(t.dueDate, "yyyy-MM-dd"),
      t.paymentDate ? format(t.paymentDate, "yyyy-MM-dd") : "",
      escapeCSV(t.description),
      t.type === "payable" ? "Despesa" : "Receita",
      escapeCSV(t.supplierOrClient),
      t.amount.toFixed(2),
      (t.finalAmount ?? t.amount).toFixed(2),
      t.status,
      t.costCenterId ?? "",
      t.paymentMethod ?? "",
      escapeCSV(t.notes),
    ]);

    const BOM = "\uFEFF";
    const csvContent =
      BOM + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `transacoes_${format(new Date(), "yyyyMMdd")}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
