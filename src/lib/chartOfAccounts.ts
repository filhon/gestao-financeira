/**
 * Regras do plano de contas gerencial e montagem da DRE.
 *
 * Sem dependência de Firebase de propósito: o formulário de conta, a
 * importação por planilha e o relatório aplicam exatamente as mesmas regras, e
 * o script de verificação roda isto direto no Node.
 *
 * Convenções adotadas (plano estruturado, ITG 1000 / prática de mercado):
 * - o código é a hierarquia: "3.1.02" é filha de "3.1", que é filha de "3";
 * - conta sintética agrupa e totaliza, só a analítica recebe lançamento;
 * - a natureza (receita/despesa) é a mesma em toda a subárvore;
 * - toda analítica aponta para uma linha da DRE gerencial.
 */
import currency from "currency.js";
import { eachMonthOfInterval, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  AccountNature,
  AccountType,
  ChartAccount,
  DreGroup,
  Transaction,
} from "@/lib/types";

// ─── Rótulos ──────────────────────────────────────────────────────────────────

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  synthetic: "Sintética",
  analytic: "Analítica",
};

export const ACCOUNT_NATURE_LABEL: Record<AccountNature, string> = {
  revenue: "Receita",
  expense: "Despesa",
};

interface DreGroupInfo {
  value: DreGroup;
  label: string;
  /** `null`: aceita as duas naturezas (entrada e saída do mesmo tipo). */
  nature: AccountNature | null;
  hint: string;
}

/** Na ordem em que aparecem na DRE. */
export const DRE_GROUPS: DreGroupInfo[] = [
  {
    value: "gross_revenue",
    label: "Receita bruta",
    nature: "revenue",
    hint: "Vendas, serviços, contribuições, doações e demais receitas da atividade principal.",
  },
  {
    value: "revenue_deductions",
    label: "Deduções da receita",
    nature: "expense",
    hint: "Impostos sobre vendas, devoluções e descontos concedidos.",
  },
  {
    value: "direct_costs",
    label: "Custos",
    nature: "expense",
    hint: "Custo das mercadorias, produtos e serviços, ou das atividades-fim e projetos.",
  },
  {
    value: "operating_expenses",
    label: "Despesas operacionais",
    nature: "expense",
    hint: "Pessoal, administrativas, comerciais e tributárias.",
  },
  {
    value: "financial_revenue",
    label: "Receitas financeiras",
    nature: "revenue",
    hint: "Rendimentos de aplicações, juros e descontos obtidos.",
  },
  {
    value: "financial_expenses",
    label: "Despesas financeiras",
    nature: "expense",
    hint: "Tarifas bancárias, juros, multas e IOF.",
  },
  {
    value: "other_revenue",
    label: "Outras receitas",
    nature: "revenue",
    hint: "Receitas eventuais, fora da atividade principal.",
  },
  {
    value: "other_expenses",
    label: "Outras despesas",
    nature: "expense",
    hint: "Perdas, indenizações e despesas eventuais.",
  },
  {
    value: "income_taxes",
    label: "Tributos sobre o resultado",
    nature: "expense",
    hint: "IRPJ e CSLL.",
  },
  {
    value: "investments",
    label: "Investimentos",
    nature: null,
    hint: "Compra e venda de imobilizado: obras, equipamentos, veículos. Fica fora do resultado.",
  },
  {
    value: "financing",
    label: "Financiamentos e movimentações patrimoniais",
    nature: null,
    hint: "Empréstimos, aportes, distribuição de lucros e transferências. Fica fora do resultado.",
  },
];

export const DRE_GROUP_LABEL = Object.fromEntries(
  DRE_GROUPS.map((g) => [g.value, g.label]),
) as Record<DreGroup, string>;

export const groupFitsNature = (group: DreGroup, nature: AccountNature) => {
  const n = DRE_GROUPS.find((g) => g.value === group)?.nature;
  return n === null || n === nature;
};

/** A conta é obrigatória quando o vencimento cai no exercício de início ou depois. */
export const accountRequiredFor = (
  requiredFrom: number | null,
  dueDate: Date | undefined,
) => !!requiredFrom && !!dueDate && dueDate.getFullYear() >= requiredFrom;

// ─── Código ───────────────────────────────────────────────────────────────────

const CODE_RE = /^\d+(\.\d+)*$/;

/** "3.1.02." → "3.1.02"; espaços fora. */
export const normalizeCode = (raw: unknown) =>
  String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/\.+$/, "");

export const isValidCode = (code: string) => CODE_RE.test(code);

export const parentCodeOf = (code: string) => {
  const i = code.lastIndexOf(".");
  return i === -1 ? null : code.slice(0, i);
};

export const depthOf = (code: string) => code.split(".").length - 1;

/** Ordem natural por segmento: "1.2" < "1.10". */
export function compareCodes(a: string, b: string) {
  const sa = a.split(".");
  const sb = b.split(".");
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const d = Number(sa[i]) - Number(sb[i]);
    if (d !== 0) return d;
    if (sa[i] !== sb[i]) return sa[i].localeCompare(sb[i]);
  }
  return sa.length - sb.length;
}

/**
 * Próximo código livre abaixo de `parentCode`, no padrão dos irmãos.
 * Primeiro filho de nível 1 vira "x.1"; dali para baixo, dois dígitos ("x.y.01").
 */
export function nextChildCode(
  accounts: { code: string }[],
  parentCode: string | null,
) {
  const siblings = accounts
    .map((a) => a.code)
    .filter((c) => parentCodeOf(c) === parentCode);
  const last = siblings.sort(compareCodes).at(-1);
  if (!parentCode) return String(last ? Number(last) + 1 : 1);
  if (!last) {
    return `${parentCode}.${depthOf(parentCode) >= 1 ? "01" : "1"}`;
  }
  const seg = last.slice(last.lastIndexOf(".") + 1);
  return `${parentCode}.${String(Number(seg) + 1).padStart(seg.length, "0")}`;
}

// ─── Leitura de valores de planilha ───────────────────────────────────────────

const norm = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const TYPE_ALIASES: Record<string, AccountType> = {
  s: "synthetic",
  sintetica: "synthetic",
  sintetico: "synthetic",
  agrupadora: "synthetic",
  totalizadora: "synthetic",
  synthetic: "synthetic",
  a: "analytic",
  analitica: "analytic",
  analitico: "analytic",
  analytic: "analytic",
};

const NATURE_ALIASES: Record<string, AccountNature> = {
  r: "revenue",
  receita: "revenue",
  receitas: "revenue",
  entrada: "revenue",
  credora: "revenue",
  c: "revenue",
  revenue: "revenue",
  d: "expense",
  despesa: "expense",
  despesas: "expense",
  saida: "expense",
  devedora: "expense",
  custo: "expense",
  expense: "expense",
};

const GROUP_ALIASES: Record<string, DreGroup> = Object.fromEntries([
  ...DRE_GROUPS.flatMap((g) => [
    [norm(g.label), g.value],
    [g.value, g.value],
  ]),
  ["receita operacional", "gross_revenue"],
  ["receita operacional bruta", "gross_revenue"],
  ["deducoes", "revenue_deductions"],
  ["custo", "direct_costs"],
  ["custos diretos", "direct_costs"],
  ["despesas", "operating_expenses"],
  ["despesas administrativas", "operating_expenses"],
  ["tributos", "income_taxes"],
  ["investimento", "investments"],
  ["financiamentos", "financing"],
  ["movimentacoes patrimoniais", "financing"],
]);

/** `undefined` = célula vazia; `null` = valor que não reconhecemos. */
const parseWith =
  <T>(aliases: Record<string, T>) =>
  (raw: unknown): T | undefined | null => {
    const v = norm(raw);
    if (!v) return undefined;
    return aliases[v] ?? null;
  };

export const parseAccountType = parseWith(TYPE_ALIASES);
export const parseAccountNature = parseWith(NATURE_ALIASES);
export const parseDreGroup = parseWith(GROUP_ALIASES);

// ─── Validação do plano ───────────────────────────────────────────────────────

/** Conta como vem do formulário ou da planilha: tipo, natureza e grupo podem ser herdados. */
export interface AccountDraft {
  code: string;
  name: string;
  type?: AccountType;
  nature?: AccountNature;
  dreGroup?: DreGroup;
  description?: string;
  archived?: boolean;
  /** Linha da planilha, para apontar o erro. */
  line?: number;
}

export interface ResolvedAccount extends AccountDraft {
  type: AccountType;
  nature: AccountNature;
}

export interface PlanIssue {
  line?: number;
  code?: string;
  message: string;
}

/**
 * Completa o que é herdável e confere o plano inteiro.
 *
 * Tipo vazio vira sintética se a conta tem filhas e analítica se não tem;
 * natureza vazia vem da conta superior; grupo da DRE vazio vem do ancestral
 * mais próximo que tenha um. Só a analítica grava o grupo herdado — na
 * sintética ele é opcional e serve só para exibição.
 *
 * Valida sempre o plano completo (não a conta isolada) porque as regras são
 * entre contas: pai existente, pai sintético, natureza igual à do pai.
 */
export function resolvePlan(drafts: AccountDraft[]): {
  accounts: ResolvedAccount[];
  issues: PlanIssue[];
} {
  const issues: PlanIssue[] = [];
  const issue = (d: AccountDraft, message: string) =>
    issues.push({ line: d.line, code: d.code, message });

  const byCode = new Map<string, AccountDraft>();
  for (const d of drafts) {
    if (!d.code) {
      issue(d, "Código vazio.");
      continue;
    }
    if (!isValidCode(d.code)) {
      issue(
        d,
        `Código "${d.code}" inválido: use números separados por ponto, como 3.1.02.`,
      );
      continue;
    }
    if (byCode.has(d.code)) {
      issue(d, `Código ${d.code} repetido.`);
      continue;
    }
    if (!d.name?.trim()) issue(d, `Conta ${d.code} sem nome.`);
    else if (d.name.trim().length > 120)
      issue(d, `Nome da conta ${d.code} passa de 120 caracteres.`);
    byCode.set(d.code, d);
  }

  const hasChildren = new Set(
    [...byCode.keys()].map(parentCodeOf).filter((c): c is string => !!c),
  );

  // Pais antes dos filhos: herança resolvida numa passada só.
  const ordered = [...byCode.values()].sort((a, b) =>
    compareCodes(a.code, b.code),
  );
  const resolved = new Map<string, ResolvedAccount>();
  const effectiveGroup = new Map<string, DreGroup | undefined>();

  for (const d of ordered) {
    const parentCode = parentCodeOf(d.code);
    const parent = parentCode ? resolved.get(parentCode) : undefined;

    if (parentCode && !byCode.has(parentCode)) {
      issue(d, `Conta superior ${parentCode} não existe no plano.`);
    } else if (parent?.type === "analytic") {
      issue(
        d,
        `${parentCode} é analítica e não pode ter subcontas. Marque-a como sintética.`,
      );
    }

    const type: AccountType =
      d.type ?? (hasChildren.has(d.code) ? "synthetic" : "analytic");

    const nature = d.nature ?? parent?.nature;
    if (!nature) {
      issue(d, `Informe a natureza (Receita ou Despesa) de ${d.code}.`);
      continue;
    }
    if (parent && d.nature && d.nature !== parent.nature) {
      issue(
        d,
        `${d.code} é ${ACCOUNT_NATURE_LABEL[d.nature].toLowerCase()}, mas a conta superior ` +
          `${parent.code} é ${ACCOUNT_NATURE_LABEL[parent.nature].toLowerCase()}. ` +
          "Toda a subárvore tem a mesma natureza.",
      );
    }

    const group =
      d.dreGroup ?? (parentCode ? effectiveGroup.get(parentCode) : undefined);
    effectiveGroup.set(d.code, group);

    if (d.dreGroup && !groupFitsNature(d.dreGroup, nature)) {
      issue(
        d,
        `Grupo "${DRE_GROUP_LABEL[d.dreGroup]}" não combina com natureza ` +
          `${ACCOUNT_NATURE_LABEL[nature].toLowerCase()} (${d.code}).`,
      );
    }
    if (type === "analytic" && !group) {
      issue(d, `Informe o grupo da DRE da conta analítica ${d.code}.`);
    }

    resolved.set(d.code, {
      ...d,
      name: d.name?.trim() ?? "",
      type,
      nature,
      dreGroup: type === "analytic" ? group : d.dreGroup,
    });
  }

  return { accounts: [...resolved.values()], issues };
}

// ─── Árvore para telas ────────────────────────────────────────────────────────

export type AccountWithLevel<T extends { code: string }> = T & {
  level: number;
};

/** Ordenado por código, com o nível de indentação de cada conta. */
export const withLevels = <T extends { code: string }>(
  accounts: T[],
): AccountWithLevel<T>[] =>
  [...accounts]
    .sort((a, b) => compareCodes(a.code, b.code))
    .map((a) => ({ ...a, level: depthOf(a.code) }));

/**
 * Grupo da DRE efetivo de um código: o próprio ou o do ancestral mais
 * próximo. Sintética guarda o grupo só quando foi declarado.
 */
export function groupResolver(
  accounts: { code: string; dreGroup?: DreGroup }[],
) {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const groupOf = (code: string | null): DreGroup | undefined =>
    code
      ? (byCode.get(code)?.dreGroup ?? groupOf(parentCodeOf(code)))
      : undefined;
  return groupOf;
}

/** Rótulo curto padrão: "3.1.02 · Energia elétrica". */
export const accountLabel = (a: { code: string; name: string }) =>
  `${a.code} · ${a.name}`;

// ─── DRE ──────────────────────────────────────────────────────────────────────

export interface DreColumn {
  key: string; // yyyy-MM
  label: string; // "jan/27"
}

export interface DreRow {
  kind: "group" | "account" | "subtotal" | "result" | "heading" | "info";
  label: string;
  code?: string;
  /** Indentação dentro do grupo (só contas). */
  level: number;
  values: number[];
  total: number;
}

export interface DreReport {
  columns: DreColumn[];
  rows: DreRow[];
  /** Receita líquida do período — base da análise vertical. */
  base: number;
  unclassifiedCount: number;
}

type DreTx = Pick<
  Transaction,
  | "type"
  | "status"
  | "amount"
  | "finalAmount"
  | "accountId"
  | "costCenterAllocation"
  | "dueDate"
  | "paymentDate"
>;

const isSettled = (t: DreTx) =>
  (t.status === "paid" || t.status === "received") && !!t.paymentDate;

/** Data efetiva — a mesma dos demais relatórios: pagamento se pago, senão vencimento. */
export const effectiveDate = (t: DreTx) =>
  isSettled(t) ? (t.paymentDate as Date) : t.dueDate;

/**
 * Valor da conta no relatório. Com filtro de centro de custo, só a parcela do
 * rateio daquele centro, proporcional ao valor final.
 */
export function dreAmount(t: DreTx, costCenterId?: string) {
  const full = t.finalAmount ?? t.amount;
  if (!costCenterId) return full;
  const share = (t.costCenterAllocation ?? [])
    .filter((a) => a.costCenterId === costCenterId)
    .reduce((s, a) => s.add(a.amount), currency(0)).value;
  if (!t.amount) return 0;
  return currency(full).multiply(share).divide(t.amount).value;
}

const SECTIONS: Array<
  | { group: DreGroup; label: string }
  | { subtotal: string }
  | { result: string; outside?: boolean }
  | { heading: string }
> = [
  { group: "gross_revenue", label: "Receita Bruta" },
  { group: "revenue_deductions", label: "(−) Deduções da Receita" },
  { subtotal: "Receita Líquida" },
  { group: "direct_costs", label: "(−) Custos" },
  { subtotal: "Resultado Bruto" },
  { group: "operating_expenses", label: "(−) Despesas Operacionais" },
  { subtotal: "Resultado Operacional" },
  { group: "financial_revenue", label: "(+) Receitas Financeiras" },
  { group: "financial_expenses", label: "(−) Despesas Financeiras" },
  { group: "other_revenue", label: "(+) Outras Receitas" },
  { group: "other_expenses", label: "(−) Outras Despesas" },
  { subtotal: "Resultado Antes dos Tributos sobre o Resultado" },
  { group: "income_taxes", label: "(−) Tributos sobre o Resultado" },
  { result: "Resultado Líquido do Período (Superávit / Déficit)" },
  { heading: "Movimentações fora do resultado" },
  { group: "investments", label: "(±) Investimentos" },
  {
    group: "financing",
    label: "(±) Financiamentos e Movimentações Patrimoniais",
  },
  { result: "Resultado após Investimentos e Financiamentos", outside: true },
];

/**
 * DRE gerencial do período, mês a mês.
 *
 * Valores com sinal: entrada positiva, saída negativa, então todo subtotal é
 * a soma acumulada do que veio acima. Rejeitadas ficam fora. Lançamento sem
 * conta (ou com conta excluída/sintética) não some: vai para "sem conta
 * contábil" no fim, e a última linha fecha com o total do período.
 */
export function buildDre(
  transactions: DreTx[],
  accounts: ChartAccount[],
  opts: { start: Date; end: Date; costCenterId?: string },
): DreReport {
  const columns: DreColumn[] = eachMonthOfInterval({
    start: opts.start,
    end: opts.end,
  }).map((d) => ({
    key: format(d, "yyyy-MM"),
    label: format(d, "MMM/yy", { locale: ptBR }),
  }));
  const colIndex = new Map(columns.map((c, i) => [c.key, i]));
  const zero = () => columns.map(() => 0);
  const add = (into: number[], from: number[]) =>
    from.forEach((v, i) => (into[i] = currency(into[i]).add(v).value));
  const sum = (vs: number[]) =>
    vs.reduce((s, v) => s.add(v), currency(0)).value;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  // Na DRE vale o grupo herdado, senão "4.2 Administrativas" (sem grupo
  // declarado) sumiria entre "4" e as filhas.
  const groupOf = groupResolver(accounts);

  const perAccount = new Map<string, number[]>();
  const unclassified = { revenue: zero(), expense: zero() };
  let unclassifiedCount = 0;

  for (const t of transactions) {
    if (t.status === "rejected") continue;
    const col = colIndex.get(format(effectiveDate(t), "yyyy-MM"));
    if (col === undefined) continue;
    const raw = dreAmount(t, opts.costCenterId);
    if (!raw) continue;
    const signed = t.type === "receivable" ? raw : -raw;

    const account = t.accountId ? byId.get(t.accountId) : undefined;
    if (!account || account.type !== "analytic" || !account.dreGroup) {
      const bucket =
        t.type === "receivable" ? unclassified.revenue : unclassified.expense;
      bucket[col] = currency(bucket[col]).add(signed).value;
      unclassifiedCount++;
      continue;
    }
    const vals = perAccount.get(account.id) ?? zero();
    vals[col] = currency(vals[col]).add(signed).value;
    perAccount.set(account.id, vals);
  }

  const groupsInPlan = new Set(accounts.map((a) => a.dreGroup).filter(Boolean));
  const hasOutside =
    groupsInPlan.has("investments") || groupsInPlan.has("financing");
  const rows: DreRow[] = [];
  const running = zero();
  let groupsShown = 0;
  let base: number | null = null;

  const pushTotal = (kind: "subtotal" | "result", label: string) => {
    if (groupsShown === 0) return;
    rows.push({
      kind,
      label,
      level: 0,
      values: [...running],
      total: sum(running),
    });
  };

  for (const s of SECTIONS) {
    if ("heading" in s) {
      if (hasOutside) {
        rows.push({
          kind: "heading",
          label: s.heading,
          level: 0,
          values: zero(),
          total: 0,
        });
      }
      continue;
    }
    if ("subtotal" in s) {
      // A primeira subtotalização é a receita líquida: base da análise vertical.
      base ??= sum(running);
      pushTotal("subtotal", s.subtotal);
      continue;
    }
    if ("result" in s) {
      if (!s.outside || hasOutside) pushTotal("result", s.result);
      continue;
    }

    // Contas analíticas com valor neste grupo, mais os ancestrais sintéticos
    // que pertencem ao mesmo grupo (sintética sem grupo, ou de outro, não
    // aparece — "1 Receitas" não deve listar só metade das filhas).
    const analytic = accounts.filter(
      (a) =>
        a.dreGroup === s.group && a.type === "analytic" && perAccount.has(a.id),
    );
    const groupValues = zero();
    analytic.forEach((a) => add(groupValues, perAccount.get(a.id)!));
    if (!groupsInPlan.has(s.group) && analytic.length === 0) continue;

    groupsShown++;
    rows.push({
      kind: "group",
      label: s.label,
      level: 0,
      values: groupValues,
      total: sum(groupValues),
    });
    add(running, groupValues);

    const shown = new Map<string, number[]>();
    for (const a of analytic) {
      const vals = perAccount.get(a.id)!;
      shown.set(a.code, [...vals]);
      for (let p = parentCodeOf(a.code); p; p = parentCodeOf(p)) {
        if (!byCode.has(p) || groupOf(p) !== s.group) continue;
        const acc = shown.get(p) ?? zero();
        add(acc, vals);
        shown.set(p, acc);
      }
    }
    const codes = [...shown.keys()].sort(compareCodes);
    for (const code of codes) {
      const a = byCode.get(code)!;
      let level = 1;
      for (let p = parentCodeOf(code); p; p = parentCodeOf(p)) {
        if (shown.has(p)) level++;
      }
      const values = shown.get(code)!;
      rows.push({
        kind: "account",
        label: a.name,
        code,
        level,
        values,
        total: sum(values),
      });
    }
  }

  if (unclassifiedCount > 0) {
    rows.push({
      kind: "heading",
      label: "Lançamentos sem conta contábil",
      level: 0,
      values: zero(),
      total: 0,
    });
    for (const [label, vals] of [
      ["Receitas sem conta", unclassified.revenue],
      ["Despesas sem conta", unclassified.expense],
    ] as const) {
      if (vals.some((v) => v !== 0)) {
        rows.push({
          kind: "info",
          label,
          level: 1,
          values: vals,
          total: sum(vals),
        });
        add(running, vals);
      }
    }
    pushTotal("result", "Total do Período (inclui lançamentos sem conta)");
  }

  return { columns, rows, base: base ?? 0, unclassifiedCount };
}
