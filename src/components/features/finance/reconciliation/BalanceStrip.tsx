"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, Lock, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BankAccount } from "@/lib/types";
import { lastClosing, summarizeAccount } from "@/lib/bankReconciliation";
import { cn, formatCurrency, plural } from "@/lib/utils";

type Summary = ReturnType<typeof summarizeAccount>;

// Mesmo anel dos botões do sistema, para os gatilhos em texto.
const focusRing =
  "rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface BalanceStripProps {
  account: BankAccount;
  summary: Summary;
  canManage: boolean;
  canReopen: boolean;
  onSetStatementBalance: (balance: number, date: Date) => Promise<void>;
  onClose: () => void;
  onReopen: () => void;
  onShowPending: () => void;
}

const d = (date: Date) => format(date, "dd/MM/yyyy");

export function BalanceStrip({
  account,
  summary,
  canManage,
  canReopen,
  onSetStatementBalance,
  onClose,
  onReopen,
  onShowPending,
}: BalanceStripProps) {
  const closing = lastClosing(account);
  const projected = summary.projectedDifference;
  const closeBlocker = summary.canClose
    ? null
    : summary.pending > 0
      ? `Faltam ${plural(summary.pending, "linha", "linhas")}`
      : summary.difference !== null && summary.difference !== 0
        ? `Diferença de ${formatCurrency(summary.difference)}`
        : !summary.hasMovement
          ? `Extrato sem movimento depois de ${d(summary.base.date)}`
          : null;

  return (
    <section
      aria-label="Saldo da conciliação"
      className="rounded-lg border bg-card"
    >
      <dl className="grid grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Figure label="Saldo inicial">
          <span className="font-financial tabular-nums">
            {formatCurrency(summary.base.balance)}
          </span>
          <Hint>
            {closing ? "fechamento de " : "abertura em "}
            {d(summary.base.date)}
          </Hint>
        </Figure>

        <Figure
          label="Saldo do extrato"
          action={
            canManage &&
            summary.statementBalance !== null && (
              <StatementBalanceEditor
                account={account}
                onSave={onSetStatementBalance}
              />
            )
          }
        >
          {summary.statementBalance === null ? (
            canManage ? (
              <StatementBalanceEditor
                account={account}
                onSave={onSetStatementBalance}
                asText
              />
            ) : (
              <span className="text-muted-foreground">Não informado</span>
            )
          ) : (
            <span className="font-financial tabular-nums">
              {formatCurrency(summary.statementBalance)}
            </span>
          )}
          <Hint>
            {summary.statementDate
              ? `em ${d(summary.statementDate)}`
              : "o OFX traz este valor"}
          </Hint>
        </Figure>

        <Figure label="Saldo conciliado">
          <span className="font-financial tabular-nums">
            {formatCurrency(summary.bookBalance)}
          </span>
          <Hint>
            {summary.handled} de {plural(summary.total, "linha", "linhas")} do
            período
          </Hint>
        </Figure>

        {/* Projetada: tratar soma a linha como ela está, então o número final já
            é conhecido. Uma diferença parcial fazia caçar centavos que não existem. */}
        <Figure label="Diferença">
          {projected === null ? (
            <span className="text-muted-foreground">Sem saldo do extrato</span>
          ) : (
            <span
              className={cn(
                "font-financial tabular-nums text-lg font-semibold",
                projected !== 0
                  ? "text-amber-700 dark:text-amber-400"
                  : summary.pending === 0 &&
                      "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {formatCurrency(projected)}
            </span>
          )}
          {summary.pending > 0 && (
            <button
              type="button"
              onClick={onShowPending}
              className={cn(
                "self-start text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground",
                focusRing,
              )}
            >
              com{" "}
              {plural(summary.pending, "linha pendente", "linhas pendentes")}{" "}
              <span className="font-financial tabular-nums">
                ({summary.pendingAmount < 0 ? "−" : "+"}
                {formatCurrency(Math.abs(summary.pendingAmount))})
              </span>
            </button>
          )}
          {projected !== null && (
            <Hint>
              {projected !== 0
                ? summary.pending > 0
                  ? "não zera tratando tudo: confira o saldo inicial e se faltam linhas"
                  : "confira o saldo inicial e se faltam linhas no arquivo"
                : summary.pending > 0
                  ? "zera quando as pendentes forem tratadas"
                  : "extrato e sistema batem"}
            </Hint>
          )}
        </Figure>

        <div className="col-span-2 lg:col-span-1 flex flex-wrap items-center gap-2 px-4 py-3">
          {closing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Fechada até {d(closing.through)}
              {canReopen && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={onReopen}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Reabrir
                </Button>
              )}
            </span>
          )}
          {canManage && summary.statementDate && (
            // O motivo fica à vista: botão desabilitado não abre `title`.
            <div className="flex flex-col items-start gap-1 lg:items-end">
              <Button
                size="sm"
                className="h-9"
                disabled={!summary.canClose}
                onClick={onClose}
                aria-describedby={closeBlocker ? "close-blocker" : undefined}
              >
                <CheckCircle2 className="h-4 w-4" />
                Fechar até {d(summary.statementDate)}
              </Button>
              {closeBlocker && (
                <span
                  id="close-blocker"
                  className="text-xs text-muted-foreground"
                >
                  {closeBlocker}
                </span>
              )}
            </div>
          )}
        </div>
      </dl>
    </section>
  );
}

function Figure({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 min-w-0 border-b odd:border-r lg:border-b-0 lg:border-r">
      <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {action}
      </dt>
      <dd className="flex flex-col gap-0.5">{children}</dd>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/** Para CSV, que não traz saldo; também corrige um OFX sem LEDGERBAL. */
function StatementBalanceEditor({
  account,
  onSave,
  asText,
}: {
  account: BankAccount;
  onSave: (balance: number, date: Date) => Promise<void>;
  /** Saldo ainda não informado: o gatilho vira o próprio valor da célula. */
  asText?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(Math.abs(account.statementBalance ?? 0));
  const [negative, setNegative] = useState((account.statementBalance ?? 0) < 0);
  const [date, setDate] = useState(
    format(account.statementBalanceDate ?? new Date(), "yyyy-MM-dd"),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const [y, m, dd] = date.split("-").map(Number);
    if (!y || !m || !dd) return;
    setSaving(true);
    try {
      await onSave(negative ? -value : value, new Date(y, m - 1, dd));
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {asText ? (
          <button
            type="button"
            className={cn(
              "self-start text-sm font-medium text-primary underline underline-offset-2 hover:no-underline",
              focusRing,
            )}
          >
            Informar saldo
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "-my-1 flex h-6 w-6 items-center justify-center hover:bg-muted hover:text-foreground",
              focusRing,
            )}
            aria-label="Corrigir saldo do extrato"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="start">
        <p className="text-sm font-medium">Saldo final do extrato</p>
        <div className="space-y-1.5">
          <Label htmlFor="stmt-balance">Saldo</Label>
          <CurrencyInput
            id="stmt-balance"
            value={value}
            onChange={setValue}
            className="font-financial tabular-nums"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={negative}
            onCheckedChange={(v) => setNegative(!!v)}
          />
          Saldo devedor (negativo)
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="stmt-date">Ao fim do dia</Label>
          <Input
            id="stmt-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
