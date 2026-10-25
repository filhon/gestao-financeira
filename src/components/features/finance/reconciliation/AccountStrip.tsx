"use client";

import { format } from "date-fns";
import { BankAccount } from "@/lib/types";
import { lastClosing, summarizeAccount } from "@/lib/bankReconciliation";
import { cn, formatCurrency, plural } from "@/lib/utils";

type Summary = ReturnType<typeof summarizeAccount>;

// Mesmas colunas no cabeçalho e nas linhas, para alinhar sem tabela.
const grid =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 px-4 md:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem]";

/**
 * Todas as contas numa olhada: até quando cada uma está conciliada e o que
 * falta. A mais atrasada vem primeiro; clicar troca a conta da tela.
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
        <span className="text-right">Diferença</span>
      </div>
      <ul className="divide-y">
        {accounts.map((a) => {
          const s = summaries.get(a.id);
          const closing = lastClosing(a);
          const active = a.id === activeId;
          const diff = s?.projectedDifference ?? null;
          return (
            <li key={a.id}>
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
                  {closing
                    ? format(closing.through, "dd/MM/yyyy")
                    : "nunca fechada"}
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
                <span
                  className={cn(
                    "hidden text-right font-financial tabular-nums md:block",
                    diff === null || diff === 0
                      ? "text-muted-foreground"
                      : "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {diff === null ? "sem extrato" : formatCurrency(diff)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
