"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import currency from "currency.js";
import { differenceInCalendarDays, format } from "date-fns";
import { Loader2, Search } from "lucide-react";
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
 * Despesa só é baixada pelo extrato depois de aprovada e liberada: o extrato
 * confirma o pagamento, não substitui o fluxo. Receita não tem esse fluxo.
 */
const PAYABLE_STATUSES = ["authorized"];
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

interface SettleFromStatementSheetProps {
  companyId: string;
  bankTx: BankTransaction | null;
  onOpenChange: (open: boolean) => void;
  onSettle: (tx: Transaction, settlement: Settlement) => Promise<void>;
}

export function SettleFromStatementSheet({
  companyId,
  bankTx,
  onOpenChange,
  onSettle,
}: SettleFromStatementSheetProps) {
  const isDebit = bankTx ? bankTx.amount < 0 : true;
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // Mais provável primeiro: valor mais próximo, depois vencimento mais próximo.
  const candidates = useMemo(() => {
    if (!bankTx) return [];
    const term = normalizeText(search.trim());
    return open
      .filter((t) => !t.reconciled && !t.paymentHold)
      .filter(
        (t) =>
          !term ||
          normalizeText(
            `${t.description} ${t.supplierOrClient ?? ""} ${t.documentNumber ?? ""}`,
          ).includes(term) ||
          String(t.amount).includes(term),
      )
      .map((t) => ({
        tx: t,
        amountGap: Math.abs(currency(t.amount).subtract(target).value),
        dayGap: Math.abs(
          differenceInCalendarDays(new Date(t.dueDate), new Date(bankTx.date)),
        ),
      }))
      .sort((a, b) => a.amountGap - b.amountGap || a.dayGap - b.dayGap)
      .slice(0, 50);
  }, [open, search, target, bankTx]);

  const selected = candidates.find((c) => c.tx.id === selectedId)?.tx;
  // Pagou menos que o título: desconto. Pagou mais: juros/multa.
  const gap = selected ? currency(target).subtract(selected.amount).value : 0;

  const close = () => {
    setSearch("");
    setSelectedId(null);
    onOpenChange(false);
  };

  const confirm = async () => {
    if (!selected || !bankTx) return;
    setSaving(true);
    try {
      await onSettle(selected, {
        paymentDate: new Date(bankTx.date),
        finalAmount: target,
        discount: gap < 0 ? -gap : 0,
        interest: gap > 0 ? gap : 0,
      });
      close();
    } catch {
      // O chamador já avisou; o painel fica aberto para tentar de novo.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!bankTx} onOpenChange={(o) => !o && close()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>
            {isDebit ? "Baixar conta a pagar" : "Baixar conta a receber"}
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
              ? "Só aparecem despesas autorizadas e sem bloqueio de pagamento."
              : "Aparecem as receitas ainda não recebidas."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {search
                ? `Nada encontrado para "${search}".`
                : isDebit
                  ? "Nenhuma despesa autorizada aguardando pagamento."
                  : "Nenhuma receita em aberto."}
            </p>
          ) : (
            <ul
              role="listbox"
              aria-label="Títulos em aberto"
              className="divide-y"
            >
              {candidates.map(({ tx, amountGap, dayGap }) => (
                <li key={tx.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={tx.id === selectedId}
                    onClick={() => setSelectedId(tx.id)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-5 py-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                      tx.id === selectedId &&
                        "bg-primary/5 hover:bg-primary/10",
                    )}
                  >
                    <span className="truncate font-medium">
                      {tx.description}
                    </span>
                    <span className="font-financial tabular-nums">
                      {formatCurrency(tx.amount)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {tx.supplierOrClient || "Sem fornecedor"} · vence{" "}
                      {format(new Date(tx.dueDate), "dd/MM/yyyy")}
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
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t px-5 py-4">
          {selected && gap !== 0 && (
            <p className="text-sm">
              O banco {isDebit ? "debitou" : "creditou"}{" "}
              {gap < 0 ? "menos" : "mais"} que o título: a baixa registra{" "}
              <strong className="font-financial tabular-nums">
                {formatCurrency(Math.abs(gap))}
              </strong>{" "}
              de {gap < 0 ? "desconto" : "juros/multa"}.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button disabled={!selected || saving} onClick={confirm}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Baixar e conciliar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
