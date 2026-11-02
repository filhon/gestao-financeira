"use client";

import { useEffect, useState } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const fmt = (n: number) => brl.format(n);
const pct = (used: number, budget: number) =>
  Math.min(100, Math.round((used / budget) * 100));

// ─── Dashboard ────────────────────────────────────────────────────────────────
type Period = "hoje" | "semana" | "mes";

const DASH: Record<
  Period,
  {
    label: string;
    title: string;
    slots: string[];
    receitas: number[];
    despesas: number[];
    pendentes: number;
  }
> = {
  hoje: {
    label: "Hoje",
    title: "Fluxo de hoje, por faixa de horário",
    slots: ["8h", "10h", "12h", "14h", "16h", "18h"],
    receitas: [1800, 3200, 900, 2700, 2400, 1400],
    despesas: [2200, 900, 3100, 800, 1100, 800],
    pendentes: 3,
  },
  semana: {
    label: "7 dias",
    title: "Fluxo dos últimos 7 dias",
    slots: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
    receitas: [5200, 9800, 4100, 11300, 6200, 8900, 2800],
    despesas: [4800, 3100, 6200, 5400, 4300, 5900, 1500],
    pendentes: 8,
  },
  mes: {
    label: "30 dias",
    title: "Fluxo dos últimos 30 dias, por semana",
    slots: ["Sem 1", "Sem 2", "Sem 3", "Sem 4"],
    receitas: [28200, 35600, 27900, 31700],
    despesas: [21400, 24900, 19800, 23100],
    pendentes: 12,
  },
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function DashboardDemo() {
  const [period, setPeriod] = useState<Period>("semana");
  const [pick, setPick] = useState<number | null>(null);
  const d = DASH[period];
  const max = Math.max(...d.receitas, ...d.despesas);

  return (
    <>
      <div className="fin-toolbar" role="group" aria-label="Período">
        {(Object.keys(DASH) as Period[]).map((p) => (
          <button
            key={p}
            className="fin-chip"
            aria-pressed={period === p}
            onClick={() => {
              setPeriod(p);
              setPick(null);
            }}
          >
            {DASH[p].label}
          </button>
        ))}
      </div>

      <dl className="fin-kpis">
        <div className="fin-kpi">
          <dt>Saldo em conta</dt>
          <dd className="fin-num">{fmt(847320)}</dd>
        </div>
        <div className="fin-kpi">
          <dt>Receitas</dt>
          <dd className="fin-num fin-in">{fmt(sum(d.receitas))}</dd>
        </div>
        <div className="fin-kpi">
          <dt>Despesas</dt>
          <dd className="fin-num fin-out">{fmt(sum(d.despesas))}</dd>
        </div>
        <div className="fin-kpi">
          <dt>Pendentes</dt>
          <dd className="fin-num">{d.pendentes} itens</dd>
        </div>
      </dl>

      <div className="fin-chart">
        <div className="fin-chart-top">
          <strong>{d.title}</strong>
          <span className="fin-legend">
            <span>
              <i style={{ background: "var(--fin-pos)" }} />
              Receitas
            </span>
            <span>
              <i style={{ background: "var(--fin-neg)" }} />
              Despesas
            </span>
          </span>
        </div>
        <div className="fin-plot">
          <span className="fin-plot-max fin-num">{fmt(max)}</span>
          <div className="fin-slots">
            {d.slots.map((s, i) => (
              <button
                key={s}
                className="fin-slot"
                aria-pressed={pick === i}
                aria-label={`${s}: receitas ${fmt(d.receitas[i])}, despesas ${fmt(d.despesas[i])}`}
                onClick={() => setPick(pick === i ? null : i)}
              >
                <div
                  className="fin-bar"
                  data-k="in"
                  style={{ height: `${(d.receitas[i] / max) * 100}%` }}
                />
                <div
                  className="fin-bar"
                  data-k="out"
                  style={{ height: `${(d.despesas[i] / max) * 100}%` }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="fin-slot-labels">
          {d.slots.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
        <p className="fin-small" role="status">
          {pick === null
            ? "Toque em uma barra para ver os valores."
            : `${d.slots[pick]}: receitas ${fmt(d.receitas[pick])}, despesas ${fmt(d.despesas[pick])}.`}
        </p>
      </div>
    </>
  );
}

// ─── Financeiro: cada etapa tem um papel ──────────────────────────────────────
type Role = "approver" | "manager" | "releaser";
type TxStatus =
  | "pending_approval"
  | "approved"
  | "pending_authorization"
  | "authorized"
  | "paid"
  | "rejected";

const ROLE_LABEL: Record<Role, string> = {
  approver: "Aprovador",
  manager: "Gerente financeiro",
  releaser: "Pagador",
};
const STATUS_LABEL: Record<TxStatus, string> = {
  pending_approval: "Pend. aprovação",
  approved: "Aprovado",
  pending_authorization: "Pend. autorização",
  authorized: "Autorizado",
  paid: "Pago",
  rejected: "Rejeitado",
};
// Cada etapa tem um papel. Aprovar e autorizar podem ser rejeitados com motivo.
const NEXT: Partial<
  Record<
    TxStatus,
    { role: Role; label: string; to: TxStatus; canReject?: boolean }
  >
> = {
  pending_approval: {
    role: "approver",
    label: "Aprovar",
    to: "approved",
    canReject: true,
  },
  approved: {
    role: "manager",
    label: "Enviar para autorização",
    to: "pending_authorization",
  },
  pending_authorization: {
    role: "releaser",
    label: "Autorizar",
    to: "authorized",
    canReject: true,
  },
  authorized: { role: "releaser", label: "Dar baixa", to: "paid" },
};
const AFTER: Partial<Record<TxStatus, string>> = {
  approved: "Foi para a fila do gerente financeiro.",
  pending_authorization: "Foi para a fila do pagador.",
  authorized: "Está liberada para dar baixa.",
  paid: "Saiu do caixa e a baixa ficou registrada.",
};

interface Tx {
  id: number;
  entity: string;
  category: string;
  value: number;
  due: string;
  status: TxStatus;
  reason?: string;
}

const stamp = () =>
  new Date().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

const INIT_TXS: Tx[] = [
  {
    id: 1,
    entity: "Papelaria Central Ltda",
    category: "Material de escritório",
    value: 2480,
    due: "05/11/2026",
    status: "pending_approval",
  },
  {
    id: 2,
    entity: "Tech Solutions Ltda",
    category: "Software",
    value: 2400,
    due: "06/11/2026",
    status: "pending_authorization",
  },
  {
    id: 3,
    entity: "Escritório Contábil",
    category: "Contabilidade",
    value: 1800,
    due: "06/11/2026",
    status: "authorized",
  },
  {
    id: 4,
    entity: "Operadora Logística",
    category: "Frete",
    value: 3200,
    due: "09/11/2026",
    status: "pending_approval",
  },
  {
    id: 5,
    entity: "Locação Comercial",
    category: "Imóveis",
    value: 12000,
    due: "10/11/2026",
    status: "paid",
  },
  {
    id: 6,
    entity: "Marketing Digital",
    category: "Publicidade",
    value: 4500,
    due: "12/11/2026",
    status: "approved",
  },
];

function FinanceiroDemo() {
  const [role, setRole] = useState<Role>("approver");
  const [onlyMine, setOnlyMine] = useState(false);
  const [txs, setTxs] = useState(INIT_TXS);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [log, setLog] = useState<{ tag: string; text: string } | null>(null);

  const mine = (t: Tx) => NEXT[t.status]?.role === role;
  const mineCount = txs.filter(mine).length;
  const visible = onlyMine ? txs.filter(mine) : txs;

  function advance(id: number) {
    const tx = txs.find((t) => t.id === id);
    const next = tx && NEXT[tx.status];
    if (!tx || !next) return;
    setTxs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: next.to } : t)),
    );
    setLog({
      tag: `${next.label} · ${ROLE_LABEL[role]} · ${stamp()}`,
      text: `${tx.entity}. ${AFTER[next.to] ?? ""}`,
    });
  }

  function reject(id: number) {
    const tx = txs.find((t) => t.id === id);
    if (!tx || !reason.trim()) return;
    setTxs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: "rejected", reason: reason.trim() } : t,
      ),
    );
    setLog({
      tag: `Rejeitado · ${ROLE_LABEL[role]} · ${stamp()}`,
      text: `${tx.entity}. Motivo registrado: ${reason.trim()}`,
    });
    setRejecting(null);
    setReason("");
  }

  function restart() {
    setTxs(INIT_TXS);
    setLog(null);
    setRejecting(null);
    setReason("");
  }

  function changeRole(r: Role) {
    setRole(r);
    setRejecting(null);
    setReason("");
  }

  return (
    <>
      <div className="fin-toolbar">
        <div className="fin-toolbar-group" role="group" aria-label="Papel">
          <span className="fin-small">Atuando como</span>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <button
              key={r}
              className="fin-chip"
              aria-pressed={role === r}
              onClick={() => changeRole(r)}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="fin-toolbar-group" role="group" aria-label="Filtro">
          <span className="fin-small">Mostrar</span>
          <button
            className="fin-chip"
            aria-pressed={!onlyMine}
            onClick={() => setOnlyMine(false)}
          >
            Todas
          </button>
          <button
            className="fin-chip"
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine(true)}
          >
            Minha fila ({mineCount})
          </button>
        </div>
        <button className="fin-link-btn" onClick={restart}>
          Reiniciar
        </button>
      </div>
      <p className="fin-small">
        Cada etapa só tem ação para o papel dela: quem aprova não libera o
        pagamento. Troque o papel e veja a fila mudar.
      </p>

      <div role="status" aria-live="polite">
        {log && (
          <p className="fin-stamp">
            <span className="fin-stamp-tag fin-num">{log.tag}</span>
            {log.text}
          </p>
        )}
      </div>

      <div className="fin-scroll fin-panel">
        {visible.length > 0 && (
          <table className="fin-table">
            <thead>
              <tr>
                <th>Favorecido</th>
                <th className="fin-hide-sm">Vencimento</th>
                <th className="r">Valor</th>
                <th>Situação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tx) => {
                const next = NEXT[tx.status];
                const isMine = next?.role === role;
                return (
                  <tr key={tx.id}>
                    <td>
                      {tx.entity}
                      <span className="fin-cell-sub">{tx.category}</span>
                      {tx.reason && (
                        <span className="fin-cell-sub">
                          Motivo: {tx.reason}
                        </span>
                      )}
                    </td>
                    <td className="fin-hide-sm fin-num">{tx.due}</td>
                    <td className="r fin-num">{fmt(tx.value)}</td>
                    <td>
                      <span className="fin-pill" data-s={tx.status}>
                        {STATUS_LABEL[tx.status]}
                      </span>
                    </td>
                    <td>
                      {next && isMine && rejecting === tx.id ? (
                        <form
                          className="fin-reject"
                          onSubmit={(e) => {
                            e.preventDefault();
                            reject(tx.id);
                          }}
                        >
                          <input
                            className="fin-input"
                            aria-label={`Motivo da rejeição de ${tx.entity}`}
                            placeholder="Motivo da rejeição"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            autoFocus
                            required
                          />
                          <button
                            className="fin-action fin-action-danger"
                            type="submit"
                          >
                            Confirmar
                          </button>
                          <button
                            className="fin-link-btn"
                            type="button"
                            onClick={() => setRejecting(null)}
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : next && isMine ? (
                        <span className="fin-actions-row">
                          <button
                            className="fin-action"
                            onClick={() => advance(tx.id)}
                          >
                            {next.label}
                          </button>
                          {next.canReject && (
                            <button
                              className="fin-action fin-action-ghost"
                              onClick={() => {
                                setRejecting(tx.id);
                                setReason("");
                              }}
                            >
                              Rejeitar
                            </button>
                          )}
                        </span>
                      ) : next ? (
                        <span className="fin-small">
                          Aguarda {ROLE_LABEL[next.role].toLowerCase()}
                        </span>
                      ) : (
                        <span className="fin-small">Concluído</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {visible.length === 0 && (
          <p className="fin-empty">
            Nada na fila do {ROLE_LABEL[role].toLowerCase()}. Troque o papel
            para ver as outras etapas.
          </p>
        )}
      </div>
    </>
  );
}

// ─── Conciliação ──────────────────────────────────────────────────────────────
interface RecItem {
  id: number;
  desc: string;
  value: number;
  date: string;
  orphan?: boolean;
}

const BANK: RecItem[] = [
  {
    id: 1,
    desc: "TED RECEBIDA CLIENTE BETA",
    value: 15000,
    date: "28/10/2026",
  },
  { id: 2, desc: "PAGAMENTO FORNECEDOR 001", value: -8500, date: "28/10/2026" },
  { id: 3, desc: "PIX RECEBIDO VENDA 4821", value: 3200, date: "29/10/2026" },
  {
    id: 4,
    desc: "DEBITO AUTOMATICO SERVICO",
    value: -2400,
    date: "29/10/2026",
  },
  // Sem par no sistema: o usuário precisa decidir o que fazer
  {
    id: 5,
    desc: "TARIFA MANUT CONTA",
    value: -89.9,
    date: "30/10/2026",
    orphan: true,
  },
];
const SYSTEM: RecItem[] = [
  { id: 1, desc: "Recebimento Cliente Beta", value: 15000, date: "28/10/2026" },
  {
    id: 2,
    desc: "Pagamento Fornecedor Alpha",
    value: -8500,
    date: "28/10/2026",
  },
  { id: 3, desc: "Venda Produto #4821", value: 3200, date: "29/10/2026" },
  {
    id: 4,
    desc: "Assinatura Tech Solutions",
    value: -2400,
    date: "29/10/2026",
  },
];

function RecList({
  title,
  items,
  done,
  selected,
  onPick,
}: {
  title: string;
  items: RecItem[];
  done: Set<number>;
  selected?: number | null;
  onPick?: (id: number) => void;
}) {
  return (
    <div>
      <h3 className="fin-colhead">{title}</h3>
      <ul className="fin-list">
        {items.map((it) => {
          const matched = done.has(it.id);
          const body = (
            <>
              {it.desc}
              <span className="fin-item-row">
                <span className="fin-num">{it.date}</span>
                <span
                  className={`fin-num ${it.value > 0 ? "fin-in" : "fin-out"}`}
                >
                  {it.value > 0 ? "+" : ""}
                  {fmt(it.value)}
                </span>
              </span>
              {matched && <span className="fin-small">Conciliado</span>}
            </>
          );
          return (
            <li key={it.id}>
              {onPick ? (
                <button
                  className="fin-item"
                  aria-pressed={selected === it.id}
                  data-done={matched}
                  disabled={matched}
                  onClick={() => onPick(it.id)}
                >
                  {body}
                </button>
              ) : (
                <div className="fin-item" data-done={matched}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReconciliacaoDemo() {
  const [done, setDone] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const picked = BANK.find((b) => b.id === selected);

  return (
    <>
      <div className="fin-toolbar">
        <p className="fin-small">
          Escolha um lançamento do extrato e concilie com o do sistema. Um deles
          não tem par.
        </p>
        <button
          className="fin-link-btn"
          onClick={() => {
            setDone(new Set());
            setSelected(null);
          }}
        >
          Reiniciar
        </button>
      </div>

      {done.size === BANK.length && (
        <p className="fin-note" role="status">
          Conciliação completa: todos os lançamentos foram conferidos.
        </p>
      )}

      <div className="fin-cols">
        <RecList
          title="Extrato bancário"
          items={BANK}
          done={done}
          selected={selected}
          onPick={(id) => setSelected(selected === id ? null : id)}
        />
        <RecList title="Sistema" items={SYSTEM} done={done} />
      </div>

      {picked && (
        <>
          {picked.orphan && (
            <p className="fin-note fin-note-warn" role="status">
              Este lançamento do extrato não existe no sistema. Crie o
              lançamento da tarifa para conciliar.
            </p>
          )}
          <button
            className="fin-btn fin-btn-primary"
            onClick={() => {
              setDone(new Set(done).add(picked.id));
              setSelected(null);
            }}
          >
            {picked.orphan
              ? "Criar lançamento e conciliar"
              : "Conciliar lançamento selecionado"}
          </button>
        </>
      )}
    </>
  );
}

// ─── Centros de custo ─────────────────────────────────────────────────────────
interface CostNode {
  id: number;
  name: string;
  budget: number;
  used: number;
  children: { id: number; name: string; budget: number; used: number }[];
}

const COST_CENTERS: CostNode[] = [
  {
    id: 1,
    name: "Tecnologia",
    budget: 50000,
    used: 38500,
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
    children: [
      { id: 31, name: "Digital", budget: 18000, used: 14500 },
      { id: 32, name: "Eventos", budget: 12000, used: 6500 },
    ],
  },
];

function Meter({
  name,
  used,
  budget,
  bold,
}: {
  name: string;
  used: number;
  budget: number;
  bold?: boolean;
}) {
  const p = pct(used, budget);
  return (
    <>
      <div className="fin-node-top">
        <span className={bold ? "fin-node-name" : undefined}>{name}</span>
        <span className="fin-node-values fin-num">
          {fmt(used)} de {fmt(budget)} ·{" "}
          <span className={p >= 80 ? "fin-warn" : undefined}>
            {p}%{p >= 80 && " (atenção)"}
          </span>
        </span>
      </div>
      <div className="fin-meter" data-warn={p >= 80} aria-hidden="true">
        <i style={{ width: `${p}%` }} />
      </div>
    </>
  );
}

function CentrosCustoDemo() {
  const [open, setOpen] = useState<Set<number>>(new Set([1]));

  function toggle(id: number) {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  }

  return (
    <>
      <p className="fin-small">
        Orçamento anual por centro de custo. Clique para ver as subdivisões.
      </p>
      {COST_CENTERS.map((node) => (
        <div key={node.id}>
          <button
            className="fin-node"
            aria-expanded={open.has(node.id)}
            onClick={() => toggle(node.id)}
          >
            <Meter
              name={node.name}
              used={node.used}
              budget={node.budget}
              bold
            />
          </button>
          {open.has(node.id) && (
            <div className="fin-children">
              {node.children.map((c) => (
                <div key={c.id} className="fin-child">
                  <Meter name={c.name} used={c.used} budget={c.budget} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ─── Relatórios ───────────────────────────────────────────────────────────────
const REPORTS = [
  {
    id: "fluxo",
    name: "Fluxo de caixa",
    desc: "Entradas e saídas por período",
  },
  {
    id: "dre",
    name: "DRE gerencial",
    desc: "Resultado por caixa ou competência",
  },
  {
    id: "custos",
    name: "Centros de custo",
    desc: "Gastos por departamento ou projeto",
  },
  { id: "venc", name: "A vencer", desc: "Obrigações por data de vencimento" },
] as const;

// Prévia exibida na tela, no lugar do arquivo
const PREVIEW: Record<string, { head: string[]; rows: string[][] }> = {
  fluxo: {
    head: ["Semana", "Entradas", "Saídas", "Saldo"],
    rows: DASH.mes.slots.map((s, i) => [
      s,
      fmt(DASH.mes.receitas[i]),
      fmt(DASH.mes.despesas[i]),
      fmt(DASH.mes.receitas[i] - DASH.mes.despesas[i]),
    ]),
  },
  dre: {
    head: ["Outubro/2026", "Caixa", "Competência"],
    rows: [
      ["Receitas", fmt(41200), fmt(38750)],
      ["Despesas", fmt(29300), fmt(30100)],
      ["Resultado", fmt(11900), fmt(8650)],
    ],
  },
  custos: {
    head: ["Centro de custo", "Gasto", "Orçamento"],
    rows: COST_CENTERS.map((c) => [c.name, fmt(c.used), fmt(c.budget)]),
  },
  venc: {
    head: ["Vencimento", "Favorecido", "Valor"],
    rows: [
      ["05/11/2026", "Papelaria Central Ltda", fmt(2480)],
      ["06/11/2026", "Tech Solutions Ltda", fmt(2400)],
      ["09/11/2026", "Operadora Logística", fmt(3200)],
    ],
  },
};

function RelatoriosDemo() {
  const [selected, setSelected] = useState<string>("fluxo");
  const [format, setFormat] = useState<"pdf" | "excel" | "csv">("pdf");
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      setLoading(false);
      setShown(selected);
    }, 800);
    return () => clearTimeout(t);
  }, [loading, selected]);

  const preview = shown ? PREVIEW[shown] : null;

  return (
    <>
      <ul className="fin-list" aria-label="Relatórios">
        {REPORTS.map(({ id, name, desc }) => (
          <li key={id}>
            <button
              className="fin-item"
              aria-pressed={selected === id}
              onClick={() => {
                setSelected(id);
                setShown(null);
                setLoading(false);
              }}
            >
              <strong>{name}</strong>
              <span className="fin-cell-sub">{desc}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="fin-toolbar">
        <div className="fin-toolbar-group" role="group" aria-label="Formato">
          <span className="fin-small">Formato</span>
          {(["pdf", "excel", "csv"] as const).map((f) => (
            <button
              key={f}
              className="fin-chip"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className="fin-btn fin-btn-primary"
          disabled={loading}
          onClick={() => {
            setShown(null);
            setLoading(true);
          }}
        >
          {loading ? "Gerando..." : "Gerar relatório"}
        </button>
      </div>

      <div role="status" aria-live="polite">
        {preview && (
          <div className="fin-panel fin-scroll">
            <p className="fin-panel-head fin-small">
              Prévia na tela. Na versão real, o arquivo {format.toUpperCase()} é
              baixado.
            </p>
            <table className="fin-table">
              <thead>
                <tr>
                  {preview.head.map((h, i) => (
                    <th key={h} className={i > 0 ? "r" : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r[0]}>
                    {r.map((c, i) => (
                      <td key={i} className={i > 0 ? "r fin-num" : undefined}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Abas ─────────────────────────────────────────────────────────────────────
// A fila é a promessa do hero, então abre primeiro.
const TABS = [
  { id: "financeiro", label: "Financeiro", Component: FinanceiroDemo },
  { id: "reconcil", label: "Conciliação", Component: ReconciliacaoDemo },
  { id: "custos", label: "Centros de custo", Component: CentrosCustoDemo },
  { id: "relatorios", label: "Relatórios", Component: RelatoriosDemo },
  { id: "dashboard", label: "Dashboard", Component: DashboardDemo },
] as const;

export function DemoSection() {
  const [active, setActive] = useState(0);

  function onKeyDown(e: React.KeyboardEvent) {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + TABS.length) % TABS.length;
    setActive(next);
    document.getElementById(`demo-tab-${TABS[next].id}`)?.focus();
  }

  return (
    <section
      id="demonstracao"
      className="fin-section"
      aria-labelledby="demo-title"
    >
      <div className="fin-wrap">
        <h2 id="demo-title" className="fin-h2">
          Experimente antes de criar a conta
        </h2>
        <p className="fin-muted" style={{ marginTop: 12 }}>
          Dados fictícios. Nada do que você fizer aqui é salvo.
        </p>

        <div className="fin-demo">
          <div
            className="fin-demo-tabs"
            role="tablist"
            aria-label="Telas da demonstração"
            onKeyDown={onKeyDown}
          >
            {TABS.map((t, i) => (
              <button
                key={t.id}
                id={`demo-tab-${t.id}`}
                role="tab"
                className="fin-demo-tab"
                aria-selected={active === i}
                aria-controls={`demo-panel-${t.id}`}
                tabIndex={active === i ? 0 : -1}
                onClick={() => setActive(i)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Todos montados: trocar de aba não apaga o que o visitante fez */}
          {TABS.map((t, i) => (
            <div
              key={t.id}
              id={`demo-panel-${t.id}`}
              className="fin-demo-panel"
              role="tabpanel"
              aria-labelledby={`demo-tab-${t.id}`}
              hidden={active !== i}
            >
              <t.Component />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
