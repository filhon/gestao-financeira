"use client";

import { format } from "date-fns";
import currency from "currency.js";
import { BankAccount } from "@/lib/types";
import {
  isInvestment,
  lastClosing,
  summarizeAccount,
} from "@/lib/bankReconciliation";
import { cn, formatCurrency, plural } from "@/lib/utils";

type Summary = ReturnType<typeof summarizeAccount>;

// Mesmas colunas no cabeçalho e nas linhas, para alinhar sem tabela.
const grid =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 px-4 md:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem_12rem]";

/**
 * Todas as contas numa olhada: até quando cada uma está conciliada, o saldo
 * que o banco mostra e o que falta. Contas correntes e aplicações em grupos;
 * o total responde se "conta + aplicações" bate com o banco.
 */
export function AccountStrip({
  accounts,
  summaries,
  activeId,
  onSelect,
}: {
  accounts: BankAccount[];
  summaries: Map<string, Summary>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const groups = [
    {
      label: "Contas correntes",
      items: accounts.filter((a) => !isInvestment(a)),
    },
    { label: "Aplicações", items: accounts.filter(isInvestment) },
  ].filter((g) => g.items.length > 0);
  const all = accounts.map((a) => summaries.get(a.id));
  // Total só quando todas informaram saldo: somar parte daria um número falso.
  const complete = all.every((s) => s?.statementBalance != null);
  const sum = (pick: (s: Summary) => number | null) =>
    all.reduce((t, s) => t.add((s && pick(s)) ?? 0), currency(0)).value;

  return (
    <nav aria-label="Contas bancárias" className="rounded-lg border bg-card">
      <div
        className={cn(
          grid,
          "hidden border-b py-2 text-xs font-medium text-muted-foreground md:grid",
        )}
      >
        <span>Conta</span>
        <span>Conciliada até</span>
        <span className="text-right">Pendentes</span>
        <span className="text-right">Saldo no banco</span>
        <span className="text-right">Diferença</span>
      </div>
      {groups.map((g) => (
        <div key={g.label}>
          {groups.length > 1 && (
            <p className="border-b bg-muted/30 px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {g.label}
            </p>
          )}
          <ul className="divide-y border-b last:border-b-0">
            {g.items.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                summary={summaries.get(a.id)}
                active={a.id === activeId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
      {groups.length > 1 && (
        <div
          className={cn(
            grid,
            "hidden border-t py-2 text-sm font-medium md:grid",
          )}
        >
          <span>Total</span>
          <span />
          <span className="text-right tabular-nums text-muted-foreground">
            {plural(
              sum((s) => s.pending),
              "pendente",
              "pendentes",
            )}
          </span>
          <span className="text-right font-financial tabular-nums">
            {complete ? formatCurrency(sum((s) => s.statementBalance)) : "—"}
          </span>
          <span
            className={cn(
              "text-right font-financial tabular-nums",
              complete && sum((s) => s.projectedDifference) !== 0
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            title={
              complete
                ? "Inclui o rendimento ainda não reconhecido das aplicações"
                : "Informe o saldo de todas as contas para somar"
            }
          >
            {complete
              ? formatCurrency(sum((s) => s.projectedDifference))
              : "falta saldo"}
          </span>
        </div>
      )}
    </nav>
  );
}

function AccountRow({
  account: a,
  summary: s,
  active,
  onSelect,
}: {
  account: BankAccount;
  summary?: Summary;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const closing = lastClosing(a);
  const diff = s?.projectedDifference ?? null;
  // Aplicação acima do sistema é rendimento a reconhecer, não erro.
  const yieldAhead = isInvestment(a) && diff !== null && diff > 0;
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(a.id)}
        className={cn(
          grid,
          "w-full py-2 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
          active && "bg-muted font-medium hover:bg-muted",
        )}
      >
        <span className="truncate">{a.name}</span>
        <span className="hidden tabular-nums text-muted-foreground md:block">
          {closing ? format(closing.through, "dd/MM/yyyy") : "nunca fechada"}
        </span>
        <span
          className={cn(
            "text-right tabular-nums",
            !s?.pending && "text-muted-foreground",
          )}
        >
          {s?.pending
            ? plural(s.pending, "pendente", "pendentes")
            : "nada pendente"}
        </span>
        <span className="hidden text-right font-financial tabular-nums md:block">
          {s?.statementBalance != null ? (
            formatCurrency(s.statementBalance)
          ) : (
            <span className="text-muted-foreground">sem saldo</span>
          )}
        </span>
        <span
          className={cn(
            "hidden text-right font-financial tabular-nums md:block",
            diff === null || diff === 0 || yieldAhead
              ? "text-muted-foreground"
              : "text-amber-700 dark:text-amber-400",
          )}
        >
          {diff === null
            ? "—"
            : yieldAhead
              ? `+${formatCurrency(diff)} a reconhecer`
              : formatCurrency(diff)}
        </span>
      </button>
    </li>
  );
}
