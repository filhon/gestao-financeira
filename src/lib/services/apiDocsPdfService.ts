import { format } from "date-fns";

/**
 * PDF da documentação da API externa, gerado a partir do Markdown servido em
 * /api/internal/api-docs. Entende só o subconjunto usado em
 * docs/API_EXTERNA_DOCUMENTACAO_INTEGRACAO.md: títulos, parágrafos, citações,
 * listas, tabelas e blocos de código. O visual segue os relatórios (reportService).
 */

type RGB = [number, number, number];
type Run = { text: string; bold?: boolean; code?: boolean };
type Atom = Run & { x: number };
type Block =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: { label: string; text: string }[] }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

// ── Paleta (a mesma dos relatórios) ──────────────────────────────────────────
const NAVY: RGB = [15, 23, 42];
const BODY: RGB = [51, 65, 85];
const GREEN_600: RGB = [22, 163, 74];
const SLATE_50: RGB = [248, 250, 252];
const SLATE_100: RGB = [241, 245, 249];
const SLATE_300: RGB = [203, 213, 225];
const GRAY_300: RGB = [209, 213, 219];
const GRAY_400: RGB = [156, 163, 175];
const WHITE: RGB = [255, 255, 255];

// ── Markdown ─────────────────────────────────────────────────────────────────

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]+\)/g;

function tokenize(text: string, bold = false): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), bold });
    if (m[1] !== undefined) runs.push(...tokenize(m[1], true));
    else if (m[2] !== undefined) runs.push({ text: m[2], code: true, bold });
    else runs.push(...tokenize(m[3], bold));
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold });
  return runs;
}

const strip = (s: string) =>
  tokenize(s)
    .map((r) => r.text)
    .join("");

/** Courier (WinAnsi) não tem os caracteres de desenho de caixa usados nos comentários. */
const latin1 = (s: string) => s.replace(/[─━]/g, "-").replace(/[^ -ÿ]/g, "?");

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function parse(md: string) {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let title = "";
  const meta: [string, string][] = [];
  let skipping = false; // "Sumário": o PDF gera o próprio
  let sawH2 = false;

  const startsBlock = (l: string) =>
    /^(#{1,3} |>|\||\s*```|---+$|\s*([-*]|\d+\.)\s)/.test(l);

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim() || /^---+$/.test(line.trim())) {
      i++;
      continue;
    }

    const fence = line.match(/^(\s*)```(\w*)/);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) {
        code.push(
          lines[i].slice(Math.min(fence[1].length, lines[i].search(/\S|$/))),
        );
      }
      i++;
      if (!skipping) blocks.push({ kind: "code", lang: fence[2], lines: code });
      continue;
    }

    const h = line.match(/^(#{1,3}) (.+)/);
    if (h) {
      i++;
      if (h[1] === "#") title = h[2].trim();
      else if (h[1] === "##") {
        sawH2 = true;
        skipping = h[2].trim() === "Sumário";
        if (!skipping) blocks.push({ kind: "h2", text: h[2].trim() });
      } else if (!skipping) blocks.push({ kind: "h3", text: h[2].trim() });
      continue;
    }

    if (line.startsWith(">")) {
      const q: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) {
        q.push(lines[i].replace(/^>\s?/, "").trim());
      }
      if (!sawH2) {
        // Cabeçalho do documento: "**Versão:** 1.2" etc.
        for (const l of q) {
          const m = l.match(/^\*\*(.+?):\*\*\s*(.+)$/);
          if (m) meta.push([m[1], strip(m[2])]);
        }
      } else if (!skipping) blocks.push({ kind: "quote", text: q.join(" ") });
      continue;
    }

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) {
        rows.push(cells(lines[i]));
      }
      const [head, , ...body] = rows; // [1] é a linha "| --- |"
      if (!skipping) blocks.push({ kind: "table", head, rows: body });
      continue;
    }

    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (li) {
      const items: { label: string; text: string }[] = [];
      for (
        let m: RegExpMatchArray | null;
        i < lines.length && (m = lines[i].match(/^\s*([-*]|\d+\.)\s+(.*)/));
        i++
      ) {
        items.push({ label: /\d/.test(m[1]) ? m[1] : "•", text: m[2] });
      }
      if (!skipping) blocks.push({ kind: "list", items });
      continue;
    }

    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) {
      para.push(lines[i].trim());
    }
    if (para.length === 0) i++;
    else if (!skipping) blocks.push({ kind: "p", text: para.join(" ") });
  }

  return { title, meta, blocks };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export const apiDocsPdfService = {
  async generate(md: string): Promise<Blob> {
    const [{ default: jsPDF }, { default: autoTable }, { ensureReportFont }] =
      await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
        import("@/lib/services/reportService"),
      ]);

    const { title, meta, blocks } = parse(md);
    const [mainTitle, subtitle = ""] = title.split(" — ");
    const version = meta.find(([k]) => k === "Versão")?.[1] ?? "";

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const font = await ensureReportFont(doc);

    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 16;
    const USABLE_W = PAGE_W - MARGIN * 2;
    const TOP = 20;
    const BOTTOM = 18;
    let y = 0;

    const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
    const draw = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
    const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
    const face = (code: boolean, bold: boolean, size: number) => {
      doc.setFont(code ? "courier" : font, bold && !code ? "bold" : "normal");
      doc.setFontSize(code ? size * 0.92 : size);
    };
    const mm = (pt: number) => pt * 0.3528;

    const newPage = () => {
      doc.addPage();
      y = TOP;
    };
    const ensure = (h: number) => {
      if (y + h > PAGE_H - BOTTOM) newPage();
    };

    // Quebra o texto em linhas de átomos (palavras) com posição x relativa.
    const layout = (text: string, size: number, maxW: number): Atom[][] => {
      const rows: Atom[][] = [];
      let row: Atom[] = [];
      let x = 0;
      let space = false;
      doc.setFont(font, "normal");
      doc.setFontSize(size);
      const spaceW = doc.getTextWidth(" ");
      for (const run of tokenize(text)) {
        for (const part of run.text.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            space = row.length > 0;
            continue;
          }
          face(!!run.code, !!run.bold, size);
          const w = doc.getTextWidth(run.code ? latin1(part) : part);
          let gap = space ? spaceW : 0;
          if (row.length && x + gap + w > maxW) {
            rows.push(row);
            row = [];
            x = 0;
            gap = 0;
          }
          x += gap;
          row.push({ ...run, text: part, x });
          x += w;
          space = false;
        }
      }
      if (row.length) rows.push(row);
      return rows;
    };

    const drawRows = (
      rows: Atom[][],
      x0: number,
      size: number,
      lineH: number,
    ) => {
      for (const row of rows) {
        ensure(lineH);
        for (const a of row) {
          face(!!a.code, !!a.bold, size);
          ink(a.bold || a.code ? NAVY : BODY);
          doc.text(
            a.code ? latin1(a.text) : a.text,
            x0 + a.x,
            y + mm(size) * 1.05,
          );
        }
        y += lineH;
      }
    };

    // ── Primeira página ──────────────────────────────────────────────────
    fill(NAVY);
    doc.rect(0, 0, PAGE_W, 36, "F");
    fill(GREEN_600);
    doc.rect(0, 34, PAGE_W, 2, "F");

    doc.setFont(font, "normal");
    doc.setFontSize(7.5);
    ink(GRAY_400);
    doc.text("FINCONTROL", MARGIN, 10);
    ink(GRAY_300);
    if (version)
      doc.text(`Versão ${version}`, PAGE_W - MARGIN, 15, { align: "right" });
    doc.text(
      `Gerado em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}`,
      PAGE_W - MARGIN,
      23,
      { align: "right" },
    );

    doc.setFont(font, "bold");
    doc.setFontSize(15);
    ink(WHITE);
    doc.text(mainTitle.toUpperCase(), MARGIN, 22);
    doc.setFont(font, "normal");
    doc.setFontSize(8.5);
    ink(GRAY_300);
    doc.text(subtitle, MARGIN, 29.5);

    // Faixa de metadados: Versão | Base URL | Protocolo
    y = 44;
    const widths = [0.18, 0.56, 0.26].map((f) => f * USABLE_W);
    fill(SLATE_50);
    draw(SLATE_300);
    doc.setLineWidth(0.2);
    doc.roundedRect(MARGIN, y, USABLE_W, 14, 1.5, 1.5, "FD");
    let mx = MARGIN + 3.5;
    meta.slice(0, 3).forEach(([label, value], idx) => {
      doc.setFont(font, "normal");
      doc.setFontSize(6.5);
      ink(GRAY_400);
      doc.text(label.toUpperCase(), mx, y + 5);
      const isUrl = /^https?:/.test(value);
      face(isUrl, false, 8.5);
      ink(NAVY);
      doc.text(isUrl ? latin1(value) : value, mx, y + 10.5);
      mx += widths[idx];
    });
    y += 14 + 8;

    // Conteúdo: reservamos o espaço e preenchemos com os números de página no fim
    const toc = blocks.flatMap((b) => (b.kind === "h2" ? [b.text] : []));
    const tocY = y;
    const tocPages = new Map<string, number>();
    y += 6 + toc.length * 6 + 6;

    // ── Corpo ────────────────────────────────────────────────────────────
    for (const b of blocks) {
      if (b.kind === "h2") {
        ensure(26);
        y += 3;
        tocPages.set(b.text, doc.getNumberOfPages());
        doc.setFont(font, "bold");
        doc.setFontSize(13);
        ink(NAVY);
        doc.text(b.text, MARGIN, y + 5);
        fill(GREEN_600);
        doc.rect(MARGIN, y + 8, 12, 0.8, "F");
        y += 13;
      } else if (b.kind === "h3") {
        ensure(40); // o título nunca fica sozinho no fim da página
        y += 3;
        doc.setFont(font, "bold");
        doc.setFontSize(10.5);
        ink(NAVY);
        doc.text(b.text, MARGIN, y + 4);
        y += 8;
      } else if (b.kind === "p") {
        if (b.text.trimEnd().endsWith(":")) ensure(36); // introduz tabela ou lista
        drawRows(layout(b.text, 9, USABLE_W), MARGIN, 9, mm(9) * 1.6);
        y += 2.5;
      } else if (b.kind === "quote") {
        const size = 8.5;
        const lineH = mm(size) * 1.6;
        const pad = 3.5;
        const rows = layout(b.text, size, USABLE_W - pad * 2);
        const h = rows.length * lineH + pad * 2;
        ensure(h);
        fill(SLATE_50);
        draw(SLATE_300);
        doc.roundedRect(MARGIN, y, USABLE_W, h, 1.5, 1.5, "FD");
        y += pad;
        drawRows(rows, MARGIN + pad, size, lineH);
        y += pad + 3;
      } else if (b.kind === "list") {
        const size = 9;
        const lineH = mm(size) * 1.6;
        for (const it of b.items) {
          const rows = layout(it.text, size, USABLE_W - 7);
          ensure(lineH * Math.min(rows.length, 2));
          doc.setFont(font, "normal");
          doc.setFontSize(size);
          ink(GREEN_600);
          doc.text(it.label, MARGIN + 1, y + mm(size) * 1.05);
          drawRows(rows, MARGIN + 7, size, lineH);
          y += 1.2;
        }
        y += 2;
      } else if (b.kind === "table") {
        ensure(24);
        const cell = (raw: string) => {
          const t = raw.trim();
          return /^`[^`]+`$/.test(t)
            ? { content: latin1(strip(t)), styles: { font: "courier" } }
            : strip(t);
        };
        autoTable(doc, {
          startY: y,
          margin: { left: MARGIN, right: MARGIN, bottom: BOTTOM },
          head: [b.head.map(strip)],
          body: b.rows.map((r) => r.map(cell)),
          theme: "grid",
          styles: {
            font,
            fontSize: 8,
            cellPadding: 2,
            textColor: BODY,
            lineColor: SLATE_300,
            lineWidth: 0.2,
            overflow: "linebreak",
          },
          headStyles: {
            fillColor: NAVY,
            textColor: WHITE,
            fontStyle: "bold",
            fontSize: 7.5,
          },
          alternateRowStyles: { fillColor: SLATE_50 },
        });
        y =
          (doc as unknown as { lastAutoTable: { finalY: number } })
            .lastAutoTable.finalY + 5;
      } else {
        // Bloco de código; "GET /caminho" sozinho vira cartão de endpoint.
        const endpoint =
          b.lines.length === 1 &&
          b.lines[0].match(/^(GET|POST|PUT|PATCH|DELETE) (\/\S*)$/);
        if (endpoint) {
          ensure(14);
          fill(SLATE_50);
          draw(SLATE_300);
          doc.roundedRect(MARGIN, y, USABLE_W, 9, 1.5, 1.5, "FD");
          doc.setFont(font, "bold");
          doc.setFontSize(7.5);
          const mw = doc.getTextWidth(endpoint[1]) + 5;
          fill(GREEN_600);
          doc.roundedRect(MARGIN + 2.5, y + 2, mw, 5, 1, 1, "F");
          ink(WHITE);
          doc.text(endpoint[1], MARGIN + 5, y + 5.6);
          face(true, false, 9.5);
          ink(NAVY);
          doc.text(latin1(endpoint[2]), MARGIN + 2.5 + mw + 3, y + 5.9);
          y += 13;
          continue;
        }

        const size = 7;
        const lineH = 3.5;
        const pad = 3;
        face(true, false, size / 0.92);
        const perLine = Math.max(
          20,
          Math.floor((USABLE_W - pad * 2) / doc.getTextWidth("0")),
        );
        const rows = b.lines.flatMap((l) => {
          let rest = latin1(l.replace(/\t/g, "  "));
          const out = [rest.slice(0, perLine)];
          rest = rest.slice(perLine);
          while (rest) {
            out.push("  " + rest.slice(0, perLine - 2));
            rest = rest.slice(perLine - 2);
          }
          return out;
        });

        let idx = 0;
        let first = true;
        while (idx < rows.length) {
          const fit = Math.floor((PAGE_H - BOTTOM - y - pad * 2) / lineH);
          if (fit < Math.min(3, rows.length - idx)) {
            newPage();
            continue;
          }
          const n = Math.min(fit, rows.length - idx);
          const h = n * lineH + pad * 2;
          fill(SLATE_50);
          draw(SLATE_300);
          doc.roundedRect(MARGIN, y, USABLE_W, h, 1.5, 1.5, "FD");
          face(true, false, size / 0.92);
          ink(NAVY);
          rows
            .slice(idx, idx + n)
            .forEach((r, k) =>
              doc.text(r, MARGIN + pad, y + pad + k * lineH + 2.4),
            );
          if (first && b.lang) {
            doc.setFont(font, "normal");
            doc.setFontSize(6.5);
            ink(GRAY_400);
            doc.text(b.lang, PAGE_W - MARGIN - pad, y + 4, { align: "right" });
          }
          y += h;
          idx += n;
          first = false;
          if (idx < rows.length) newPage();
        }
        y += 4;
      }
    }

    // ── Conteúdo (página 1) e rodapés ────────────────────────────────────
    doc.setPage(1);
    doc.setFont(font, "bold");
    doc.setFontSize(7.5);
    ink(GRAY_400);
    doc.text("CONTEÚDO", MARGIN, tocY + 2);
    toc.forEach((t, k) => {
      const ty = tocY + 10 + k * 6;
      const page = tocPages.get(t) ?? 1;
      doc.setFont(font, "normal");
      doc.setFontSize(9);
      ink(NAVY);
      doc.text(t, MARGIN, ty);
      ink(GRAY_400);
      doc.text(String(page), PAGE_W - MARGIN, ty, { align: "right" });
      draw(SLATE_100);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, ty + 1.8, PAGE_W - MARGIN, ty + 1.8);
      doc.link(MARGIN, ty - 4, USABLE_W, 6, { pageNumber: page });
    });

    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      draw(SLATE_300);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
      doc.setFont(font, "normal");
      doc.setFontSize(7);
      ink(GRAY_400);
      doc.text(
        `FinControl • API Financeira${version ? ` v${version}` : ""}`,
        MARGIN,
        PAGE_H - 7,
      );
      doc.text(`Página ${p} de ${total}`, PAGE_W - MARGIN, PAGE_H - 7, {
        align: "right",
      });
    }

    return doc.output("blob");
  },
};
