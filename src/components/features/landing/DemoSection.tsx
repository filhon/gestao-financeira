"use client";

import { useState } from "react";
import {
  BarChart3,
  RefreshCw,
  Layers,
  FileText,
  TrendingUp,
  TrendingDown,
  Clock,
  ChevronRight,
  CheckCircle2,
  ArrowLeftRight,
  Download,
  Loader2,
  AlertCircle,
  DollarSign,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(used: number, budget: number) {
  return Math.min(100, Math.round((used / budget) * 100));
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const DASH: Record<
  string,
  { receitas: number; despesas: number; pendentes: number; bars: number[] }
> = {
  hoje: {
    receitas: 12400,
    despesas: 8900,
    pendentes: 3,
    bars: [30, 55, 40, 72, 48, 63, 88],
  },
  semana: {
    receitas: 48300,
    despesas: 31200,
    pendentes: 8,
    bars: [55, 68, 42, 78, 57, 72, 90],
  },
  mes: {
    receitas: 123400,
    despesas: 89200,
    pendentes: 12,
    bars: [60, 43, 70, 52, 82, 63, 91],
  },
};

type TxStatus = "pending_approval" | "approved" | "paid";

interface Tx {
  id: number;
  entity: string;
  category: string;
  value: number;
  due: string;
  status: TxStatus;
}

const INIT_TXS: Tx[] = [
  {
    id: 1,
    entity: "Fornecedor Alpha",
    category: "Serviços",
    value: 8500,
    due: "29/03",
    status: "pending_approval",
  },
  {
    id: 2,
    entity: "Tech Solutions Ltda",
    category: "Software",
    value: 2400,
    due: "30/03",
    status: "approved",
  },
  {
    id: 3,
    entity: "Escritório Contábil",
    category: "Contabilidade",
    value: 1800,
    due: "01/04",
    status: "paid",
  },
  {
    id: 4,
    entity: "Operadora Logística",
    category: "Frete",
    value: 3200,
    due: "02/04",
    status: "pending_approval",
  },
  {
    id: 5,
    entity: "Aluguel Comercial",
    category: "Imóveis",
    value: 12000,
    due: "05/04",
    status: "paid",
  },
  {
    id: 6,
    entity: "Marketing Digital",
    category: "Publicidade",
    value: 4500,
    due: "07/04",
    status: "approved",
  },
];

interface RecItem {
  id: number;
  desc: string;
  value: number;
  date: string;
  matched: boolean;
}

const INIT_BANK: RecItem[] = [
  {
    id: 1,
    desc: "TED RECEBIDA - CLIENTE BETA",
    value: 15000,
    date: "28/03",
    matched: false,
  },
  {
    id: 2,
    desc: "PAGAMENTO FORNECEDOR 001",
    value: -8500,
    date: "28/03",
    matched: false,
  },
  {
    id: 3,
    desc: "PIX RECEBIDO - VENDA #4821",
    value: 3200,
    date: "29/03",
    matched: false,
  },
  {
    id: 4,
    desc: "DÉBITO AUTOMÁTICO - SERVIÇO",
    value: -2400,
    date: "29/03",
    matched: false,
  },
];

const INIT_SYS: RecItem[] = [
  {
    id: 1,
    desc: "Recebimento Cliente Beta",
    value: 15000,
    date: "28/03",
    matched: false,
  },
  {
    id: 2,
    desc: "Pagamento Fornecedor Alpha",
    value: -8500,
    date: "28/03",
    matched: false,
  },
  {
    id: 3,
    desc: "Venda Produto #4821",
    value: 3200,
    date: "29/03",
    matched: false,
  },
  {
    id: 4,
    desc: "Assinatura Tech Solutions",
    value: -2400,
    date: "29/03",
    matched: false,
  },
];

interface CostNode {
  id: number;
  name: string;
  budget: number;
  used: number;
  color: string;
  children: { id: number; name: string; budget: number; used: number }[];
}

const COST_CENTERS: CostNode[] = [
  {
    id: 1,
    name: "Tecnologia",
    budget: 50000,
    used: 38500,
    color: "#4478F5",
    children: [
      { id: 11, name: "Infraestrutura", budget: 20000, used: 18200 },
      { id: 12, name: "Software", budget: 15000, used: 11300 },
      { id: 13, name: "P&D", budget: 15000, used: 9000 },
    ],
  },
  {
    id: 2,
    name: "Operações",
    budget: 80000,
    used: 52000,
    color: "#10B981",
    children: [
      { id: 21, name: "Logística", budget: 30000, used: 24000 },
      { id: 22, name: "Atendimento", budget: 25000, used: 15000 },
      { id: 23, name: "Instalações", budget: 25000, used: 13000 },
    ],
  },
  {
    id: 3,
    name: "Marketing",
    budget: 30000,
    used: 21000,
    color: "#8B5CF6",
    children: [
      { id: 31, name: "Digital", budget: 18000, used: 14500 },
      { id: 32, name: "Eventos", budget: 12000, used: 6500 },
    ],
  },
];

const REPORTS = [
  {
    id: "fluxo",
    Icon: TrendingUp,
    name: "Fluxo de Caixa",
    desc: "Entradas e saídas por período",
  },
  {
    id: "dre",
    Icon: BarChart3,
    name: "DRE Gerencial",
    desc: "Demonstrativo do resultado",
  },
  {
    id: "custos",
    Icon: Layers,
    name: "Centros de Custo",
    desc: "Gastos por departamento ou projeto",
  },
  {
    id: "venc",
    Icon: Clock,
    name: "A Vencer",
    desc: "Obrigações por data de vencimento",
  },
] as const;

// ─── Status helpers ───────────────────────────────────────────────────────────
const STATUS_LABEL: Record<TxStatus, string> = {
  pending_approval: "Pend. Aprovação",
  approved: "Aprovado",
  paid: "Pago",
};
const STATUS_COLORS: Record<TxStatus, { bg: string; color: string }> = {
  pending_approval: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B" },
  approved: { bg: "rgba(68,120,245,0.12)", color: "#4478F5" },
  paid: { bg: "rgba(16,185,129,0.12)", color: "#10B981" },
};

// ─── Inline styles shared ─────────────────────────────────────────────────────
const S = {
  card: {
    background: "var(--fin-surface-2, #111B36)",
    border: "1px solid var(--fin-border-2, rgba(255,255,255,0.11))",
    borderRadius: 10,
    padding: "14px 16px",
  } as React.CSSProperties,
  label: {
    fontSize: 11,
    color: "var(--fin-muted, #7A889E)",
    fontFamily: "'DM Sans', sans-serif",
    marginBottom: 4,
  } as React.CSSProperties,
  value: {
    fontSize: 22,
    fontFamily: "'Cormorant Garamond', serif",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1,
  } as React.CSSProperties,
  tabActive: {
    background: "rgba(200,150,42,0.12)",
    color: "var(--fin-gold-lt, #E5B44A)",
    borderColor: "rgba(200,150,42,0.3)",
  } as React.CSSProperties,
  tabInactive: {
    background: "transparent",
    color: "var(--fin-muted, #7A889E)",
    borderColor: "transparent",
  } as React.CSSProperties,
};

// ─── Sub-demos ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DashboardDemo({ isDark: _ }: DemoProps) {
  const [period, setPeriod] = useState<"hoje" | "semana" | "mes">("semana");
  const d = DASH[period];
  const saldo = 847320;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%",
      }}
    >
      {/* Period selector */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["hoje", "semana", "mes"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
              border: "1px solid",
              cursor: "pointer",
              transition: "all 0.18s ease",
              ...(period === p ? S.tabActive : S.tabInactive),
            }}
          >
            {p === "hoje" ? "Hoje" : p === "semana" ? "7 dias" : "30 dias"}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          {
            label: "Saldo Disponível",
            value: fmt(saldo),
            icon: <DollarSign size={13} />,
            color: "var(--fin-gold-lt, #E5B44A)",
          },
          {
            label: "Receitas",
            value: fmt(d.receitas),
            icon: <TrendingUp size={13} />,
            color: "#10B981",
          },
          {
            label: "Despesas",
            value: fmt(d.despesas),
            icon: <TrendingDown size={13} />,
            color: "#EF4444",
          },
          {
            label: "Pendentes",
            value: `${d.pendentes} itens`,
            icon: <Clock size={13} />,
            color: "#F59E0B",
          },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={S.card}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginBottom: 6,
              }}
            >
              <span style={{ color }}>{icon}</span>
              <span style={S.label}>{label}</span>
            </div>
            <div style={{ ...S.value, fontSize: 18, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div style={{ ...S.card, flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--fin-muted)",
            fontFamily: "'DM Sans', sans-serif",
            marginBottom: 12,
          }}
        >
          Fluxo dos últimos 7 dias
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            height: 72,
            paddingBottom: 4,
          }}
        >
          {d.bars.map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <div
                style={{
                  width: "100%",
                  borderRadius: "4px 4px 0 0",
                  height: `${h}%`,
                  background:
                    i === d.bars.length - 1
                      ? "linear-gradient(to top, var(--fin-gold, #C8962A), var(--fin-gold-lt, #E5B44A))"
                      : "rgba(68,120,245,0.35)",
                  transition: "height 0.4s ease",
                  minHeight: 4,
                }}
              />
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          {["S", "D", "T", "Q", "Q", "S", "S"].map((d, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                color: "var(--fin-muted)",
                fontFamily: "'DM Sans', sans-serif",
                flex: 1,
                textAlign: "center",
              }}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FinanceiroDemo({ isDark }: DemoProps) {
  const [filter, setFilter] = useState<TxStatus | "all">("all");
  const [txs, setTxs] = useState<Tx[]>(INIT_TXS);

  const visible =
    filter === "all" ? txs : txs.filter((t) => t.status === filter);

  function approve(id: number) {
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "approved" } : t)),
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
      }}
    >
      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {(
          [
            { key: "all", label: "Todas" },
            { key: "pending_approval", label: "Pendentes" },
            { key: "approved", label: "Aprovados" },
            { key: "paid", label: "Pagos" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
              border: "1px solid",
              cursor: "pointer",
              transition: "all 0.18s ease",
              ...(filter === key ? S.tabActive : S.tabInactive),
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto",
            gap: 8,
            padding: "0 10px",
            alignItems: "center",
          }}
        >
          {["Fornecedor", "Valor", "Venc.", "Status"].map((h) => (
            <span
              key={h}
              style={{
                fontSize: 10,
                color: "var(--fin-muted)",
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {h}
            </span>
          ))}
        </div>

        {visible.map((tx) => {
          const sc = STATUS_COLORS[tx.status];
          return (
            <div
              key={tx.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: 8,
                padding: "10px",
                borderRadius: 8,
                alignItems: "center",
                background: subtle(isDark),
                border: "1px solid var(--fin-border)",
                transition: "border-color 0.2s",
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = isDark
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(0,0,0,0.18)";
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "var(--fin-border)";
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "'DM Sans', sans-serif",
                    lineHeight: 1.3,
                  }}
                >
                  {tx.entity}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fin-muted)",
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  {tx.category}
                </div>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontFamily: "'Cormorant Garamond', serif",
                  fontWeight: 700,
                }}
              >
                {fmt(tx.value)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fin-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {tx.due}
              </span>
              {tx.status === "pending_approval" ? (
                <button
                  onClick={() => approve(tx.id)}
                  style={{
                    fontSize: 10,
                    padding: "4px 9px",
                    borderRadius: 5,
                    background: "rgba(68,120,245,0.15)",
                    color: "#4478F5",
                    border: "1px solid rgba(68,120,245,0.3)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    transition: "all 0.15s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(68,120,245,0.28)";
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(68,120,245,0.15)";
                  }}
                >
                  Aprovar
                </button>
              ) : (
                <span
                  style={{
                    fontSize: 10,
                    padding: "4px 9px",
                    borderRadius: 5,
                    background: sc.bg,
                    color: sc.color,
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    border: `1px solid ${sc.color}30`,
                  }}
                >
                  {STATUS_LABEL[tx.status]}
                </span>
              )}
            </div>
          );
        })}

        {visible.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "32px 0",
              color: "var(--fin-muted)",
              fontSize: 13,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Nenhuma transação neste filtro.
          </div>
        )}
      </div>
    </div>
  );
}

function ReconciliacaoDemo({ isDark }: DemoProps) {
  const [bank, setBank] = useState<RecItem[]>(INIT_BANK);
  const [sys, setSys] = useState<RecItem[]>(INIT_SYS);
  const [selected, setSelected] = useState<number | null>(null);

  function matchItem(id: number) {
    setBank((prev) =>
      prev.map((b) => (b.id === id ? { ...b, matched: true } : b)),
    );
    setSys((prev) =>
      prev.map((s) => (s.id === id ? { ...s, matched: true } : s)),
    );
    setSelected(null);
  }

  function reset() {
    setBank(INIT_BANK.map((b) => ({ ...b, matched: false })));
    setSys(INIT_SYS.map((s) => ({ ...s, matched: false })));
    setSelected(null);
  }

  const allDone = bank.every((b) => b.matched);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--fin-muted)",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Selecione um item e clique em{" "}
          <strong style={{ color: "var(--fin-text)" }}>Conciliar</strong>
        </span>
        <button
          onClick={reset}
          style={{
            fontSize: 11,
            color: "var(--fin-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <RefreshCw size={11} /> Reiniciar
        </button>
      </div>

      {allDone && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(16,185,129,0.1)",
            border: "1px solid rgba(16,185,129,0.25)",
          }}
        >
          <CheckCircle2 size={14} style={{ color: "#10B981", flexShrink: 0 }} />
          <span
            style={{
              fontSize: 12,
              color: "#10B981",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Conciliação completa — todos os itens foram reconciliados.
          </span>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          flex: 1,
        }}
      >
        {/* Bank column */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--fin-muted)",
              marginBottom: 8,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Extrato Bancário
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bank.map((item) => (
              <div
                key={item.id}
                onClick={() =>
                  !item.matched &&
                  setSelected(selected === item.id ? null : item.id)
                }
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  cursor: item.matched ? "default" : "pointer",
                  border: `1px solid ${item.matched ? "rgba(16,185,129,0.3)" : selected === item.id ? "rgba(200,150,42,0.4)" : "var(--fin-border)"}`,
                  background: item.matched
                    ? "rgba(16,185,129,0.07)"
                    : selected === item.id
                      ? "rgba(200,150,42,0.07)"
                      : subtle(isDark),
                  transition: "all 0.18s ease",
                  opacity: item.matched ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'DM Sans', sans-serif",
                    lineHeight: 1.4,
                    marginBottom: 4,
                  }}
                >
                  {item.desc}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--fin-muted)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {item.date}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "'Cormorant Garamond', serif",
                      fontWeight: 700,
                      color: item.value > 0 ? "#10B981" : "#EF4444",
                    }}
                  >
                    {item.value > 0 ? "+" : ""}
                    {fmt(item.value)}
                  </span>
                </div>
                {item.matched && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 4,
                    }}
                  >
                    <CheckCircle2 size={10} style={{ color: "#10B981" }} />
                    <span
                      style={{
                        fontSize: 10,
                        color: "#10B981",
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      Conciliado
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* System column */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--fin-muted)",
              marginBottom: 8,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Sistema
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sys.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${item.matched ? "rgba(16,185,129,0.3)" : "var(--fin-border)"}`,
                  background: item.matched
                    ? "rgba(16,185,129,0.07)"
                    : subtle(isDark),
                  transition: "all 0.18s ease",
                  opacity: item.matched ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'DM Sans', sans-serif",
                    lineHeight: 1.4,
                    marginBottom: 4,
                  }}
                >
                  {item.desc}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--fin-muted)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {item.date}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "'Cormorant Garamond', serif",
                      fontWeight: 700,
                      color: item.value > 0 ? "#10B981" : "#EF4444",
                    }}
                  >
                    {item.value > 0 ? "+" : ""}
                    {fmt(item.value)}
                  </span>
                </div>
                {item.matched && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 4,
                    }}
                  >
                    <CheckCircle2 size={10} style={{ color: "#10B981" }} />
                    <span
                      style={{
                        fontSize: 10,
                        color: "#10B981",
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      Conciliado
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Conciliar button */}
      {selected !== null && (
        <button
          onClick={() => matchItem(selected!)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "11px",
            borderRadius: 8,
            cursor: "pointer",
            background: "rgba(200,150,42,0.12)",
            border: "1px solid rgba(200,150,42,0.35)",
            color: "var(--fin-gold-lt, #E5B44A)",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            transition: "all 0.18s ease",
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(200,150,42,0.2)";
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(200,150,42,0.12)";
          }}
        >
          <ArrowLeftRight size={14} />
          Conciliar item selecionado
        </button>
      )}
    </div>
  );
}

function CentrosCustoDemo({ isDark }: DemoProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([1]));

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        overflow: "auto",
      }}
    >
      {COST_CENTERS.map((node) => {
        const isOpen = expanded.has(node.id);
        const p = pct(node.used, node.budget);
        const warn = p >= 80;

        return (
          <div key={node.id}>
            {/* Parent row */}
            <div
              onClick={() => toggle(node.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 9,
                cursor: "pointer",
                background: isOpen ? `${node.color}0D` : subtle(isDark),
                border: `1px solid ${isOpen ? `${node.color}30` : "var(--fin-border)"}`,
                transition: "all 0.2s ease",
              }}
            >
              <ChevronRight
                size={14}
                style={{
                  color: node.color,
                  transition: "transform 0.2s ease",
                  transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {node.name}
                  </span>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {warn && (
                      <AlertCircle size={12} style={{ color: "#F59E0B" }} />
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: "'DM Sans', sans-serif",
                        color: "var(--fin-muted)",
                      }}
                    >
                      {fmt(node.used)} / {fmt(node.budget)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: "'DM Sans', sans-serif",
                        color: warn ? "#F59E0B" : node.color,
                      }}
                    >
                      {p}%
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: subtle(isDark, 3),
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${p}%`,
                      borderRadius: 2,
                      background: warn ? "#F59E0B" : node.color,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Children */}
            {isOpen && (
              <div
                style={{
                  marginTop: 4,
                  marginLeft: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {node.children.map((child) => {
                  const cp = pct(child.used, child.budget);
                  return (
                    <div
                      key={child.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: subtle(isDark),
                        border: "1px solid var(--fin-border)",
                      }}
                    >
                      <div
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "var(--fin-muted, #7A889E)",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 5,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontFamily: "'DM Sans', sans-serif",
                              color: "var(--fin-text)",
                            }}
                          >
                            {child.name}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--fin-muted)",
                              fontFamily: "'DM Sans', sans-serif",
                            }}
                          >
                            {fmt(child.used)} / {fmt(child.budget)} —{" "}
                            <strong
                              style={{
                                color: cp >= 80 ? "#F59E0B" : "var(--fin-text)",
                              }}
                            >
                              {cp}%
                            </strong>
                          </span>
                        </div>
                        <div
                          style={{
                            height: 3,
                            borderRadius: 2,
                            background: subtle(isDark, 2.5),
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${cp}%`,
                              borderRadius: 2,
                              background: cp >= 80 ? "#F59E0B" : node.color,
                              transition: "width 0.4s ease",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ReportState = "idle" | "loading" | "done";

function RelatoriosDemo({ isDark }: DemoProps) {
  const [selected, setSelected] = useState<string>("fluxo");
  const [format, setFormat] = useState<"pdf" | "excel" | "csv">("pdf");
  const [state, setState] = useState<ReportState>("idle");

  function generate() {
    setState("loading");
    setTimeout(() => setState("done"), 2000);
    setTimeout(() => setState("idle"), 4500);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
      }}
    >
      {/* Report list */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flex: 1,
          overflow: "auto",
        }}
      >
        {REPORTS.map(({ id, Icon, name, desc }) => (
          <div
            key={id}
            onClick={() => setSelected(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 9,
              cursor: "pointer",
              transition: "all 0.18s ease",
              border: `1px solid ${selected === id ? "rgba(200,150,42,0.35)" : "var(--fin-border)"}`,
              background:
                selected === id ? "rgba(200,150,42,0.07)" : subtle(isDark),
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  selected === id ? "rgba(200,150,42,0.15)" : subtle(isDark, 2),
                color:
                  selected === id
                    ? "var(--fin-gold-lt, #E5B44A)"
                    : "var(--fin-muted, #7A889E)",
                transition: "all 0.18s ease",
              }}
            >
              <Icon size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif",
                  color:
                    selected === id ? "var(--fin-text)" : "var(--fin-muted)",
                }}
              >
                {name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fin-muted)",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {desc}
              </div>
            </div>
            {selected === id && (
              <CheckCircle2
                size={14}
                style={{ color: "var(--fin-gold-lt, #E5B44A)", flexShrink: 0 }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Format + generate */}
      <div
        style={{ ...S.card, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontFamily: "'DM Sans', sans-serif",
              color: "var(--fin-muted)",
            }}
          >
            Formato de saída
          </span>
          <div style={{ display: "flex", gap: 5 }}>
            {(["pdf", "excel", "csv"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  fontSize: 11,
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 500,
                  border: "1px solid",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textTransform: "uppercase",
                  ...(format === f ? S.tabActive : S.tabInactive),
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={generate}
          disabled={state !== "idle"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "11px",
            borderRadius: 8,
            cursor: state === "idle" ? "pointer" : "default",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            transition: "all 0.2s ease",
            ...(state === "done"
              ? {
                  background: "rgba(16,185,129,0.15)",
                  border: "1px solid rgba(16,185,129,0.3)",
                  color: "#10B981",
                }
              : state === "loading"
                ? {
                    background: subtle(isDark, 2),
                    border: "1px solid var(--fin-border)",
                    color: "var(--fin-muted)",
                  }
                : {
                    background: "var(--fin-gold, #C8962A)",
                    border: "1px solid transparent",
                    color: "#0A0C18",
                  }),
          }}
          onMouseOver={(e) => {
            if (state === "idle")
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--fin-gold-lt, #E5B44A)";
          }}
          onMouseOut={(e) => {
            if (state === "idle")
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--fin-gold, #C8962A)";
          }}
        >
          {state === "loading" ? (
            <>
              <Loader2
                size={14}
                style={{ animation: "spin 1s linear infinite" }}
              />{" "}
              Gerando...
            </>
          ) : state === "done" ? (
            <>
              <Download size={14} /> Pronto para download!
            </>
          ) : (
            <>
              <FileText size={14} /> Gerar Relatório
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Shared prop ─────────────────────────────────────────────────────────────
interface DemoProps {
  isDark: boolean;
}

// Helper: subtle surface bg that works in both themes
function subtle(isDark: boolean, opacity = 1) {
  return isDark
    ? `rgba(255,255,255,${0.025 * opacity})`
    : `rgba(0,0,0,${0.04 * opacity})`;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  {
    id: "dashboard",
    label: "Dashboard",
    Icon: BarChart3,
    Component: DashboardDemo,
  },
  {
    id: "financeiro",
    label: "Financeiro",
    Icon: DollarSign,
    Component: FinanceiroDemo,
  },
  {
    id: "reconcil",
    label: "Conciliação",
    Icon: ArrowLeftRight,
    Component: ReconciliacaoDemo,
  },
  {
    id: "custos",
    label: "Centros de Custo",
    Icon: Layers,
    Component: CentrosCustoDemo,
  },
  {
    id: "relatorios",
    label: "Relatórios",
    Icon: FileText,
    Component: RelatoriosDemo,
  },
] as const;

// ─── Main export ──────────────────────────────────────────────────────────────
export function DemoSection({ theme = "dark" }: { theme?: "dark" | "light" }) {
  const [active, setActive] = useState<string>("dashboard");

  const { Component } = TABS.find((t) => t.id === active)!;
  const isDark = theme === "dark";

  return (
    <section style={{ padding: "96px 0", position: "relative" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--fin-gold, #C8962A)",
              marginBottom: 12,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Demonstração interativa
          </p>
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "clamp(30px, 4vw, 50px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              color: "var(--fin-text, #E8EFFF)",
              marginBottom: 12,
            }}
          >
            Explore o sistema em tempo real
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "var(--fin-muted, #7A889E)",
              fontFamily: "'DM Sans', sans-serif",
              maxWidth: 480,
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            Dados fictícios, interações reais. Nenhuma informação é salva.
          </p>
        </div>

        {/* App window frame */}
        <div
          style={{
            borderRadius: 16,
            border: "1px solid var(--fin-border-2, rgba(255,255,255,0.11))",
            overflow: "hidden",
            boxShadow: isDark
              ? "0 40px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)"
              : "0 20px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.08)",
            background: "var(--fin-surface, #0C1228)",
          }}
        >
          {/* Browser chrome */}
          <div
            style={{
              padding: "12px 18px",
              borderBottom:
                "1px solid var(--fin-border, rgba(255,255,255,0.06))",
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--fin-surface-2, #111B36)",
            }}
          >
            {/* Traffic lights */}
            <div style={{ display: "flex", gap: 6 }}>
              {["#EF4444", "#F59E0B", "#10B981"].map((c) => (
                <div
                  key={c}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: c,
                    opacity: 0.7,
                  }}
                />
              ))}
            </div>
            {/* URL bar */}
            <div
              style={{
                flex: 1,
                maxWidth: 320,
                height: 26,
                borderRadius: 5,
                background: subtle(isDark, 1.5),
                border: "1px solid var(--fin-border)",
                display: "flex",
                alignItems: "center",
                paddingLeft: 10,
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#10B981",
                  opacity: 0.8,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: "var(--fin-muted, #7A889E)",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                app.fincontrol.com.br/{active}
              </span>
            </div>
          </div>

          {/* Sidebar + content */}
          <div style={{ display: "flex", minHeight: 520 }}>
            {/* Sidebar tabs */}
            <div
              style={{
                width: 200,
                flexShrink: 0,
                borderRight:
                  "1px solid var(--fin-border, rgba(255,255,255,0.06))",
                padding: "16px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                background: "var(--fin-surface-2, #111B36)",
              }}
            >
              {TABS.map(({ id, label, Icon }) => {
                const isActive = active === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActive(id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "9px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      transition: "all 0.18s ease",
                      background: isActive
                        ? "rgba(200,150,42,0.1)"
                        : "transparent",
                      color: isActive
                        ? "var(--fin-gold-lt, #E5B44A)"
                        : "var(--fin-muted, #7A889E)",
                    }}
                    onMouseOver={(e) => {
                      if (!isActive)
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = subtle(isDark, 1.5);
                    }}
                    onMouseOut={(e) => {
                      if (!isActive)
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "transparent";
                    }}
                  >
                    <Icon size={14} style={{ flexShrink: 0 }} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Demo content */}
            <div
              style={{ flex: 1, padding: 24, overflow: "auto", minHeight: 480 }}
            >
              <Component isDark={isDark} />
            </div>
          </div>
        </div>
      </div>

      {/* Keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}
