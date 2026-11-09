/**
 * Relatório de conselho da Análise, em PDF vetorial (@react-pdf/renderer).
 *
 * Não é impressão da tela: capa, índice com as conclusões, resumo executivo,
 * as mesmas seções da página com o título que já afirma a conclusão, e no
 * anexo a tabela de cada gráfico. Todos os números vêm do AnalyticsReport e
 * das funções de src/lib/analytics.ts que a tela usa; aqui só se desenha.
 *
 * Imports relativos: `npm run pdf:analytics` (scripts) roda este arquivo fora
 * do Next, sem o alias "@/".
 */
import type { ReactElement, ReactNode } from "react";
import currency from "currency.js";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Document,
  Font,
  G,
  Line,
  Page,
  Path,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  type DocumentProps,
} from "@react-pdf/renderer";
import {
  bridgeBars,
  compositionLevel,
  cumulativeByYear,
  investmentsTitle,
  cashCover,
  thinOutflow,
  overdueOf,
  planSteps,
  planTitle,
  riskTitle,
  compositionTitle,
  budgetTitle,
  signedMoney,
  yieldSeries,
  SIDES,
  type AnalysisBrief,
  type AnalyticsReport,
  type AttentionItem,
  type Composition,
  type CompositionMode,
  type Concentration,
  type Side,
} from "../../../lib/analytics";
import { niceTicks } from "../../../lib/dashboardRules";
import { DEFAULT_FORECAST, STAGE_INFO, variation } from "../../../lib/reports";
import {
  formatCurrency,
  formatCurrencyAbbr,
  formatPercent,
} from "../../../lib/utils";
import type { BudgetProgressData } from "../../../lib/services/dashboardService";
import type { AccountPosition } from "../../../hooks/useAnalytics";

// ─── Entrada ──────────────────────────────────────────────────────────────────

export interface AnalyticsPdfInput {
  report: AnalyticsReport;
  brief: AnalysisBrief;
  companyName: string;
  generatedAt: Date;
  transactionCount: number;
  summary: { sentences: string[]; source: "ai" | "rules" };
  /** Destaques: redigidos pela IA (já conferidos) ou o texto de modelo. */
  attention: (AttentionItem & { ai?: boolean })[];
  budget: BudgetProgressData[] | null;
  accounts: {
    positions: AccountPosition[];
    yields: Record<string, number>;
  } | null;
  /** Aplicações de liquidez diária (folga na segunda base). */
  liquidReserve: number | null;
  /** Patrimônio no banco com todas as aplicações. */
  bankBalance: number | null;
}

// ─── Fontes e cores ───────────────────────────────────────────────────────────

/** `base`: "/fonts/pdf" no navegador, a pasta no disco no script. */
export function registerPdfFonts(base: string) {
  Font.register({
    family: "Body",
    fonts: [
      { src: `${base}/TitilliumWeb-Regular.ttf` },
      { src: `${base}/TitilliumWeb-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
  Font.register({
    family: "Plex",
    fonts: [
      { src: `${base}/IBMPlexSans-Regular.ttf` },
      { src: `${base}/IBMPlexSans-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
  Font.register({
    family: "Head",
    src: `${base}/Parkinsans-SemiBold.ttf`,
    fontWeight: 600,
  });
  // Hifenização padrão é a do inglês: "recei-tas" cortado errado.
  Font.registerHyphenationCallback((word) => [word]);
}

/** Tokens da tela (globals.css) convertidos de OKLCH, para papel. */
const C = {
  primary: "#202c85",
  ink: "#12161f",
  muted: "#60636c",
  rule: "#d5d7dd",
  grid: "#e6e8eb",
  wash: "#f3f5f9",
  paper: "#fdfdff",
  in: "#3552bc",
  out: "#d45003",
  context: "#bbbdc4",
  step: "#7d808a",
  danger: "#c8000a",
  amber: "#b46e00",
};
const SIDE_COLOR: Record<Side, string> = { receivable: C.in, payable: C.out };

const PAGE_W = 595.28;
const MARGIN = 48;
const W = PAGE_W - MARGIN * 2;

const money = formatCurrencyAbbr;
const full = formatCurrency;
const pct = (v: number, d = 0) => formatPercent(v, d);
const signedFull = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${full(Math.abs(v))}`;
const count = (n: number) => n.toLocaleString("pt-BR");
const dayText = (key: string) =>
  format(new Date(`${key}T12:00:00`), "dd/MM/yyyy");
const monthText = (key: string) =>
  format(new Date(`${key}-01T12:00:00`), "MMM/yy", { locale: ptBR });
const axisMoney = (v: number) =>
  v === 0
    ? "R$ 0"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);
/** Fonte em texto de SVG (o tipo do react-pdf não declara, mas o motor lê). */
const svgFont = (fontSize: number, fontFamily = "Plex") =>
  ({ fontSize, fontFamily }) as unknown as { fill?: string };

const s = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 60,
    paddingHorizontal: MARGIN,
    fontFamily: "Body",
    fontSize: 9.5,
    color: C.ink,
    backgroundColor: C.paper,
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: MARGIN,
    right: MARGIN,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: C.muted,
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
    paddingTop: 6,
  },
  kicker: {
    fontSize: 7.5,
    fontWeight: 600,
    color: C.primary,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  headline: {
    fontFamily: "Head",
    fontWeight: 600,
    fontSize: 16,
    lineHeight: 1.22,
    marginTop: 5,
    color: C.ink,
  },
  sub: {
    fontFamily: "Head",
    fontWeight: 600,
    fontSize: 11.5,
    lineHeight: 1.25,
    marginTop: 18,
    color: C.ink,
  },
  desc: {
    marginTop: 6,
    fontSize: 9,
    color: C.muted,
    lineHeight: 1.45,
  },
  num: { fontFamily: "Plex" },
});

// ─── Peças de gráfico (SVG vetorial) ──────────────────────────────────────────

interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Colunas agrupadas por categoria; eixo com zero sempre visível. */
function VBars({
  labels,
  series,
  height = 150,
  dim,
  every = 1,
  ticksOn,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  /** Categorias esmaecidas (fora do período). */
  dim?: boolean[];
  every?: number;
  /** Marcas horizontais por categoria (valor revisado). */
  ticksOn?: number[];
}) {
  const padL = 48;
  const padB = 14;
  const padT = 4;
  const all = series.flatMap((x) => x.values).concat(ticksOn ?? []);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 5);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = W - padL;
  const plotH = height - padB - padT;
  const y = (v: number) => padT + plotH * (1 - (v - lo) / (hi - lo || 1));
  const band = plotW / Math.max(1, labels.length);
  const bw = Math.min(12, (band * 0.76) / series.length);
  return (
    <Svg width={W} height={height}>
      {ticks.map((t) => (
        <G key={t}>
          <Line
            x1={padL}
            x2={W}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? C.step : C.grid}
            strokeWidth={t === 0 ? 0.7 : 0.5}
          />
          <Text
            x={padL - 5}
            y={y(t) + 2.3}
            textAnchor="end"
            fill={C.muted}
            style={svgFont(6.5)}
          >
            {axisMoney(t)}
          </Text>
        </G>
      ))}
      {labels.map((label, i) => {
        const cx = padL + band * i + band / 2;
        const groupW = bw * series.length;
        return (
          <G key={label + i}>
            {series.map((x, j) => {
              const v = x.values[i] ?? 0;
              const top = Math.min(y(0), y(v));
              return (
                <Rect
                  key={x.name}
                  x={cx - groupW / 2 + j * bw}
                  y={top}
                  width={Math.max(0.5, bw - 0.8)}
                  height={Math.abs(y(v) - y(0))}
                  fill={x.color}
                  fillOpacity={dim?.[i] ? 0.32 : 1}
                />
              );
            })}
            {ticksOn && ticksOn[i] ? (
              <Line
                x1={cx - groupW / 2 - 2}
                x2={cx + groupW / 2 + 2}
                y1={y(ticksOn[i])}
                y2={y(ticksOn[i])}
                stroke={C.ink}
                strokeWidth={1.2}
              />
            ) : null}
            {i % every === 0 ? (
              <Text
                x={cx}
                y={height - 3}
                textAnchor="middle"
                fill={C.muted}
                style={svgFont(6.5)}
              >
                {label}
              </Text>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

/** Linhas sobre um eixo x de 0 a 1; `step` desenha em degrau (saldo diário). */
function Lines({
  series,
  xLabels,
  height = 150,
  bands = [],
  marker,
}: {
  series: {
    color: string;
    points: { x: number; v: number | null }[];
    step?: boolean;
  }[];
  xLabels: { x: number; text: string }[];
  height?: number;
  /** Trechos sombreados (saldo negativo), em x de 0 a 1. */
  bands?: { x1: number; x2: number }[];
  marker?: { x: number; v: number; text: string };
}) {
  const padL = 48;
  const padB = 14;
  const padT = 8;
  const all = series.flatMap((x) =>
    x.points.flatMap((p) => (p.v === null ? [] : [p.v])),
  );
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 5);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = W - padL - 6;
  const plotH = height - padB - padT;
  const X = (x: number) => padL + plotW * x;
  const Y = (v: number) => padT + plotH * (1 - (v - lo) / (hi - lo || 1));
  const path = (pts: { x: number; v: number | null }[], step?: boolean) => {
    let d = "";
    let prev: { x: number; v: number } | null = null;
    for (const p of pts) {
      if (p.v === null) {
        prev = null;
        continue;
      }
      if (!prev) d += `M${X(p.x).toFixed(2)},${Y(p.v).toFixed(2)}`;
      else if (step) d += `H${X(p.x).toFixed(2)}V${Y(p.v).toFixed(2)}`;
      else d += `L${X(p.x).toFixed(2)},${Y(p.v).toFixed(2)}`;
      prev = { x: p.x, v: p.v };
    }
    return d;
  };
  return (
    <Svg width={W} height={height}>
      {bands.map((b, i) => (
        <Rect
          key={i}
          x={X(b.x1)}
          y={padT}
          width={Math.max(1, X(b.x2) - X(b.x1))}
          height={plotH}
          fill={C.danger}
          fillOpacity={0.08}
        />
      ))}
      {ticks.map((t) => (
        <G key={t}>
          <Line
            x1={padL}
            x2={W}
            y1={Y(t)}
            y2={Y(t)}
            stroke={t === 0 ? C.step : C.grid}
            strokeWidth={t === 0 ? 0.7 : 0.5}
          />
          <Text
            x={padL - 5}
            y={Y(t) + 2.3}
            textAnchor="end"
            fill={C.muted}
            style={svgFont(6.5)}
          >
            {axisMoney(t)}
          </Text>
        </G>
      ))}
      {series.map((x, i) => (
        <Path
          key={i}
          d={path(x.points, x.step)}
          stroke={x.color}
          strokeWidth={1.4}
          fill="none"
          strokeLinejoin="round"
        />
      ))}
      {marker ? (
        <G>
          <Rect
            x={X(marker.x) - 2}
            y={Y(marker.v) - 2}
            width={4}
            height={4}
            fill={marker.v < 0 ? C.danger : C.ink}
          />
          <Text
            x={Math.min(X(marker.x), W - 70)}
            y={Y(marker.v) + (marker.v < 0 ? 11 : -6)}
            fill={marker.v < 0 ? C.danger : C.ink}
            style={svgFont(6.8)}
          >
            {marker.text}
          </Text>
        </G>
      ) : null}
      {xLabels.map((l) => (
        <Text
          key={l.text + l.x}
          x={X(l.x)}
          y={height - 3}
          textAnchor="middle"
          fill={C.muted}
          style={svgFont(6.5)}
        >
          {l.text}
        </Text>
      ))}
    </Svg>
  );
}

/** Ponte: os totais em cor do lado, os degraus em cinza com o valor em cima. */
function Waterfall({
  bars,
  color,
  height = 160,
}: {
  bars: ReturnType<typeof bridgeBars>;
  color: string;
  height?: number;
}) {
  const padL = 48;
  const padB = 22;
  const padT = 12;
  const ticks = niceTicks(
    0,
    Math.max(...bars.map((b) => b.base + b.bar), 0),
    5,
  );
  const hi = ticks[ticks.length - 1] || 1;
  const plotW = W - padL;
  const plotH = height - padB - padT;
  const Y = (v: number) => padT + plotH * (1 - v / hi);
  const band = plotW / bars.length;
  const bw = Math.min(46, band * 0.62);
  return (
    <Svg width={W} height={height}>
      {ticks.map((t) => (
        <G key={t}>
          <Line
            x1={padL}
            x2={W}
            y1={Y(t)}
            y2={Y(t)}
            stroke={t === 0 ? C.step : C.grid}
            strokeWidth={t === 0 ? 0.7 : 0.5}
          />
          <Text
            x={padL - 5}
            y={Y(t) + 2.3}
            textAnchor="end"
            fill={C.muted}
            style={svgFont(6.5)}
          >
            {axisMoney(t)}
          </Text>
        </G>
      ))}
      {bars.map((b, i) => {
        const cx = padL + band * i + band / 2;
        const words = b.label.split(" ");
        const half = Math.ceil(words.length / 2);
        const lines =
          b.label.length > 12
            ? [words.slice(0, half).join(" "), words.slice(half).join(" ")]
            : [b.label];
        return (
          <G key={b.key}>
            <Rect
              x={cx - bw / 2}
              y={Y(b.base + b.bar)}
              width={bw}
              height={Math.max(0.6, Y(b.base) - Y(b.base + b.bar))}
              fill={b.total ? color : b.value < 0 ? C.context : C.step}
            />
            <Text
              x={cx}
              y={Y(b.base + b.bar) - 3}
              textAnchor="middle"
              fill={C.ink}
              style={svgFont(6.8)}
            >
              {b.text}
            </Text>
            {lines.map((l, j) => (
              <Text
                key={j}
                x={cx}
                y={height - padB + 9 + j * 7.5}
                textAnchor="middle"
                fill={C.muted}
                style={svgFont(6.5, "Body")}
              >
                {l}
              </Text>
            ))}
          </G>
        );
      })}
    </Svg>
  );
}

interface RankedRow {
  label: string;
  sub?: string;
  value: number;
  valueText?: string;
  aside?: string;
  color: string;
}

/** Barras horizontais do maior ao menor, nome inteiro em cima da barra. */
function Ranked({ rows, max }: { rows: RankedRow[]; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const asides = rows.some((r) => r.aside);
  return (
    <View>
      {rows.map((r, i) => (
        <View
          key={r.label + i}
          wrap={false}
          style={{
            paddingVertical: 4,
            borderTopWidth: i ? 0.5 : 0,
            borderTopColor: C.grid,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <Text style={{ flex: 1, fontSize: 8.5 }}>
              {r.label}
              {r.sub ? (
                <Text style={{ color: C.muted, fontSize: 7.5 }}>
                  {"  "}
                  {r.sub}
                </Text>
              ) : null}
            </Text>
            <Text style={[s.num, { fontSize: 8.5, fontWeight: 600 }]}>
              {r.valueText ?? money(r.value)}
            </Text>
            {asides ? (
              <Text
                style={[
                  s.num,
                  {
                    width: 56,
                    textAlign: "right",
                    fontSize: 7.5,
                    color: C.muted,
                  },
                ]}
              >
                {r.aside ?? ""}
              </Text>
            ) : null}
          </View>
          <View
            style={{
              marginTop: 2.5,
              height: 4,
              width: `${Math.max(0.4, (Math.abs(r.value) / top) * 100)}%`,
              backgroundColor: r.color,
              borderTopRightRadius: 2,
              borderBottomRightRadius: 2,
            }}
          />
        </View>
      ))}
    </View>
  );
}

/** Faixa de números lado a lado, com régua em cima (não é cartão). */
function Kpis({
  items,
}: {
  items: { label: string; value: string; detail?: string; danger?: boolean }[];
}) {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        marginTop: 14,
        borderTopWidth: 1,
        borderTopColor: C.primary,
      }}
    >
      {items.map((k, i) => (
        <View
          key={k.label}
          style={{
            flex: 1,
            paddingTop: 7,
            paddingRight: 10,
            paddingLeft: i ? 10 : 0,
            borderLeftWidth: i ? 0.5 : 0,
            borderLeftColor: C.rule,
          }}
        >
          <Text style={{ fontSize: 7.5, color: C.muted }}>{k.label}</Text>
          <Text
            style={[
              s.num,
              {
                fontSize: 13,
                fontWeight: 600,
                marginTop: 2,
                color: k.danger ? C.danger : C.ink,
              },
            ]}
          >
            {k.value}
          </Text>
          {k.detail ? (
            <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 2 }}>
              {k.detail}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Legend({
  items,
}: {
  items: { label: string; color: string; line?: boolean }[];
}) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 6 }}>
      {items.map((it) => (
        <View
          key={it.label}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginRight: 12,
          }}
        >
          <View
            style={{
              width: it.line ? 10 : 6,
              height: it.line ? 1.5 : 6,
              backgroundColor: it.color,
              marginRight: 4,
            }}
          />
          <Text style={{ fontSize: 7.5, color: C.muted }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Modelo: seções, gráficos numerados, tabelas do anexo ────────────────────

interface Table {
  columns: string[];
  rows: string[][];
}

type Block =
  | { type: "kpis"; items: Parameters<typeof Kpis>[0]["items"] }
  | { type: "text"; text: string; muted?: boolean }
  | { type: "sub"; text: string }
  | {
      type: "figure";
      n: number;
      title: string;
      legend?: Parameters<typeof Legend>[0]["items"];
      chart: ReactNode;
      note?: string;
      table: Table;
    }
  | { type: "table"; title: string; table: Table };

interface SectionModel {
  id: string;
  kicker: string;
  title: string;
  description?: string;
  blocks: Block[];
}

function buildSections(input: AnalyticsPdfInput): SectionModel[] {
  const { report, brief } = input;
  let fig = 0;
  const figure = (
    f: Omit<Extract<Block, { type: "figure" }>, "type" | "n">,
  ): Block => ({ type: "figure", n: ++fig, ...f });
  const out: SectionModel[] = [];
  const inRange = (key: string) =>
    key >= report.range.from && key <= report.range.to;
  const every = (n: number) => Math.max(1, Math.ceil(n / 12));

  // ── Posição ──
  {
    const cash = brief.cash;
    const cover = cashCover(report, cash);
    const liquid = input.liquidReserve ?? 0;
    const net = report.totals.net;
    const plan = report.plan.receivable.bridge;
    const delta = report.compareTotals
      ? variation(net, report.compareTotals.net)
      : null;
    const blocks: Block[] = [
      {
        type: "kpis",
        items: [
          {
            label: "Caixa disponível",
            value: cash === null ? "—" : full(cash),
            danger: cash !== null && cash < 0,
            detail:
              cash === null
                ? "Sem contas correntes cadastradas"
                : "Contas correntes e aplicação automática",
          },
          {
            label: "Resultado do período",
            value: signedMoney(net),
            danger: net < 0,
            detail:
              report.compareTotals && brief.compareLabel
                ? `${signedMoney(net - report.compareTotals.net)} sobre ${brief.compareLabel}${delta !== null ? ` (${delta > 0 ? "+" : ""}${pct(delta)})` : ""}`
                : `Receitas ${money(report.totals.inflow)}, despesas ${money(report.totals.outflow)}`,
          },
          {
            label: "Até a próxima entrada",
            value: !cover?.next
              ? "—"
              : cover.covered
                ? "Coberto"
                : `Faltam ${money(cover.due - (cash ?? 0))}`,
            danger: !!cover && !cover.covered,
            detail: cover?.next
              ? `${money(cover.due)} a pagar até ${dayText(cover.next.date)}${!cover.covered && liquid > 0 && (cash ?? 0) + liquid >= cover.due ? "; cobre resgatando as aplicações de liquidez diária" : ""}`
              : "Nenhuma entrada prevista",
          },
          {
            label: "Receita realizada da prevista",
            value: plan.planned ? pct(plan.realized / plan.planned) : "—",
            detail: plan.planned
              ? `${money(plan.realized)} de ${money(plan.planned)} previstos`
              : "Nenhuma receita prevista",
          },
        ],
      },
    ];
    const positions = input.accounts?.positions ?? [];
    if (positions.length) {
      const informed = positions.reduce(
        (t, p) => t.add(p.balance),
        currency(0),
      );
      const after =
        input.bankBalance !== null
          ? currency(input.bankBalance).subtract(informed).value
          : 0;
      const rows: RankedRow[] = [
        ...positions.map((p) => ({
          label: p.name,
          sub: `${p.investment ? "aplicação, " : ""}saldo de ${format(p.date, "dd/MM/yyyy")}`,
          value: p.balance,
          color: p.investment ? C.context : C.in,
        })),
        ...(Math.abs(after) >= 0.01
          ? [
              {
                label: "Baixas lançadas depois do último extrato",
                value: after,
                color: C.context,
              },
            ]
          : []),
      ];
      blocks.push(
        figure({
          title: "Saldo por conta",
          chart: <Ranked rows={rows} />,
          note:
            input.bankBalance !== null
              ? `Total no banco, com todas as aplicações: ${full(input.bankBalance)}.`
              : undefined,
          table: {
            columns: ["Conta", "Saldo", "Data do saldo"],
            rows: [
              ...positions.map((p) => [
                p.name,
                full(p.balance),
                format(p.date, "dd/MM/yyyy"),
              ]),
              ...(Math.abs(after) >= 0.01
                ? [["Baixas depois do último extrato", full(after), ""]]
                : []),
            ],
          },
        }),
      );
    }
    out.push({
      id: "posicao",
      kicker: "Posição agora",
      title: brief.headlines.posicao ?? "Posição de caixa",
      description: cover?.next
        ? `Próxima entrada prevista: ${money(cover.next.amount)} em ${dayText(cover.next.date)}. Até lá vencem ${money(cover.due)} a pagar já lançados.`
        : undefined,
      blocks,
    });
  }

  // ── Projeção ──
  {
    const p = brief.projection;
    const oin = overdueOf(report, "receivable").value;
    const oout = overdueOf(report, "payable").value;
    const blocks: Block[] = [];
    if (p) {
      const t0 = new Date(`${p.from}T12:00:00`).getTime();
      const t1 = new Date(`${p.until}T12:00:00`).getTime();
      const xOf = (key: string) =>
        (new Date(`${key}T12:00:00`).getTime() - t0) / (t1 - t0 || 1);
      const monthly = new Map<
        string,
        { inflow: number; outflow: number; balance: number }
      >();
      for (const pt of p.points) {
        const k = pt.isoDate.slice(0, 7);
        const m = monthly.get(k) ?? { inflow: 0, outflow: 0, balance: 0 };
        m.inflow = currency(m.inflow).add(pt.inflow).value;
        m.outflow = currency(m.outflow).add(pt.outflow).value;
        m.balance = pt.balance;
        monthly.set(k, m);
      }
      const months = [...monthly.keys()];
      blocks.push(
        {
          type: "kpis",
          items: [
            {
              label: "Menor saldo",
              value: full(p.lowest.balance),
              danger: p.lowest.balance < 0,
              detail: `Em ${dayText(p.lowest.isoDate)}, ao fim do dia`,
            },
            {
              label: `Em ${dayText(p.until)}`,
              value: full(p.closing),
              danger: p.closing < 0,
              detail:
                thinOutflow(p) !== null
                  ? `Só ${pct(thinOutflow(p)!)} da despesa média está lançada até lá`
                  : `${p.closing >= p.opening ? "+" : "−"}${money(Math.abs(p.closing - p.opening))} sobre hoje`,
            },
          ],
        },
        figure({
          title: "Saldo projetado ao fim de cada dia, 12 meses",
          legend: [
            { label: "Saldo previsto", color: C.primary, line: true },
            ...(p.runs.length ? [{ label: "Negativo", color: "#f3d3d4" }] : []),
          ],
          chart: (
            <Lines
              height={170}
              series={[
                {
                  color: C.primary,
                  step: true,
                  points: p.points.map((pt) => ({
                    x: xOf(pt.isoDate),
                    v: pt.balance,
                  })),
                },
              ]}
              bands={p.runs.map((r) => {
                const i = p.points.indexOf(r.end);
                return {
                  x1: xOf(r.start.isoDate),
                  x2: xOf(p.points[i + 1]?.isoDate ?? p.until),
                };
              })}
              marker={{
                x: xOf(p.lowest.isoDate),
                v: p.lowest.balance,
                text: `Menor saldo ${money(p.lowest.balance)}`,
              }}
              xLabels={months
                .filter((_, i) => i % 2 === 0)
                .map((k) => ({
                  x: Math.max(0, xOf(`${k}-01`)),
                  text: monthText(k),
                }))}
            />
          ),
          note: "Estágios: autorizado ou em lote, aprovado, em aprovação e recorrências ainda não lançadas. Rascunhos ficam de fora.",
          table: {
            columns: ["Mês", "Entradas", "Saídas", "Saldo ao fim do mês"],
            rows: months.map((k) => {
              const m = monthly.get(k)!;
              return [
                monthText(k),
                full(m.inflow),
                full(m.outflow),
                full(m.balance),
              ];
            }),
          },
        }),
        {
          type: "table",
          title: "Previsto no horizonte, por estágio",
          table: {
            columns: ["Estágio", "Na projeção", "Entradas", "Saídas"],
            rows: p.byStage.map((b) => [
              STAGE_INFO[b.stage].label,
              DEFAULT_FORECAST.includes(b.stage) ? "sim" : "não",
              full(b.inflow),
              full(b.outflow),
            ]),
          },
        },
      );
    } else {
      blocks.push({
        type: "text",
        text: "A projeção parte do caixa disponível de hoje, e não há contas correntes cadastradas.",
        muted: true,
      });
    }
    out.push({
      id: "projecao",
      kicker: "Projeção",
      title: brief.headlines.projecao ?? "Projeção do caixa",
      description: `A partir do caixa disponível de hoje${p ? ` (${money(p.opening)})` : ""}, com o que já está lançado e as recorrências ainda não lançadas. O que não está lançado não entra.${oin || oout ? ` Vencidos que ainda não entraram nem saíram ficam fora: ${money(oin)} a receber e ${money(oout)} a pagar.` : ""}`,
      blocks,
    });
  }

  // ── Resultado ──
  {
    const { year, points } = cumulativeByYear(report);
    const trend = report.trend;
    // Ano anterior sem movimento: a linha no zero sugeriria um resultado.
    const withPrevious = points.some((pt) => pt.previous);
    out.push({
      id: "resultado",
      kicker: "Resultado e tendência",
      title: brief.headlines.resultado,
      description:
        report.regime === "cash"
          ? "Regime de caixa: só o que foi pago ou recebido, no mês da baixa."
          : "Regime de competência: o mês a que o lançamento pertence, pago ou não. Rejeitados ficam fora.",
      blocks: [
        figure({
          title: "Entradas e saídas, 24 meses",
          legend: [
            { label: "Receitas", color: C.in },
            { label: "Despesas", color: C.out },
          ],
          chart: (
            <VBars
              labels={trend.map((m) => m.label)}
              series={[
                {
                  name: "Receitas",
                  color: C.in,
                  values: trend.map((m) => m.inflow),
                },
                {
                  name: "Despesas",
                  color: C.out,
                  values: trend.map((m) => m.outflow),
                },
              ]}
              dim={trend.map((m) => !inRange(m.key))}
              every={3}
            />
          ),
          note: "Meses fora do período escolhido aparecem esmaecidos.",
          table: {
            columns: ["Mês", "Receitas", "Despesas", "Resultado"],
            rows: trend.map((m) => [
              m.label,
              full(m.inflow),
              full(m.outflow),
              full(m.net),
            ]),
          },
        }),
        figure({
          title: withPrevious
            ? `Resultado acumulado em ${year} e ${year - 1}`
            : `Resultado acumulado em ${year}`,
          legend: [
            { label: String(year), color: C.in, line: true },
            ...(withPrevious
              ? [{ label: String(year - 1), color: C.context, line: true }]
              : []),
          ],
          chart: (
            <Lines
              height={140}
              series={[
                ...(withPrevious
                  ? [
                      {
                        color: C.context,
                        points: points.map((pt, i) => ({
                          x: i / 11,
                          v: pt.previous,
                        })),
                      },
                    ]
                  : []),
                {
                  color: C.in,
                  points: points.map((pt, i) => ({ x: i / 11, v: pt.current })),
                },
              ]}
              xLabels={points.map((pt, i) => ({ x: i / 11, text: pt.label }))}
            />
          ),
          table: {
            columns: withPrevious
              ? ["Mês", String(year), String(year - 1)]
              : ["Mês", String(year)],
            rows: points.map((pt) => [
              pt.label,
              pt.current === null ? "—" : full(pt.current),
              ...(withPrevious
                ? [pt.previous === null ? "—" : full(pt.previous)]
                : []),
            ]),
          },
        }),
      ],
    });
  }

  // ── Previsto ──
  {
    const blocks: Block[] = [];
    for (const side of SIDES) {
      const plan = report.plan[side];
      const color = SIDE_COLOR[side];
      const word = side === "receivable" ? "Receitas" : "Despesas";
      const done = side === "receivable" ? "Recebido" : "Pago";
      if (side === "payable")
        blocks.push({ type: "sub", text: planTitle(plan.bridge, side) });
      const bars = bridgeBars(planSteps(plan.bridge, side));
      blocks.push(
        figure({
          title: `${word}: do previsto ao ${done.toLowerCase()}`,
          chart: <Waterfall bars={bars} color={color} />,
          table: {
            columns: ["Etapa", "Valor", "O que é"],
            rows: bars.map((b) => [
              b.label,
              b.total ? full(b.value) : signedFull(b.value),
              b.hint,
            ]),
          },
        }),
        figure({
          title: `${word} mês a mês: previsto, revisado e ${done.toLowerCase()}`,
          legend: [
            { label: "Previsto", color: C.context },
            { label: done, color },
            { label: "Revisado", color: C.ink, line: true },
          ],
          chart: (
            <VBars
              height={130}
              labels={plan.months.map((m) => m.label)}
              series={[
                {
                  name: "Previsto",
                  color: C.context,
                  values: plan.months.map((m) => m.planned),
                },
                {
                  name: done,
                  color,
                  values: plan.months.map((m) => m.realized),
                },
              ]}
              ticksOn={plan.months.map((m) => m.revised)}
              every={every(plan.months.length)}
            />
          ),
          table: {
            columns: ["Mês", "Previsto", "Revisado", done],
            rows: plan.months.map((m) => [
              m.label,
              full(m.planned),
              full(m.revised),
              full(m.realized),
            ]),
          },
        }),
      );
      if (plan.deviations.length)
        blocks.push({
          type: "table",
          title: `Maiores desvios em ${word.toLowerCase()}`,
          table: {
            columns: [
              "Lançamento",
              "Mês",
              "Previsto",
              `${done} + aberto`,
              "Desvio",
            ],
            rows: plan.deviations
              .slice(0, 6)
              .map((d) => [
                `${d.description}${d.counterpart ? ` · ${d.counterpart}` : ""}`,
                monthText(d.month),
                money(d.planned),
                money(currency(d.realized).add(d.open).value),
                signedMoney(d.deviation),
              ]),
          },
        });
    }
    out.push({
      id: "previsto",
      kicker: "Previsto e realizado",
      title: brief.headlines.previstoReceitas,
      description:
        "Por mês de vencimento. A previsão é o valor com que o lançamento nasceu; quando ele é editado depois, a diferença vira revisão.",
      blocks,
    });
  }

  // ── Orçamento ──
  {
    const leaves = (input.budget ?? [])
      .filter((b) => b.isLeaf && b.budget > 0)
      .sort((a, b) => b.percentage - a.percentage);
    const tone = (st: BudgetProgressData["status"]) =>
      st === "danger" ? C.danger : st === "warning" ? C.amber : C.in;
    const statusText = (b: BudgetProgressData) =>
      b.exhausted
        ? "concluído"
        : b.status === "danger"
          ? "estourou"
          : b.status === "warning"
            ? b.tight
              ? "sem folga"
              : "acima do ritmo"
            : "no ritmo";
    out.push({
      id: "orcamento",
      kicker: "Orçamento por centro de custo",
      title:
        brief.headlines.orcamento ??
        budgetTitle(input.budget ?? undefined, brief.exercise),
      description:
        "Envelope anual de cada centro contra o comprometido e o pago. Mesmo cálculo de Centros de Custo.",
      blocks: leaves.length
        ? [
            figure({
              title: `Uso do envelope de ${brief.exercise}, por centro`,
              chart: (
                <Ranked
                  max={Math.max(1, ...leaves.map((b) => b.percentage / 100))}
                  rows={leaves.slice(0, 18).map((b) => ({
                    label: b.name,
                    sub: statusText(b),
                    value: b.percentage / 100,
                    valueText: pct(b.percentage / 100),
                    aside: money(b.budget),
                    color: tone(b.status),
                  }))}
                />
              ),
              note:
                leaves.length > 18
                  ? `Os 18 centros mais usados de ${leaves.length}; todos estão na tabela do anexo. À direita, o envelope.`
                  : "À direita, o envelope do ano.",
              table: {
                columns: [
                  "Centro",
                  "Envelope",
                  "Comprometido",
                  "Pago",
                  "Disponível",
                  "Uso",
                ],
                rows: leaves.map((b) => [
                  b.name,
                  full(b.budget),
                  full(b.spent),
                  full(b.paid),
                  full(b.available),
                  pct(b.percentage / 100),
                ]),
              },
            }),
          ]
        : [
            {
              type: "text",
              text: `Nenhum centro de custo com envelope em ${brief.exercise}.`,
              muted: true,
            },
          ],
    });
  }

  // ── Composição ──
  {
    const blocks: Block[] = [];
    const comp = (
      c: Composition,
      side: Side,
      mode: CompositionMode,
      what: string,
    ) => {
      const lv = compositionLevel(c, side);
      if (!lv.total) return;
      const name = (k: (typeof lv.kids)[number]) =>
        mode === "accounts" ? `${k.code} ${k.name}` : k.name;
      const rows: RankedRow[] = [
        ...lv.kids.slice(0, 12).map((k, i) => ({
          label: name(k),
          value: k.value[side],
          aside: pct(k.value[side] / lv.total, 1),
          color: i < 5 ? SIDE_COLOR[side] : C.context,
        })),
        ...(lv.unassigned > 0
          ? [
              {
                label:
                  mode === "accounts"
                    ? "Sem conta contábil"
                    : "Sem centro de custo",
                value: lv.unassigned,
                aside: pct(lv.unassigned / lv.total, 1),
                color: C.context,
              },
            ]
          : []),
      ];
      if (blocks.length)
        blocks.push({ type: "sub", text: compositionTitle(lv, side, mode) });
      blocks.push(
        figure({
          title: what,
          chart: <Ranked rows={rows} />,
          note:
            lv.kids.length > 12
              ? `As 12 maiores de ${lv.kids.length}; todas estão na tabela do anexo.`
              : undefined,
          table: {
            columns: [
              mode === "accounts" ? "Conta" : "Centro",
              "Valor",
              "Parte",
            ],
            rows: [
              ...lv.kids.map((k) => [
                name(k),
                full(k.value[side]),
                pct(k.value[side] / lv.total, 1),
              ]),
              ...(lv.unassigned > 0
                ? [
                    [
                      mode === "accounts"
                        ? "Sem conta contábil"
                        : "Sem centro de custo",
                      full(lv.unassigned),
                      pct(lv.unassigned / lv.total, 1),
                    ],
                  ]
                : []),
            ],
          },
        }),
      );
    };
    comp(report.accounts, "payable", "accounts", "Despesas por conta contábil");
    comp(
      report.accounts,
      "receivable",
      "accounts",
      "Receitas por conta contábil",
    );
    comp(
      report.costCenters,
      "payable",
      "costCenters",
      "Despesas por centro de custo",
    );
    const cov = report.accounts.coverage;
    out.push({
      id: "composicao",
      kicker: "Composição",
      title: brief.headlines.composicao,
      description:
        cov < 0.95
          ? `Só ${pct(cov)} do movimento do período tem conta do plano de contas; o restante aparece como "Sem conta contábil". ${pct(report.costCenters.coverage)} tem centro de custo.`
          : "Do maior para o menor, no primeiro nível que divide o valor.",
      blocks,
    });
  }

  // ── Riscos ──
  {
    const conc = (c: Concentration, side: Side): RankedRow[] => [
      ...c.top.map((x, i) => ({
        label: x.name,
        sub: x.key === report.anchorEntityId ? "mantenedora" : undefined,
        value: x.value,
        aside: c.total ? pct(x.value / c.total, 1) : "—",
        color: i < 5 ? SIDE_COLOR[side] : C.context,
      })),
      ...(c.rest > 0
        ? [
            {
              label: `Demais ${c.restCount}`,
              value: c.rest,
              aside: pct(c.rest / c.total, 1),
              color: C.context,
            },
          ]
        : []),
    ];
    const concTable = (c: Concentration): Table => ({
      columns: ["Contraparte", "Valor", "Parte"],
      rows: [
        ...c.top.map((x) => [
          x.name,
          full(x.value),
          c.total ? pct(x.value / c.total, 1) : "—",
        ]),
        ...(c.rest > 0
          ? [[`Demais ${c.restCount}`, full(c.rest), pct(c.rest / c.total, 1)]]
          : []),
      ],
    });
    const blocks: Block[] = [];
    for (const side of SIDES) {
      const c = report.concentration[side];
      if (!c.total) continue;
      blocks.push(
        figure({
          title:
            side === "receivable"
              ? "De onde vem a receita"
              : "Para onde vai a despesa",
          chart: <Ranked rows={conc(c, side)} />,
          table: concTable(c),
        }),
      );
    }
    for (const side of SIDES) {
      const aging = report.aging[side];
      const tm = report.timing[side];
      const verb = side === "receivable" ? "recebe" : "paga";
      const days =
        tm.avgDays === null ? null : Math.round(Math.abs(tm.avgDays));
      blocks.push(
        figure({
          title:
            side === "receivable"
              ? "Em aberto a receber, pelo atraso"
              : "Em aberto a pagar, pelo atraso",
          chart: (
            <Ranked
              rows={aging.map((b) => ({
                label: b.label,
                value: b.value,
                aside: `${count(b.count)} lanç.`,
                color:
                  b.key === "due"
                    ? C.context
                    : b.key === "d90p"
                      ? C.danger
                      : SIDE_COLOR[side],
              }))}
            />
          ),
          note:
            tm.avgDays === null
              ? "Nenhuma baixa no período."
              : `Pontualidade: em média ${verb} ${days === 0 ? "no vencimento" : `${days} ${days === 1 ? "dia" : "dias"} ${tm.avgDays > 0 ? "depois do" : "antes do"} vencimento`}; ${pct(tm.lateShare ?? 0)} das ${count(tm.count)} baixas com atraso.`,
          table: {
            columns: ["Faixa", "Valor", "Lançamentos"],
            rows: aging.map((b) => [b.label, full(b.value), count(b.count)]),
          },
        }),
      );
    }
    const od = overdueOf(report, "receivable");
    out.push({
      id: "riscos",
      kicker: "Riscos",
      title:
        brief.headlines.riscos ?? riskTitle(report.concentration.receivable),
      description:
        od.value > 0
          ? `${money(od.value)} a receber estão vencidos (${od.count} ${od.count === 1 ? "lançamento" : "lançamentos"}).`
          : "Nenhuma conta a receber vencida.",
      blocks,
    });
  }

  // ── Aplicações ──
  {
    const positions = (input.accounts?.positions ?? []).filter(
      (p) => p.investment,
    );
    const invested = positions.reduce(
      (t, p) => t.add(p.balance),
      currency(0),
    ).value;
    const series = yieldSeries(input.accounts?.yields ?? {}, input.generatedAt);
    const total = series.reduce((t, m) => t.add(m.value), currency(0)).value;
    const last = [...series].reverse().find((m) => m.value > 0) ?? null;
    out.push({
      id: "aplicacoes",
      kicker: "Aplicações",
      title:
        input.accounts === null
          ? "Aplicações"
          : investmentsTitle({ count: positions.length, invested, last }),
      description: positions.length
        ? "Saldo bruto do último extrato de cada aplicação. O rendimento entra quando a conciliação do mês é fechada."
        : undefined,
      blocks: positions.length
        ? [
            figure({
              title: "Rendimento reconhecido por mês",
              chart: (
                <VBars
                  height={120}
                  labels={series.map((m) => m.label)}
                  series={[
                    {
                      name: "Rendimento",
                      color: C.in,
                      values: series.map((m) => m.value),
                    },
                  ]}
                />
              ),
              note: `Nos 12 meses: ${full(total)}.`,
              table: {
                columns: ["Mês", "Rendimento"],
                rows: series.map((m) => [m.label, full(m.value)]),
              },
            }),
            figure({
              title: "Saldo por aplicação",
              chart: (
                <Ranked
                  rows={positions.map((p) => ({
                    label: p.name,
                    sub: `saldo de ${format(p.date, "dd/MM/yyyy")}`,
                    value: p.balance,
                    color: C.in,
                  }))}
                />
              ),
              table: {
                columns: ["Aplicação", "Saldo", "Data do saldo"],
                rows: positions.map((p) => [
                  p.name,
                  full(p.balance),
                  format(p.date, "dd/MM/yyyy"),
                ]),
              },
            }),
          ]
        : [
            {
              type: "text",
              text:
                input.accounts === null
                  ? "Não foi possível ler as contas bancárias ao montar o relatório."
                  : "Nenhuma aplicação cadastrada em Contas Bancárias.",
              muted: true,
            },
          ],
    });
  }

  return out.map((sec) => ({ ...sec }));
}

// ─── Documento ────────────────────────────────────────────────────────────────

const TEXT_COLUMNS = ["O que é", "Data do saldo", "Na projeção"];

function TableView({ table, dense }: { table: Table; dense?: boolean }) {
  const numeric = (i: number) =>
    i > 0 && !TEXT_COLUMNS.includes(table.columns[i]);
  const widths = table.columns.map((c, i) =>
    i === 0 ? (c === "Lançamento" ? 3.4 : 2.2) : c === "O que é" ? 3 : 1,
  );
  const cell = (i: number) => ({
    flex: widths[i],
    textAlign: numeric(i) ? ("right" as const) : ("left" as const),
    paddingRight: i < table.columns.length - 1 ? 8 : 0,
  });
  return (
    <View style={{ marginTop: 4 }}>
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 0.75,
          borderBottomColor: C.ink,
          paddingBottom: 3,
        }}
        fixed={false}
      >
        {table.columns.map((c, i) => (
          <Text
            key={c}
            style={[cell(i), { fontSize: 7, color: C.muted, fontWeight: 600 }]}
          >
            {c}
          </Text>
        ))}
      </View>
      {table.rows.map((r, ri) => (
        <View
          key={ri}
          wrap={false}
          style={{
            flexDirection: "row",
            paddingVertical: dense ? 2 : 2.6,
            borderBottomWidth: 0.4,
            borderBottomColor: C.grid,
          }}
        >
          {r.map((v, i) => (
            <Text
              key={i}
              style={[
                cell(i),
                numeric(i) ? s.num : {},
                { fontSize: numeric(i) ? 7.5 : 7.8 },
              ]}
            >
              {v}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Footer({ input }: { input: AnalyticsPdfInput }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {input.companyName} · Análise financeira · {input.brief.periodLabel}
      </Text>
      <Text
        style={s.num}
        render={({ pageNumber, totalPages }) =>
          `página ${pageNumber} de ${totalPages}`
        }
      />
    </View>
  );
}

/** Marca onde a seção caiu, para o índice da segunda passada. */
function PageMark({
  id,
  onPage,
}: {
  id: string;
  onPage: (id: string, page: number) => void;
}) {
  return (
    <Text
      style={{ fontSize: 1, color: C.paper }}
      render={({ pageNumber }) => {
        onPage(id, pageNumber);
        return " ";
      }}
    />
  );
}

export function AnalyticsPdfDocument({
  input,
  pages,
  onPage,
}: {
  input: AnalyticsPdfInput;
  /** Página de cada seção, da primeira passada (null na primeira). */
  pages: Record<string, number> | null;
  onPage: (id: string, page: number) => void;
}) {
  const { report, brief } = input;
  const sections = buildSections(input);
  const figures = sections.flatMap((sec) =>
    sec.blocks.flatMap((b) => (b.type === "figure" ? [{ sec, b }] : [])),
  );
  const regime =
    report.regime === "cash" ? "regime de caixa" : "regime de competência";
  const indexRows = [
    { id: "resumo", label: "Resumo executivo", title: "O que pede atenção" },
    ...sections.map((sec) => ({
      id: sec.id,
      label: sec.kicker,
      title: sec.title,
    })),
    { id: "anexo", label: "Anexo", title: "Tabelas dos gráficos" },
    { id: "metodo", label: "Notas de método", title: "De onde vêm os números" },
  ];

  return (
    <Document
      title={`Análise financeira · ${input.companyName} · ${brief.periodLabel}`}
      author="Financeiro · Hebron ASEEC"
      subject="Relatório para a diretoria"
      language="pt-BR"
    >
      {/* Capa */}
      <Page size="A4" style={{ backgroundColor: C.paper, fontFamily: "Body" }}>
        <View
          style={{
            backgroundColor: C.primary,
            height: 470,
            paddingHorizontal: MARGIN,
            paddingTop: 64,
            paddingBottom: 48,
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: "#c9cdf0",
              fontSize: 8.5,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Hebron ASEEC · Financeiro
          </Text>
          <View>
            <Text
              style={{
                fontFamily: "Head",
                fontWeight: 600,
                fontSize: 38,
                lineHeight: 1.08,
                color: C.paper,
              }}
            >
              Análise financeira
            </Text>
            <Text
              style={{
                fontFamily: "Head",
                fontWeight: 600,
                fontSize: 17,
                color: "#dfe2f7",
                marginTop: 12,
              }}
            >
              {input.companyName}
            </Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: MARGIN, paddingTop: 28 }}>
          <View style={{ flexDirection: "row" }}>
            {[
              ["Período", brief.periodLabel],
              ["Regime", regime],
              [
                "Comparação",
                brief.compareLabel
                  ? `com ${brief.compareLabel}`
                  : "sem comparação",
              ],
            ].map(([k, v]) => (
              <View key={k} style={{ flex: 1 }}>
                <Text style={{ fontSize: 7.5, color: C.muted }}>{k}</Text>
                <Text style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                  {v}
                </Text>
              </View>
            ))}
          </View>
          <Text
            style={{
              marginTop: 26,
              fontSize: 9,
              color: C.muted,
              lineHeight: 1.5,
            }}
          >
            Relatório para a diretoria e o conselho. Gerado em{" "}
            {format(input.generatedAt, "dd/MM/yyyy 'às' HH:mm")} a partir de{" "}
            {input.transactionCount.toLocaleString("pt-BR")} lançamentos do
            sistema; os números são os mesmos da página Análise.
          </Text>
        </View>
      </Page>

      {/* Índice */}
      <Page size="A4" style={s.page}>
        <Footer input={input} />
        <Text style={s.kicker}>Índice</Text>
        <Text style={[s.headline, { marginBottom: 14 }]}>
          O relatório em uma página
        </Text>
        {indexRows.map((row, i) => (
          <View
            key={row.id}
            wrap={false}
            style={{
              flexDirection: "row",
              paddingVertical: 6.5,
              borderTopWidth: 0.5,
              borderTopColor: C.rule,
            }}
          >
            <Text
              style={[
                s.num,
                { width: 22, fontSize: 8, color: C.primary, fontWeight: 600 },
              ]}
            >
              {String(i + 1).padStart(2, "0")}
            </Text>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={{ fontSize: 7.5, color: C.muted }}>{row.label}</Text>
              <Text style={{ fontSize: 9.5, marginTop: 1 }}>{row.title}</Text>
            </View>
            <Text
              style={[s.num, { width: 24, textAlign: "right", fontSize: 8.5 }]}
            >
              {pages?.[row.id] ?? ""}
            </Text>
          </View>
        ))}
      </Page>

      {/* Resumo e atenção */}
      <Page size="A4" style={s.page}>
        <Footer input={input} />
        <PageMark id="resumo" onPage={onPage} />
        <Text style={s.kicker}>Resumo executivo</Text>
        <Text
          style={{
            fontSize: 11.5,
            lineHeight: 1.55,
            marginTop: 10,
            color: C.ink,
          }}
        >
          {input.summary.sentences.join(" ")}
        </Text>
        <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 8 }}>
          {input.summary.source === "ai"
            ? "Redigido por IA a partir deste relatório; cada número citado foi conferido com os dados do sistema."
            : "Montado pelas regras da Análise, com as conclusões das seções."}
        </Text>

        <Text style={[s.kicker, { marginTop: 28 }]}>O que pede atenção</Text>
        {input.attention.length === 0 ? (
          <Text style={[s.desc, { marginTop: 8 }]}>
            Nada passou dos limites: caixa projetado em 12 meses, envelopes,
            previsto, recebíveis antigos e concentração.
          </Text>
        ) : (
          <View style={{ marginTop: 8 }}>
            {input.attention.map((item, i) => (
              <View
                key={item.id}
                wrap={false}
                style={{
                  flexDirection: "row",
                  paddingVertical: 7,
                  borderTopWidth: 0.5,
                  borderTopColor: C.rule,
                }}
              >
                <Text
                  style={[
                    s.num,
                    {
                      width: 22,
                      fontSize: 9,
                      fontWeight: 600,
                      color: C.primary,
                    },
                  ]}
                >
                  {i + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 7,
                      fontWeight: 600,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      color: item.tone === "danger" ? C.danger : C.amber,
                    }}
                  >
                    {item.tone === "danger" ? "Crítico" : "Atenção"}
                  </Text>
                  <Text style={{ fontSize: 9.5, marginTop: 1.5 }}>
                    {item.text}
                  </Text>
                </View>
                <Text
                  style={{
                    width: 86,
                    textAlign: "right",
                    fontSize: 7.5,
                    color: C.muted,
                  }}
                >
                  {item.sectionLabel}
                  {pages?.[item.section] ? `, p. ${pages[item.section]}` : ""}
                </Text>
              </View>
            ))}
            {input.attention.some((a) => a.ai) ? (
              <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 6 }}>
                Destaques redigidos por IA e conferidos número a número; os que
                não passaram ficaram com o texto padrão.
              </Text>
            ) : null}
          </View>
        )}
      </Page>

      {/* Seções */}
      {sections.map((sec, si) => (
        <Page key={sec.id} size="A4" style={s.page}>
          <Footer input={input} />
          <PageMark id={sec.id} onPage={onPage} />
          <Text style={s.kicker}>
            {String(si + 1).padStart(2, "0")} · {sec.kicker}
          </Text>
          <Text style={s.headline} minPresenceAhead={80}>
            {sec.title}
          </Text>
          {sec.description ? (
            <Text style={s.desc}>{sec.description}</Text>
          ) : null}
          {sec.blocks.map((b, bi) => {
            if (b.type === "kpis") return <Kpis key={bi} items={b.items} />;
            if (b.type === "text")
              return (
                <Text key={bi} style={[s.desc, { marginTop: 14 }]}>
                  {b.text}
                </Text>
              );
            if (b.type === "sub")
              return (
                <Text key={bi} style={s.sub} minPresenceAhead={120}>
                  {b.text}
                </Text>
              );
            if (b.type === "table")
              return (
                <View key={bi} style={{ marginTop: 14 }} wrap={false}>
                  <Text style={{ fontSize: 8.5, fontWeight: 600 }}>
                    {b.title}
                  </Text>
                  <TableView table={b.table} dense />
                </View>
              );
            return (
              <View key={bi} style={{ marginTop: 18 }} wrap={false}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    marginBottom: 6,
                  }}
                >
                  <Text
                    style={[
                      s.num,
                      { fontSize: 7.5, fontWeight: 600, color: C.primary },
                    ]}
                  >
                    Gráfico {b.n}
                  </Text>
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      marginLeft: 8,
                      flex: 1,
                    }}
                  >
                    {b.title}
                  </Text>
                  <Text style={{ fontSize: 7.5, color: C.muted }}>
                    Tabela A{b.n} no anexo
                  </Text>
                </View>
                {b.legend ? <Legend items={b.legend} /> : null}
                {b.chart}
                {b.note ? (
                  <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 5 }}>
                    {b.note}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Page>
      ))}

      {/* Anexo */}
      <Page size="A4" style={s.page}>
        <Footer input={input} />
        <PageMark id="anexo" onPage={onPage} />
        <Text style={s.kicker}>Anexo</Text>
        <Text style={s.headline}>Tabelas dos gráficos</Text>
        <Text style={s.desc}>
          Os valores exatos de cada gráfico, em reais com centavos.
        </Text>
        {figures.map(({ sec, b }) =>
          b.type === "figure" ? (
            <View key={b.n} style={{ marginTop: 16 }}>
              <View
                minPresenceAhead={60}
                style={{ flexDirection: "row", alignItems: "baseline" }}
              >
                <Text
                  style={[
                    s.num,
                    { fontSize: 7.5, fontWeight: 600, color: C.primary },
                  ]}
                >
                  A{b.n}
                </Text>
                <Text
                  style={{
                    fontSize: 8.5,
                    fontWeight: 600,
                    marginLeft: 8,
                    flex: 1,
                  }}
                >
                  {b.title}
                </Text>
                <Text style={{ fontSize: 7.5, color: C.muted }}>
                  {sec.kicker}
                  {pages?.[sec.id] ? `, p. ${pages[sec.id]}` : ""}
                </Text>
              </View>
              <TableView table={b.table} />
            </View>
          ) : null,
        )}
      </Page>

      {/* Método */}
      <Page size="A4" style={s.page}>
        <Footer input={input} />
        <PageMark id="metodo" onPage={onPage} />
        <Text style={s.kicker}>Notas de método</Text>
        <Text style={s.headline}>De onde vêm os números</Text>
        {[
          `Todos os valores saem dos lançamentos de contas a pagar e a receber do sistema, com as mesmas regras da DRE e do fluxo de caixa dos Relatórios. Período: ${brief.periodLabel}, ${regime}.`,
          "Regime de caixa conta o que foi pago ou recebido, no mês da baixa. Regime de competência conta o mês a que o lançamento pertence, pago ou não; rejeitados ficam fora.",
          "Previsto é o valor com que o lançamento nasceu. Edição posterior vira revisão; lançamento criado já pago ou depois do vencimento é não previsto. Partes de um valor dividido depois contam como revisão, no mês da parte prevista.",
          "A projeção parte do caixa disponível de hoje (contas correntes e aplicação automática) e soma o que está autorizado, aprovado, em aprovação e as recorrências ainda não lançadas. Vencidos sem baixa ficam fora, porque não têm data futura.",
          "Os destaques de atenção seguem limites fixos: caixa negativo em 12 meses, envelope estourado ou acima do ritmo, desvio de mais de 10% entre previsto e realizado, recebíveis vencidos há mais de 90 dias e contraparte com mais de 30% de um lado, fora a mantenedora.",
          "Quando a IA redige um texto, cada número, data e nome citado é conferido com este relatório antes de aparecer; frase que não confere é descartada e volta o texto padrão.",
        ].map((p, i) => (
          <Text
            key={i}
            style={[s.desc, { marginTop: 10, color: C.ink, fontSize: 9 }]}
          >
            {p}
          </Text>
        ))}
      </Page>
    </Document>
  );
}

/**
 * Duas passadas: a primeira descobre em que página cada seção caiu, a segunda
 * escreve o índice com os números. O índice tem a mesma altura nas duas.
 */
export async function renderAnalyticsPdf<T>(
  input: AnalyticsPdfInput,
  render: (doc: ReactElement<DocumentProps>) => Promise<T>,
): Promise<T> {
  const pages: Record<string, number> = {};
  await render(
    <AnalyticsPdfDocument
      input={input}
      pages={null}
      onPage={(id, page) => (pages[id] = page)}
    />,
  );
  return render(
    <AnalyticsPdfDocument input={input} pages={pages} onPage={() => {}} />,
  );
}
