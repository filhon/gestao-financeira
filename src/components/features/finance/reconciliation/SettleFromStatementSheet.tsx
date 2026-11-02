"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import currency from "currency.js";
import { differenceInCalendarDays, format } from "date-fns";
import { Check, Loader2, Minus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { transactionService } from "@/lib/services/transactionService";
import { BankTransaction, Transaction } from "@/lib/types";
import { cn, formatCurrency, normalizeText } from "@/lib/utils";

/**
 * Despesa só é baixada pelo extrato depois de aprovada (avulsa ou no lote):
 * o extrato confirma o pagamento, não substitui o fluxo. Receita não tem esse
 * fluxo.
 */
const PAYABLE_STATUSES = ["approved", "authorized"];
const RECEIVABLE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
];

export type Settlement = {
  paymentDate: Date;
  finalAmount: number;
  discount: number;
  interest: number;
};

export type SettleItem = { tx: Transaction; settlement: Settlement };

type Candidate = { tx: Transaction; amountGap: number; dayGap: number };
type Group = {
  key: string;
  name: string;
  items: Candidate[];
  total: number;
  /** Menor distância do extrato: a soma do grupo ou uma conta sozinha. */
  gap: number;
  dayGap: number;
};

interface SettleFromStatementSheetProps {
  companyId: string;
  bankTx: BankTransaction | null;
  onOpenChange: (open: boolean) => void;
  onSettle: (items: SettleItem[]) => Promise<void>;
}

const sum = (txs: Transaction[]) =>
  txs.reduce((acc, t) => acc.add(t.amount), currency(0)).value;

function CheckBox({ state }: { state: boolean | "mixed" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-lg border",
        state
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input",
      )}
    >
      {state === "mixed" ? (
        <Minus className="h-3 w-3" />
      ) : state ? (
        <Check className="h-3 w-3" />
      ) : null}
    </span>
  );
}

export function SettleFromStatementSheet({
  companyId,
  bankTx,
  onOpenChange,
  onSettle,
}: SettleFromStatementSheetProps) {
  const isDebit = bankTx ? bankTx.amount < 0 : true;
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: open = [], isLoading } = useQuery({
    queryKey: ["settle-candidates", companyId, isDebit],
    queryFn: () =>
      transactionService.getAll({
        companyId,
        type: isDebit ? "payable" : "receivable",
        statuses: isDebit ? PAYABLE_STATUSES : RECEIVABLE_STATUSES,
        limit: 300,
      }),
    enabled: !!bankTx,
  });

  const target = bankTx ? Math.abs(bankTx.amount) : 0;

  // Uma transferência costuma pagar várias contas do mesmo favorecido (os
  // projetos de uma instituição): agrupa por entidade, e o grupo cuja soma
  // bate com o extrato sobe para o topo.
  const groups = useMemo(() => {
    if (!bankTx) return [];
    const term = normalizeText(search.trim());
    const byKey = new Map<string, Group>();
    for (const t of open) {
      if (t.reconciled || t.paymentHold) continue;
      // Título com conta definida só baixa pelo extrato dessa conta.
      if (
        t.bankAccountId &&
        bankTx.bankAccountId &&
        t.bankAccountId !== bankTx.bankAccountId
      )
        continue;
      if (
        term &&
        !normalizeText(
          `${t.description} ${t.supplierOrClient ?? ""} ${t.documentNumber ?? ""}`,
        ).includes(term) &&
        !String(t.amount).includes(term)
      )
        continue;
      const key = t.entityId || normalizeText(t.supplierOrClient ?? "") || t.id;
      const group = byKey.get(key) ?? {
        key,
        name: t.supplierOrClient || "Sem fornecedor",
        items: [],
        total: 0,
        gap: 0,
        dayGap: 0,
      };
      group.items.push({
        tx: t,
        amountGap: Math.abs(currency(t.amount).subtract(target).value),
        dayGap: Math.abs(
          differenceInCalendarDays(new Date(t.dueDate), new Date(bankTx.date)),
        ),
      });
      byKey.set(key, group);
    }
    return [...byKey.values()]
      .map((g) => {
        g.items.sort(
          (a, b) =>
            new Date(a.tx.dueDate).getTime() - new Date(b.tx.dueDate).getTime(),
        );
        g.total = sum(g.items.map((c) => c.tx));
        g.gap = Math.min(
          Math.abs(currency(g.total).subtract(target).value),
          ...g.items.map((c) => c.amountGap),
        );
        g.dayGap = Math.min(...g.items.map((c) => c.dayGap));
        return g;
      })
      .sort((a, b) => a.gap - b.gap || a.dayGap - b.dayGap)
      .slice(0, 50);
  }, [open, search, target, bankTx]);

  // A seleção sobrevive à busca: soma o que foi marcado, visível ou não.
  const selected = open.filter((t) => selectedIds.has(t.id));
  const multiple = selected.length > 1;
  // Pagou menos que o título: desconto. Pagou mais: juros/multa.
  const gap = currency(target).subtract(sum(selected)).value;
  // Várias contas numa transferência só: a diferença não tem a quem ser
  // atribuída, então a soma precisa bater.
  const blocked = selected.length === 0 || (multiple && gap !== 0);

  const toggle = (ids: string[], on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const close = () => {
    setSearch("");
    setSelectedIds(new Set());
    onOpenChange(false);
  };

  const confirm = async () => {
    if (blocked || !bankTx) return;
    const paymentDate = new Date(bankTx.date);
    setSaving(true);
    try {
      await onSettle(
        multiple
          ? selected.map((tx) => ({
              tx,
              settlement: {
                paymentDate,
                finalAmount: tx.amount,
                discount: 0,
                interest: 0,
              },
            }))
          : [
              {
                tx: selected[0],
                settlement: {
                  paymentDate,
                  finalAmount: target,
                  discount: gap < 0 ? -gap : 0,
                  interest: gap > 0 ? gap : 0,
                },
              },
            ],
      );
      close();
    } catch {
      // O chamador já avisou; o painel fica aberto para tentar de novo.
    } finally {
      setSaving(false);
    }
  };

  const itemRow = ({ tx, amountGap, dayGap }: Candidate, nested: boolean) => {
    const on = selectedIds.has(tx.id);
    return (
      <li key={tx.id}>
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          onClick={() => toggle([tx.id], !on)}
          className={cn(
            "flex w-full gap-3 py-3 pr-5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
            nested ? "pl-12" : "pl-5",
            on && "bg-primary/5 hover:bg-primary/10",
          )}
        >
          <CheckBox state={on} />
          <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3">
            <span className="truncate font-medium">{tx.description}</span>
            <span className="font-financial tabular-nums">
              {formatCurrency(tx.amount)}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {nested ? "" : `${tx.supplierOrClient || "Sem fornecedor"} · `}
              vence {format(new Date(tx.dueDate), "dd/MM/yyyy")}
            </span>
            <span
              className={cn(
                "text-right text-xs",
                amountGap === 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {amountGap === 0
                ? "valor exato"
                : `Δ ${formatCurrency(amountGap)}`}
              {dayGap > 0 && ` · ${dayGap}d`}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Sheet open={!!bankTx} onOpenChange={(o) => !o && close()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>
            {isDebit ? "Baixar contas a pagar" : "Baixar contas a receber"}
          </SheetTitle>
          {bankTx && (
            <SheetDescription asChild>
              <div className="space-y-0.5">
                <p className="truncate" title={bankTx.description}>
                  {bankTx.description}
                </p>
                <p className="font-financial tabular-nums text-foreground">
                  {format(new Date(bankTx.date), "dd/MM/yyyy")} ·{" "}
                  {formatCurrency(target)}
                </p>
              </div>
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="border-b px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por descrição, fornecedor ou documento"
              className="pl-8"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isDebit
              ? "Despesas aprovadas e sem bloqueio. Uma transferência pagou várias contas do mesmo favorecido? Marque todas."
              : "Receitas ainda não recebidas. Marque várias se o crédito somou mais de uma."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {search
                ? `Nada encontrado para "${search}".`
                : isDebit
                  ? "Nenhuma despesa aprovada aguardando pagamento."
                  : "Nenhuma receita em aberto."}
            </p>
          ) : (
            <ul aria-label="Títulos em aberto" className="divide-y">
              {groups.map((g) => {
                if (g.items.length === 1) return itemRow(g.items[0], false);
                const ids = g.items.map((c) => c.tx.id);
                const count = ids.filter((id) => selectedIds.has(id)).length;
                const state =
                  count === ids.length ? true : count > 0 ? "mixed" : false;
                const exact = currency(g.total).subtract(target).value === 0;
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={state}
                      onClick={() => toggle(ids, state !== true)}
                      className="flex w-full gap-3 bg-muted/30 px-5 py-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      <CheckBox state={state} />
                      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                        <span className="truncate font-medium">{g.name}</span>
                        <span className="font-financial tabular-nums">
                          {formatCurrency(g.total)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ids.length} contas · marcar todas
                        </span>
                        <span
                          className={cn(
                            "text-right text-xs",
                            exact
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {exact ? "soma exata" : "soma"}
                        </span>
                      </span>
                    </button>
                    <ul className="divide-y border-t">
                      {g.items.map((c) => itemRow(c, true))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t px-5 py-4">
          {selected.length > 0 && (
            <p className="text-sm" aria-live="polite">
              {multiple ? (
                gap === 0 ? (
                  <>
                    {selected.length} contas somam exatamente{" "}
                    <strong className="font-financial tabular-nums">
                      {formatCurrency(target)}
                    </strong>
                    .
                  </>
                ) : (
                  <span className="text-destructive">
                    {selected.length} contas somam{" "}
                    <strong className="font-financial tabular-nums">
                      {formatCurrency(sum(selected))}
                    </strong>
                    : {gap > 0 ? "faltam" : "sobram"}{" "}
                    <strong className="font-financial tabular-nums">
                      {formatCurrency(Math.abs(gap))}
                    </strong>{" "}
                    para bater com o extrato.
                  </span>
                )
              ) : (
                gap !== 0 && (
                  <>
                    O banco {isDebit ? "debitou" : "creditou"}{" "}
                    {gap < 0 ? "menos" : "mais"} que o título: a baixa registra{" "}
                    <strong className="font-financial tabular-nums">
                      {formatCurrency(Math.abs(gap))}
                    </strong>{" "}
                    de {gap < 0 ? "desconto" : "juros/multa"}.
                  </>
                )
              )}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button disabled={blocked || saving} onClick={confirm}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {multiple
                ? `Baixar ${selected.length} e conciliar`
                : "Baixar e conciliar"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
