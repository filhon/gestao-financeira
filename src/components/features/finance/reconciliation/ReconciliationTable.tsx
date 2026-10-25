"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatCurrency, plural } from "@/lib/utils";
import { format } from "date-fns";
import currency from "currency.js";
import {
  Check,
  Plus,
  CheckCircle2,
  Zap,
  MinusCircle,
  Circle,
  Undo2,
  HandCoins,
  Lock,
  ListChecks,
  MoreHorizontal,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BankTransaction, ReconciliationRule, Transaction } from "@/lib/types";
import { dayKey, type DayGroup } from "@/lib/bankReconciliation";

export type ReconciliationAction =
  | "confirm"
  | "create"
  | "settle"
  | "ignore"
  | "ignoreAlways"
  | "unreconcile";

/** `arg`: o candidato escolhido em "confirm", o motivo em "ignore". */
export type ActionHandler = (
  id: string,
  action: ReconciliationAction,
  arg?: string,
) => void;

/** O que a linha deixa fazer: período fechado e linha da abertura não mudam. */
export type RowState = "editable" | "readonly" | "locked" | "before";

export const IGNORE_REASONS: {
  value: NonNullable<BankTransaction["ignoreReason"]>;
  label: string;
}[] = [
  { value: "transfer", label: "Transferência entre contas" },
  { value: "investment", label: "Aplicação ou resgate" },
  { value: "other", label: "Outro motivo" },
];

const signed = (amount: number) =>
  `${amount < 0 ? "−" : "+"}${formatCurrency(Math.abs(amount))}`;

const dmy = (d: Date) => format(new Date(d), "dd/MM/yyyy");

/** Como a regra resolve a linha, para a coluna "No sistema" e o card mobile. */
export function RuleNote({ rule }: { rule?: ReconciliationRule }) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-sm">
      <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <span className="block truncate font-medium">
          {!rule
            ? "Regra excluída"
            : rule.action === "ignore" || !rule.template
              ? "Ignorar"
              : `Lançar “${rule.template.description}”`}
        </span>
        {rule && (
          <span className="block truncate text-xs text-muted-foreground">
            Regra &ldquo;{rule.pattern}&rdquo;
          </span>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: BankTransaction["status"] }) {
  switch (status) {
    case "matched":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-3 w-3" />
          Conciliado
        </Badge>
      );
    case "potential_match":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          <Zap className="h-3 w-3" />
          Sugestão
        </Badge>
      );
    case "ignored":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <MinusCircle className="h-3 w-3" />
          Ignorado
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <Circle className="h-3 w-3" />
          Pendente
        </Badge>
      );
  }
}

/**
 * Lançamento do sistema numa linha só: a altura da tabela fica constante.
 * Data e valor em colunas fixas, para alinharem de uma linha para a outra.
 */
function SystemLine({
  t,
  note,
}: {
  t: Pick<Transaction, "description" | "dueDate" | "paymentDate" | "amount">;
  note?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 md:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem]">
      <span className="truncate text-sm font-medium" title={t.description}>
        {t.description || "Sem descrição"}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {t.paymentDate
          ? `pago ${dmy(t.paymentDate)}`
          : `venc. ${dmy(t.dueDate)}`}
      </span>
      <span className="text-right text-xs text-muted-foreground font-financial tabular-nums">
        {formatCurrency(t.amount)}
      </span>
      {note && (
        <div className="col-span-3 truncate text-xs text-muted-foreground">
          {note}
        </div>
      )}
    </div>
  );
}

const RESOLUTION_NOTE: Record<
  NonNullable<BankTransaction["resolution"]>,
  string
> = {
  launched: "Lançado a partir desta linha",
  settled: "Título baixado por esta linha",
};

/** Coluna "No sistema": o que a linha casou, sugeriu ou por que foi ignorada. */
export function SystemCell({
  tx,
  rule,
  editable,
  onAction,
}: {
  tx: BankTransaction;
  rule?: ReconciliationRule;
  editable: boolean;
  onAction: ActionHandler;
}) {
  if (tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {tx.matchedTransactionIds.length} lançamentos somados
        </span>
        {tx.matchedBundleDetails?.map((sub, i) => (
          <div
            key={sub.id || i}
            className="flex justify-between gap-2 text-xs text-muted-foreground"
          >
            <span className="truncate" title={sub.description}>
              {sub.description}
            </span>
            <span className="whitespace-nowrap font-financial tabular-nums">
              {formatCurrency(sub.amount)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (tx.matchedDetails) {
    const note =
      tx.status === "potential_match" && tx.confidence
        ? `${tx.confidence}% de semelhança${tx.confidence >= 90 ? " · sugestão forte" : ""}`
        : tx.resolution && RESOLUTION_NOTE[tx.resolution];
    return <SystemLine t={tx.matchedDetails} note={note} />;
  }
  if (tx.ruleId) return <RuleNote rule={rule} />;
  if (tx.status === "ignored") {
    return (
      <span className="text-sm text-muted-foreground">
        {IGNORE_REASONS.find((r) => r.value === tx.ignoreReason)?.label ??
          "Sem lançamento"}
      </span>
    );
  }
  if (tx.matchedTransactionId) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        ID {tx.matchedTransactionId.slice(0, 8)}
      </span>
    );
  }
  if (tx.matchCandidates && tx.matchCandidates.length > 0) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs text-muted-foreground">
          {plural(
            tx.matchCandidates.length,
            "candidato fraco",
            "candidatos fracos",
          )}
        </span>
        {tx.matchCandidates.map((c, i) => (
          <div key={`${c.id}-${i}`} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SystemLine
                t={c.transaction}
                note={[`${c.score}%`, ...c.reasons].join(" · ")}
              />
            </div>
            {editable && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => onAction(tx.id, "confirm", c.id)}
              >
                Usar este
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-sm text-muted-foreground">—</span>;
}

/**
 * Ações de uma linha: a principal à vista, o resto no menu. Dezesseis linhas
 * com três botões cada eram uma parede que competia com os valores.
 */
export function RowActions({
  tx,
  state,
  canSettle,
  canLaunch,
  canRule,
  onAction,
  menuOpen,
  onMenuOpenChange,
}: {
  tx: BankTransaction;
  state: RowState;
  canSettle: boolean;
  canLaunch: boolean;
  canRule: boolean;
  onAction: ActionHandler;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
}) {
  if (state === "locked") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title="Período fechado"
      >
        <Lock className="h-3.5 w-3.5" /> Fechado
      </span>
    );
  }
  if (state === "before") {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Já está dentro do saldo inicial"
      >
        Antes da abertura
      </span>
    );
  }
  if (state === "readonly") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  // Leitor de tela ouve de qual linha é o botão, não dezesseis "Ignorar".
  const who = `${tx.description}, ${signed(tx.amount)}`;

  if (tx.status === "matched" || tx.status === "ignored") {
    const label = tx.status === "ignored" ? "Voltar para pendente" : "Desfazer";
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-xs text-muted-foreground"
        onClick={() => onAction(tx.id, "unreconcile")}
        aria-label={`${label}: ${who}`}
      >
        <Undo2 className="h-3.5 w-3.5" />
        {label}
      </Button>
    );
  }

  const primary =
    tx.status === "potential_match"
      ? { label: "Confirmar", Icon: Check, action: "confirm" as const }
      : canSettle
        ? { label: "Baixar título", Icon: HandCoins, action: "settle" as const }
        : canLaunch
          ? { label: "Lançar", Icon: Plus, action: "create" as const }
          : null;
  const launchInMenu =
    tx.status === "unmatched" && canLaunch && primary?.action !== "create";

  return (
    <div className="flex justify-end gap-1">
      {primary && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => onAction(tx.id, primary.action)}
          aria-label={`${primary.label}: ${who}`}
        >
          <primary.Icon className="h-3.5 w-3.5" />
          {primary.label}
        </Button>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground"
            aria-label={`Mais ações: ${who}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {launchInMenu && (
            <>
              <DropdownMenuItem onSelect={() => onAction(tx.id, "create")}>
                <Plus className="h-4 w-4" />
                Lançar direto, já pago
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Ignorar: não pede lançamento
          </DropdownMenuLabel>
          {IGNORE_REASONS.map((r) => (
            <DropdownMenuItem
              key={r.value}
              onSelect={() => onAction(tx.id, "ignore", r.value)}
            >
              {r.label}
            </DropdownMenuItem>
          ))}
          {canRule && !tx.ruleId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onAction(tx.id, "ignoreAlways")}
              >
                <ListChecks className="h-4 w-4" />
                Sempre ignorar linhas como esta
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** O que falta no dia, ou por que ele está resolvido. */
function DayVerdict({ group }: { group: DayGroup }) {
  const { balance } = group;
  if (group.pending > 0) {
    return (
      <span className="font-medium text-foreground">
        {plural(group.pending, "pendente", "pendentes")}
      </span>
    );
  }
  if (balance && balance.computed !== null && !balance.matches) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Nenhum saldo do banco bate com o calculado:{" "}
        <span className="font-financial tabular-nums">
          {formatCurrency(balance.computed)}
        </span>
      </span>
    );
  }
  if (group.locked) {
    return (
      <span className="inline-flex items-center gap-1">
        <Lock className="h-3.5 w-3.5" />
        Período fechado
      </span>
    );
  }
  if (balance?.computed === null) return <span>Dentro do saldo inicial</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        balance?.matches && "text-emerald-700 dark:text-emerald-400",
      )}
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {balance?.matches ? "Confere com o sistema" : "Tudo tratado"}
    </span>
  );
}

/**
 * Cabeçalho do dia: abre e recolhe, mostra os saldos que o banco informou e o
 * veredito. O banco manda vários saldos (com aplicação, disponível, da conta);
 * o que bate com o sistema leva o ✓, para ficar claro qual deles é o da conta.
 */
function DayHeaderRow({
  group,
  cols,
  collapsed,
  onToggle,
}: {
  group: DayGroup;
  cols: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { balance } = group;
  const hit = (amount: number) =>
    !!balance &&
    balance.computed !== null &&
    currency(amount).value === balance.computed;
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell
        colSpan={cols}
        className="py-1.5 text-xs text-muted-foreground"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {group.total > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
                  !collapsed && "rotate-90",
                )}
              />
              <span className="tabular-nums">{dmy(group.date)}</span>
              <span className="font-normal text-muted-foreground">
                · {plural(group.total, "linha", "linhas")}
              </span>
            </button>
          ) : (
            <span className="pl-[18px] font-medium text-foreground">
              <span className="tabular-nums">{dmy(group.date)}</span>
              <span className="font-normal text-muted-foreground">
                {" "}
                · sem movimento
              </span>
            </span>
          )}
          {balance && balance.lines.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Banco:</span>
              {balance.lines.map((l) => (
                <span
                  key={l.id}
                  className={cn(
                    "inline-flex items-center gap-1",
                    hit(l.amount) &&
                      "font-medium text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {hit(l.amount) && (
                    <CheckCircle2
                      className="h-3.5 w-3.5"
                      aria-label="confere com o sistema"
                    />
                  )}
                  {l.description}{" "}
                  <span className="font-financial tabular-nums">
                    {formatCurrency(l.amount)}
                  </span>
                </span>
              ))}
            </span>
          )}
          <span className="ml-auto">
            <DayVerdict group={group} />
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

interface ReconciliationTableProps {
  transactions: BankTransaction[];
  /** Dias do extrato, com a conferência de saldo; as linhas entram dentro deles. */
  days: DayGroup[];
  /** Dias recolhidos: só o cabeçalho aparece. */
  collapsedDays: Set<string>;
  onToggleDay: (group: DayGroup) => void;
  /** Sem filtro, dia sem linha à vista (só saldo) também aparece. */
  showEmptyDays: boolean;
  onAction: ActionHandler;
  rowState: (tx: BankTransaction) => RowState;
  canSettle: (tx: BankTransaction) => boolean;
  canLaunch: (tx: BankTransaction) => boolean;
  canRule: boolean;
  ruleFor: (tx: BankTransaction) => ReconciliationRule | undefined;
  isSelectable: (tx: BankTransaction) => boolean;
  selected: Set<string>;
  onSelectedChange?: (ids: Set<string>) => void;
  activeId: string | null;
  onActiveChange: (id: string) => void;
  menuOpenId: string | null;
  onMenuOpenChange: (id: string | null) => void;
  onClearFilters: () => void;
  /** Texto da tabela vazia quando não é culpa dos filtros (tudo já fechado). */
  emptyState?: React.ReactNode;
}

export function ReconciliationTable({
  transactions,
  days,
  collapsedDays,
  onToggleDay,
  showEmptyDays,
  onAction,
  rowState,
  canSettle,
  canLaunch,
  canRule,
  ruleFor,
  isSelectable,
  selected,
  onSelectedChange,
  activeId,
  onActiveChange,
  menuOpenId,
  onMenuOpenChange,
  onClearFilters,
  emptyState,
}: ReconciliationTableProps) {
  const selectable = onSelectedChange ? transactions.filter(isSelectable) : [];
  // Sem linha a tratar, a coluna de seleção só empurraria a data.
  const showSelect = !!onSelectedChange && selectable.length > 0;
  const allSelected =
    selectable.length > 0 && selectable.every((tx) => selected.has(tx.id));
  const someSelected = selectable.some((tx) => selected.has(tx.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange?.(next);
  };
  const cols = showSelect ? 7 : 6;

  // As linhas já vêm em ordem de data; cada dia leva as suas.
  const byDay = new Map<string, BankTransaction[]>();
  for (const tx of transactions) {
    const key = dayKey(tx.date);
    byDay.set(key, [...(byDay.get(key) ?? []), tx]);
  }
  const shownDays =
    transactions.length === 0
      ? []
      : days.filter((g) => byDay.has(g.day) || showEmptyDays);
  const firstId = shownDays
    .filter((g) => !collapsedDays.has(g.day))
    .flatMap((g) => byDay.get(g.day) ?? [])[0]?.id;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showSelect && (
            <TableHead className="w-10">
              <Checkbox
                checked={
                  allSelected ? true : someSelected ? "indeterminate" : false
                }
                onCheckedChange={(c) =>
                  onSelectedChange?.(
                    c ? new Set(selectable.map((tx) => tx.id)) : new Set(),
                  )
                }
                aria-label="Selecionar todas as linhas a tratar"
              />
            </TableHead>
          )}
          <TableHead className="w-[100px]">Data</TableHead>
          <TableHead className="w-[34%]">Descrição no banco</TableHead>
          <TableHead className="w-[130px] text-right">Valor</TableHead>
          <TableHead className="w-[120px]">Situação</TableHead>
          <TableHead>No sistema</TableHead>
          <TableHead className="w-px whitespace-nowrap text-right">
            Ações
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={cols}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              {emptyState ?? (
                <>
                  Nenhuma linha com os filtros selecionados.{" "}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={onClearFilters}
                  >
                    Limpar filtros
                  </Button>
                </>
              )}
            </TableCell>
          </TableRow>
        )}
        {shownDays.flatMap((group) => {
          const collapsed = collapsedDays.has(group.day);
          return [
            <DayHeaderRow
              key={group.day}
              group={group}
              cols={cols}
              collapsed={collapsed}
              onToggle={() => onToggleDay(group)}
            />,
            ...(collapsed ? [] : (byDay.get(group.day) ?? [])).map(renderRow),
          ];
        })}
      </TableBody>
    </Table>
  );

  function renderRow(tx: BankTransaction) {
    const state = rowState(tx);
    const editable = state === "editable";
    const active = activeId === tx.id;
    return (
      <TableRow
        key={tx.id}
        data-row-id={tx.id}
        // Tab entra pela linha ativa (ou a primeira); j/k e setas andam dentro.
        tabIndex={tx.id === (activeId ?? firstId) ? 0 : -1}
        onFocus={() => onActiveChange(tx.id)}
        className={cn(
          "outline-none",
          tx.status === "ignored" && "text-muted-foreground",
          active && "bg-muted/60 ring-2 ring-inset ring-primary",
        )}
        data-state={selected.has(tx.id) ? "selected" : undefined}
      >
        {showSelect && (
          <TableCell>
            {isSelectable(tx) && (
              <Checkbox
                checked={selected.has(tx.id)}
                onCheckedChange={(c) => toggle(tx.id, !!c)}
                aria-label={`Selecionar ${tx.description}, ${signed(tx.amount)}`}
              />
            )}
          </TableCell>
        )}
        <TableCell className="tabular-nums">{dmy(tx.date)}</TableCell>

        <TableCell className="max-w-0">
          <div className="truncate font-medium" title={tx.description}>
            {tx.description}
          </div>
        </TableCell>

        <TableCell
          className={cn(
            "text-right font-medium font-financial tabular-nums whitespace-nowrap",
            tx.status === "ignored"
              ? "text-muted-foreground"
              : tx.amount < 0
                ? "text-red-700 dark:text-red-400"
                : "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {signed(tx.amount)}
        </TableCell>
        <TableCell>
          <StatusBadge status={tx.status} />
        </TableCell>
        <TableCell className="max-w-0">
          <SystemCell
            tx={tx}
            rule={ruleFor(tx)}
            editable={editable}
            onAction={onAction}
          />
        </TableCell>
        <TableCell className="text-right">
          {/* Fechada: o cabeçalho do dia já diz; um cadeado por linha era ruído. */}
          <div
            className={cn("flex justify-end", state === "locked" && "sr-only")}
          >
            <RowActions
              tx={tx}
              state={state}
              canSettle={canSettle(tx)}
              canLaunch={canLaunch(tx)}
              canRule={canRule}
              onAction={onAction}
              menuOpen={menuOpenId === tx.id}
              onMenuOpenChange={(o) => onMenuOpenChange(o ? tx.id : null)}
            />
          </div>
        </TableCell>
      </TableRow>
    );
  }
}
