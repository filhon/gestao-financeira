/**
 * PDF do fluxo de caixa: a síntese que a contabilidade lê (prova contra o
 * banco, para onde foi, o que falta) e o extrato em anexo.
 */
import type jsPDF from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import currency from "currency.js";
import { differenceInCalendarDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Transaction } from "@/lib/types";
import { niceTicks } from "@/lib/dashboardRules";
import {
  lineSituation,
  formatPercent,
  periodText,
  type CashFlowReport,
  type FlowLine,
} from "@/lib/reports";
import {
  proofNote,
  synthesisTitle,
  type BankProof,
  type Slice,
} from "@/lib/cashSynthesis";
import { formatCurrency } from "@/lib/utils";
import { formatCnpj, formatCpfCnpj } from "@/lib/validations/cnpj";
import {
  cashFlowNotes,
  ensureReportFont,
  lineDescription,
  lineLookups,
  loadPdf,
  synthesisOf,
  type CashFlowContext,
} from "@/lib/services/reportService";

type RGB = [number, number, number];

// A paleta do PDF da Análise.
const INK: RGB = [18, 22, 31];
const MUTED: RGB = [96, 99, 108];
const PRIMARY: RGB = [32, 44, 133];
const RULE: RGB = [213, 215, 221];
const GRID: RGB = [230, 232, 235];
const WASH: RGB = [243, 245, 249];
const BAR: RGB = [172, 180, 224];
const DANGER: RGB = [200, 0, 10];

const MARGIN = 14;
const TOP = 15;
const BOTTOM = 18;
const GAP = 12;

const finalY = (doc: jsPDF): number =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).lastAutoTable.finalY;

export async function buildCashFlowPdf(
  report: CashFlowReport,
  ctx: CashFlowContext,
): Promise<jsPDF> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const font = await ensureReportFont(doc);
  const title = `Síntese de caixa, ${periodText(ctx.start, ctx.end)}`;
  doc.setProperties({ title, author: ctx.companyName });
  doc.setLanguage("pt-BR");

  const PAGE_W = doc.internal.pageSize.getWidth(); // 297 mm
  const PAGE_H = doc.internal.pageSize.getHeight(); // 210 mm
  const RIGHT = PAGE_W - MARGIN;
  const USABLE_W = PAGE_W - MARGIN * 2;
  const COL_W = (USABLE_W - GAP) / 2;
  const COL2 = MARGIN + COL_W + GAP;

  const text = (
    value: string,
    x: number,
    y: number,
    o: {
      size: number;
      bold?: boolean;
      color?: RGB;
      align?: "right" | "center";
    },
  ) => {
    doc.setFont(font, o.bold ? "bold" : "normal");
    doc.setFontSize(o.size);
    doc.setTextColor(...(o.color ?? INK));
    doc.text(value, x, y, { align: o.align });
  };
  const paragraph = (
    value: string,
    x: number,
    y: number,
    w: number,
    o: { size: number; bold?: boolean; color?: RGB; leading?: number },
  ) => {
    doc.setFont(font, o.bold ? "bold" : "normal");
    doc.setFontSize(o.size);
    const leading = o.leading ?? o.size * 0.5;
    for (const line of doc.splitTextToSize(value, w) as string[]) {
      text(line, x, y, o);
      y += leading;
    }
    return y;
  };
  const rule = (y: number) => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, RIGHT, y);
  };
  const heading = (value: string, x: number, y: number) =>
    text(value, x, y, { size: 10.5, bold: true });

  const known = ctx.opening.source !== "none";
  const look = lineLookups(ctx);
  const data = synthesisOf(report, ctx);
  const proof = ctx.proof;

  const table = {
    theme: "plain" as const,
    styles: {
      font,
      fontSize: 8,
      textColor: INK,
      cellPadding: { top: 1.3, bottom: 1.3, left: 1.5, right: 1.5 },
      lineColor: RULE,
      lineWidth: { bottom: 0.1 },
      overflow: "linebreak" as const,
    },
    headStyles: {
      font,
      fontStyle: "bold" as const,
      fontSize: 7.5,
      textColor: MUTED,
      lineColor: INK,
      lineWidth: { bottom: 0.3 },
    },
    showHead: "everyPage" as const,
    rowPageBreak: "avoid" as const,
    didDrawPage: () => {
      doc.setCharSpace(0);
    },
  };

  /** Tabela numa coluna da página; números à direita, cabeçalho junto. */
  const columnTable = (
    x: number,
    y: number,
    cols: { header: string; width: number; right?: boolean }[],
    rows: { cells: string[]; strong?: boolean; danger?: boolean }[],
    o: {
      /** Barra proporcional ao valor da linha, na coluna sem cabeçalho. */
      bar?: { col: number; share: (row: number) => number };
      indent?: (row: number) => boolean;
    } = {},
  ) => {
    const width = cols.reduce((s, c) => s + c.width, 0);
    const options: UserOptions = {
      ...table,
      startY: y,
      margin: {
        top: TOP,
        bottom: BOTTOM,
        left: x,
        right: PAGE_W - x - width,
      },
      head: [cols.map((c) => c.header)],
      body: rows.map((r) => r.cells),
      columnStyles: Object.fromEntries(
        cols.map((c, i) => [i, { cellWidth: c.width }]),
      ),
      didParseCell: (d) => {
        const styles = d.cell.styles;
        if (cols[d.column.index]?.right) styles.halign = "right";
        if (d.section !== "body") return;
        const row = rows[d.row.index];
        if (row.strong) styles.fontStyle = "bold";
        if (row.danger) styles.textColor = DANGER;
        if (d.column.index === 0 && o.indent?.(d.row.index))
          styles.cellPadding = { ...table.styles.cellPadding, left: 5 };
      },
      didDrawCell: (d) => {
        if (!o.bar || d.section !== "body" || d.column.index !== o.bar.col)
          return;
        const share = o.bar.share(d.row.index);
        if (share <= 0) return;
        doc.setFillColor(...BAR);
        doc.rect(
          d.cell.x + 1,
          d.cell.y + d.cell.height / 2 - 1,
          Math.max(0.3, (d.cell.width - 2) * Math.min(1, share)),
          2,
          "F",
        );
      },
    };
    autoTable(doc, options);
    return finalY(doc);
  };

  // ════════════════════════════════════════════════════════════════════════
  // PÁGINA 1: a prova
  // ════════════════════════════════════════════════════════════════════════
  text(
    ctx.companyCnpj
      ? `${ctx.companyName}  ·  CNPJ ${formatCnpj(ctx.companyCnpj)}`
      : ctx.companyName,
    MARGIN,
    TOP,
    { size: 8, color: MUTED },
  );
  text(`Síntese de caixa  ·  ${periodText(ctx.start, ctx.end)}`, RIGHT, TOP, {
    size: 8,
    bold: true,
    align: "right",
  });
  text(
    [ctx.filters, `gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`]
      .filter(Boolean)
      .join("  ·  "),
    RIGHT,
    TOP + 4.5,
    { size: 7.5, color: MUTED, align: "right" },
  );
  let y = paragraph(
    synthesisTitle(report, proof, ctx.start, ctx.end, known),
    MARGIN,
    TOP + 14,
    USABLE_W,
    {
      size: 16,
      bold: true,
      color: proof.status === "mismatch" ? DANGER : PRIMARY,
      leading: 7,
    },
  );
  y += 1;
  rule(y);

  const sums: { label: string; value: number }[] = [
    ...(known ? [{ label: "Saldo inicial", value: report.opening }] : []),
    { label: "+ Entradas", value: report.inflow },
    { label: "− Saídas", value: report.outflow },
    { label: known ? "= Saldo final" : "= Acumulado", value: report.closing },
  ];
  const sumW = USABLE_W / sums.length;
  sums.forEach((s, i) => {
    const x = MARGIN + i * sumW;
    text(s.label, x, y + 7, { size: 8, color: MUTED });
    text(formatCurrency(s.value), x, y + 14, {
      size: 13,
      bold: true,
      color: s.value < 0 ? DANGER : INK,
    });
  });
  y += 20;
  for (const note of cashFlowNotes(report, ctx)) {
    y = paragraph(note, MARGIN, y, USABLE_W, { size: 8, color: MUTED });
  }
  y += 5;

  const rowTop = y;
  let leftY = drawProof(rowTop);
  let rightY = drawBalance(rowTop);
  const secondTop = Math.max(leftY, rightY) + 9;
  leftY = drawPayers(secondTop);
  doc.setPage(1);
  rightY = drawGaps(secondTop);

  function drawProof(at: number) {
    heading("Conferência com o banco", MARGIN, at);
    const note = proofNote(proof);
    if (!("rows" in proof) || proof.rows.length === 0) {
      return paragraph(note ?? "", MARGIN, at + 6, COL_W, {
        size: 8.5,
        color: MUTED,
      });
    }
    const p: BankProof = proof;
    const end = columnTable(
      MARGIN,
      at + 2.5,
      [
        { header: "Conta", width: COL_W - 66 },
        { header: "Extrato em", width: 26 },
        { header: "Saldo", width: 40, right: true },
      ],
      [
        ...p.rows.map((r) => ({
          cells: [
            r.name,
            r.date ? format(r.date, "dd/MM/yyyy") : "-",
            r.balance !== null
              ? formatCurrency(r.balance)
              : r.date
                ? "falta extrato"
                : "sem extrato",
          ],
          danger: r.balance === null && !!r.date,
        })),
        ...(p.total === null
          ? []
          : [
              {
                cells: ["Saldo no banco", "", formatCurrency(p.total)],
                strong: true,
              },
              {
                cells: ["Saldo no sistema", "", formatCurrency(report.closing)],
                strong: true,
              },
              {
                cells: [
                  "Diferença",
                  p.difference === 0 ? "confere" : "não confere",
                  formatCurrency(p.difference!),
                ],
                strong: true,
                danger: p.difference !== 0,
              },
            ]),
      ],
    );
    return note
      ? paragraph(note, MARGIN, end + 4, COL_W, { size: 8, color: MUTED })
      : end;
  }

  /** Saldo em degrau: entre um movimento e outro o dinheiro fica parado. */
  function drawBalance(at: number) {
    heading(
      known ? "Saldo ao fim de cada dia" : "Acumulado ao fim de cada dia",
      COL2,
      at,
    );
    if (data.daily.length === 0) {
      return paragraph("Sem movimento no período.", COL2, at + 6, COL_W, {
        size: 8.5,
        color: MUTED,
      });
    }
    const H = 44;
    const axis = 21;
    const x0 = COL2 + axis;
    const w = COL_W - axis;
    const top = at + 5;
    const values = [report.opening, ...data.daily.map((d) => d.balance)];
    const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const py = (v: number) => top + H * (1 - (v - lo) / (hi - lo || 1));
    const span = Math.max(1, differenceInCalendarDays(ctx.end, ctx.start) + 1);
    const px = (d: Date) =>
      x0 + (w * differenceInCalendarDays(d, ctx.start)) / span;

    const compact = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      notation: "compact",
      maximumFractionDigits: 1,
    });
    for (const t of ticks) {
      doc.setDrawColor(...(t === 0 ? MUTED : GRID));
      doc.setLineWidth(t === 0 ? 0.25 : 0.15);
      doc.line(x0, py(t), x0 + w, py(t));
      text(t === 0 ? "R$ 0" : compact.format(t), x0 - 2, py(t) + 1, {
        size: 6.5,
        color: MUTED,
        align: "right",
      });
    }
    doc.setDrawColor(...PRIMARY);
    doc.setLineWidth(0.5);
    let cx = x0;
    let cy = py(report.opening);
    const step = (toX: number, toY: number) => {
      doc.line(cx, cy, toX, cy);
      doc.line(toX, cy, toX, toY);
      cx = toX;
      cy = toY;
    };
    data.daily.forEach((d) => step(px(d.date), py(d.balance)));
    doc.line(cx, cy, x0 + w, cy);

    const { lowest } = report;
    doc.setFillColor(...(lowest.balance < 0 ? DANGER : PRIMARY));
    doc.circle(px(lowest.date), py(lowest.balance), 0.9, "F");
    for (const d of [ctx.start, ctx.end]) {
      text(format(d, "dd/MM"), d === ctx.start ? x0 : x0 + w, top + H + 4, {
        size: 6.5,
        color: MUTED,
        ...(d === ctx.end ? { align: "right" as const } : {}),
      });
    }
    text(
      `Menor: ${formatCurrency(lowest.balance)} em ${format(lowest.date, "dd/MM/yyyy")}`,
      x0 + w / 2,
      top + H + 4,
      {
        size: 7.5,
        align: "center",
        color: lowest.balance < 0 ? DANGER : INK,
      },
    );
    return top + H + 5;
  }

  function drawPayers(at: number) {
    heading("De onde veio", MARGIN, at);
    if (data.inflows.length === 0) {
      return paragraph("Nenhuma entrada no período.", MARGIN, at + 6, COL_W, {
        size: 8.5,
        color: MUTED,
      });
    }
    return columnTable(
      MARGIN,
      at + 2.5,
      [
        { header: "Pagador", width: COL_W - 62 },
        ...shareColumns(COL_W, "").slice(2),
      ],
      data.inflows.map((s) => {
        const [label, , ...numbers] = shareCells(s, report.inflow);
        return { cells: [label, ...numbers] };
      }),
    );
  }

  function drawGaps(at: number) {
    heading("O que falta", COL2, at);
    if (data.gaps.length === 0) {
      return paragraph(
        "Nada pendente: todo lançamento tem documento, conta contábil e favorecido identificado.",
        COL2,
        at + 6,
        COL_W,
        { size: 8.5, color: MUTED },
      );
    }
    return columnTable(
      COL2,
      at + 2.5,
      [
        { header: "Pendência", width: COL_W - 58 },
        { header: "Lançamentos", width: 22, right: true },
        { header: "Valor", width: 36, right: true },
      ],
      data.gaps.map((g) => ({
        cells: [g.label, String(g.lines.length), formatCurrency(g.value)],
      })),
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // PÁGINA 2: o movimento
  // ════════════════════════════════════════════════════════════════════════
  doc.setPage(doc.getNumberOfPages());
  doc.addPage();
  const movement = doc.getNumberOfPages();

  heading("Para onde foi, por centro de custo", MARGIN, 18);
  const rows = data.areas.flatMap((a) => [
    { slice: a, strong: true },
    ...(a.children ?? []).map((c) => ({ slice: c, strong: false })),
  ]);
  const biggest = Math.max(
    0,
    ...rows
      .filter((x) => !x.strong || !x.slice.children)
      .map((x) => x.slice.value),
  );
  if (rows.length === 0) {
    paragraph("Nenhuma saída no período.", MARGIN, 24, COL_W, {
      size: 8.5,
      color: MUTED,
    });
  } else {
    columnTable(
      MARGIN,
      20.5,
      shareColumns(COL_W, "Área e centro"),
      [
        ...rows.map((r) => ({
          cells: shareCells(r.slice, report.outflow),
          strong: r.strong,
        })),
        {
          cells: [
            "Total",
            "",
            "",
            String(
              rows
                .filter((r) => r.strong)
                .reduce((s, r) => s + r.slice.count, 0),
            ),
            formatCurrency(report.outflow),
          ],
          strong: true,
        },
      ],
      {
        bar: {
          col: 1,
          // Barra só nas folhas: a da área repetiria a soma delas.
          share: (i) =>
            rows[i] && (!rows[i].strong || !rows[i].slice.children)
              ? rows[i].slice.value / (biggest || 1)
              : 0,
        },
        indent: (i) => !!rows[i] && !rows[i].strong,
      },
    );
  }

  doc.setPage(movement);
  heading("Por conta contábil", COL2, 18);
  const accountsY = paragraph(
    data.coverage >= 1
      ? "Todo o movimento tem conta contábil."
      : `${formatPercent(data.coverage)} do movimento tem conta contábil.`,
    COL2,
    23,
    COL_W,
    { size: 8, color: MUTED },
  );
  columnTable(
    COL2,
    accountsY - 1.5,
    [
      { header: "Conta", width: COL_W - 76 },
      { header: "Lanç.", width: 12, right: true },
      { header: "Entradas", width: 32, right: true },
      { header: "Saídas", width: 32, right: true },
    ],
    [
      ...data.accounts.map((a) => ({
        cells: [
          a.label,
          String(a.count),
          a.inflow ? formatCurrency(a.inflow) : "-",
          a.outflow ? formatCurrency(a.outflow) : "-",
        ],
        strong: a.missing,
      })),
      {
        cells: [
          "Total",
          String(report.lines.length),
          formatCurrency(report.inflow),
          formatCurrency(report.outflow),
        ],
        strong: true,
      },
    ],
  );

  // ════════════════════════════════════════════════════════════════════════
  // PÁGINA 3: pessoas físicas
  // ════════════════════════════════════════════════════════════════════════
  if (data.people.length > 0) {
    doc.setPage(doc.getNumberOfPages());
    doc.addPage();
    heading("Pagamentos a pessoas físicas", MARGIN, 18);
    const total = data.people.reduce((s, p) => s.add(p.value), currency(0));
    columnTable(
      MARGIN,
      20.5,
      [
        { header: "Nome", width: 66 },
        { header: "CPF", width: 32 },
        { header: "Do que se trata", width: USABLE_W - 148 },
        { header: "Pagtos.", width: 16, right: true },
        { header: "Total", width: 34, right: true },
      ],
      [
        ...data.people.map((p) => ({
          cells: [
            p.name,
            formatCpfCnpj(p.document),
            p.what,
            String(p.count),
            formatCurrency(p.value),
          ],
        })),
        {
          cells: [
            `${data.people.length} ${data.people.length === 1 ? "pessoa" : "pessoas"}`,
            "",
            "",
            String(data.people.reduce((s, p) => s + p.count, 0)),
            formatCurrency(total.value),
          ],
          strong: true,
        },
      ],
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // ANEXOS
  // ════════════════════════════════════════════════════════════════════════
  const COLUMNS = [
    { header: "Data", width: 14 },
    { header: "Descrição", width: 86 },
    { header: "Favorecido ou pagador", width: 66 },
    { header: "CNPJ/CPF", width: 33 },
    { header: "Situação", width: 38 },
    { header: "Valor (R$)", width: 32 },
  ];
  const last = COLUMNS.length - 1;
  const annex = (first: string, body: UserOptions["body"], at: number) =>
    autoTable(doc, {
      ...table,
      startY: at,
      margin: { top: TOP, left: MARGIN, right: MARGIN, bottom: BOTTOM },
      head: [[first, ...COLUMNS.slice(1).map((c) => c.header)]],
      body,
      columnStyles: Object.fromEntries(
        COLUMNS.map((c, i) => [
          i,
          {
            cellWidth: c.width,
            ...(i === last ? { halign: "right" as const } : {}),
          },
        ]),
      ),
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index === last)
          d.cell.styles.halign = "right";
      },
    });
  const rowOf = (line: FlowLine, dated: string) => {
    const income = line.tx.type === "receivable";
    return [
      dated,
      lineDescription(line),
      look.partyOf(line.tx) || "-",
      look.documentOf(line.tx) || "-",
      lineSituation(line),
      {
        content: `${income ? "+" : "-"}${formatCurrency(line.amount)}`,
        styles: { fontStyle: income ? ("bold" as const) : ("normal" as const) },
      },
    ];
  };
  let letter = 0;
  /** Começa o anexo; se `after` couber, na página do anterior. */
  const annexPage = (
    name: string,
    note?: string,
    after?: { y: number; rows: number },
  ) => {
    doc.setPage(doc.getNumberOfPages());
    let at = after?.y ?? PAGE_H;
    // Título, nota e cabeçalho, mais as primeiras linhas.
    if (at + 14 + Math.min(after?.rows ?? 0, 5) * 10 > PAGE_H - BOTTOM) {
      doc.addPage();
      at = 18;
    }
    text(`Anexo ${"ABC"[letter++]}: ${name}`, MARGIN, at, {
      size: 12,
      bold: true,
      color: PRIMARY,
    });
    return note
      ? paragraph(note, MARGIN, at + 5.5, USABLE_W, {
          size: 8,
          color: MUTED,
        }) - 1
      : at + 3;
  };

  if (data.undocumented.length > 0) {
    const at = annexPage(
      "pagamentos sem nota nem comprovante",
      `${data.undocumented.length} ${data.undocumented.length === 1 ? "pagamento" : "pagamentos"}, ${formatCurrency(data.gaps[0].value)}.`,
    );
    annex(
      "Data",
      look
        .sort(data.undocumented)
        .map((l) => rowOf(l, format(l.date, "dd/MM"))),
      at,
    );
  }

  if (report.pending.lines.length > 0) {
    const at = annexPage(
      "vencidos sem baixa",
      "Não entram no saldo até a baixa.",
      data.undocumented.length > 0
        ? { y: finalY(doc) + 12, rows: report.pending.lines.length }
        : undefined,
    );
    annex(
      "Venc.",
      look
        .sort(report.pending.lines)
        .map((l) => rowOf(l, format(l.tx.dueDate, "dd/MM"))),
      at,
    );
  }

  if (report.lines.length > 0) {
    const days = new Map<string, FlowLine[]>();
    for (const line of look.sort(report.lines)) {
      const key = format(line.date, "yyyy-MM-dd");
      days.set(key, [...(days.get(key) ?? []), line]);
    }
    let running = currency(report.opening);
    const body = [...days.values()].flatMap((lines) => {
      const of = (type: Transaction["type"]) =>
        lines
          .filter((l) => l.tx.type === type)
          .reduce((s, l) => s.add(l.amount), currency(0)).value;
      const dayIn = of("receivable");
      const dayOut = of("payable");
      running = running.add(dayIn).subtract(dayOut);
      const styles = {
        fillColor: WASH,
        fontStyle: "bold" as const,
        cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 },
      };
      return [
        [
          {
            content: format(lines[0].date, "EEEE, dd/MM/yyyy", {
              locale: ptBR,
            }).replace(/^./, (c) => c.toUpperCase()),
            colSpan: 2,
            styles,
          },
          {
            content: [
              dayIn > 0 ? `entradas ${formatCurrency(dayIn)}` : null,
              dayOut > 0 ? `saídas ${formatCurrency(dayOut)}` : null,
              `${known ? "saldo" : "acumulado"} ${formatCurrency(running.value)}`,
            ]
              .filter(Boolean)
              .join("   ·   "),
            colSpan: 4,
            styles: {
              ...styles,
              halign: "right" as const,
              ...(running.value < 0 ? { textColor: DANGER } : {}),
            },
          },
        ],
        ...lines.map((l) => rowOf(l, format(l.date, "dd/MM"))),
      ];
    });
    annex("Data", body, annexPage("extrato dia a dia"));
  }

  // ── Rodapé ──────────────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    rule(PAGE_H - 12);
    text(`${title} · documento confidencial`, MARGIN, PAGE_H - 7, {
      size: 7,
      color: MUTED,
    });
    text(`Página ${p} de ${pages}`, RIGHT, PAGE_H - 7, {
      size: 7,
      color: MUTED,
      align: "right",
    });
  }
  return doc;
}

const shareColumns = (width: number, header: string) => [
  { header, width: width - 80 },
  { header: "", width: 18 },
  { header: "%", width: 14, right: true },
  { header: "Lanç.", width: 14, right: true },
  { header: "Valor", width: 34, right: true },
];

const shareCells = (s: Slice, total: number) => [
  s.label,
  "",
  total ? formatPercent(s.value / total) : "-",
  String(s.count),
  formatCurrency(s.value),
];
