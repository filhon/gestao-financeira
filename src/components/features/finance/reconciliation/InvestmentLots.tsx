"use client";

import { useState } from "react";
import { format } from "date-fns";
import currency from "currency.js";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BankAccount } from "@/lib/types";
import { iofRate, irRate, Position, PositionLot } from "@/lib/investment";
import { cn, formatCurrency } from "@/lib/utils";

const d = (date: Date) => format(date, "dd/MM/yyyy");
const pct = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = "px-3 py-2 text-right font-financial tabular-nums";

/**
 * As aplicações que ainda estão investidas, na ordem em que o resgate as
 * consome (PEPS): quanto cada uma vale, quanto de IR e IOF pagaria hoje e o
 * líquido de resgatar tudo.
 */
export function InvestmentLots({
  account,
  position,
  canEditRate,
  onRateChange,
}: {
  account: BankAccount;
  position: Position;
  canEditRate: boolean;
  /** `undefined` volta para a taxa da conta. */
  onRateChange: (lotId: string, rate: number | undefined) => Promise<void>;
}) {
  const hasCurve = position.curve !== null;
  const exempt = !!account.taxExempt;
  return (
    <section aria-labelledby="lots-title" className="rounded-lg border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b px-4 py-3">
        <h2 id="lots-title" className="text-sm font-semibold">
          Aplicações investidas
          <span className="ml-2 font-normal text-muted-foreground">
            em {d(position.at)}, resgate consome a mais antiga primeiro
          </span>
        </h2>
        <p className="text-sm">
          Resgatando tudo:{" "}
          <span className="font-financial font-semibold tabular-nums">
            {formatCurrency(position.net)}
          </span>{" "}
          <span className="text-muted-foreground">
            líquido
            {!exempt &&
              ` (IR ${formatCurrency(position.ir)} · IOF ${formatCurrency(position.iof)})`}
          </span>
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 text-left font-medium">Aplicação</th>
              <th className="px-3 py-2 text-right font-medium">Dias</th>
              {hasCurve && (
                <th className="px-3 py-2 text-right font-medium">Taxa</th>
              )}
              <th className="px-3 py-2 text-right font-medium">Aplicado</th>
              <th className="px-3 py-2 text-right font-medium">Bruto</th>
              {!exempt && (
                <>
                  <th className="px-3 py-2 text-right font-medium">IR</th>
                  <th className="px-3 py-2 text-right font-medium">IOF</th>
                </>
              )}
              <th className="px-4 py-2 text-right font-medium">Líquido</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {position.lots.map((lot) => (
              <tr key={lot.id}>
                <td className="px-4 py-2">
                  {d(lot.date)}
                  {lot.id === "opening" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      saldo de abertura
                    </span>
                  )}
                </td>
                <td className={num}>{lot.days}</td>
                {hasCurve && (
                  <td className={num}>
                    <RateCell
                      lot={lot}
                      accountRate={account.cdiPercent}
                      editable={canEditRate && lot.id !== "opening"}
                      onSave={(rate) => onRateChange(lot.id, rate)}
                    />
                  </td>
                )}
                <td className={num}>{formatCurrency(lot.principal)}</td>
                <td className={num}>{formatCurrency(lot.value)}</td>
                {!exempt && (
                  <>
                    <td className={num}>
                      {formatCurrency(lot.ir)}
                      <Rate>{pct(irRate(lot.days) * 100)}</Rate>
                    </td>
                    <td className={num}>
                      {lot.iof > 0 ? formatCurrency(lot.iof) : "—"}
                      {iofRate(lot.days) > 0 && (
                        <Rate>{pct(iofRate(lot.days) * 100)}</Rate>
                      )}
                    </td>
                  </>
                )}
                <td className={cn(num, "px-4")}>
                  {formatCurrency(
                    currency(lot.value).subtract(lot.ir).subtract(lot.iof)
                      .value,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!exempt && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Estimativa pelo IR regressivo (22,5% até 180 dias … 15% acima de 720)
          e IOF nos primeiros 30 dias, sobre o saldo bruto
          {hasCurve ? " informado ou o da curva" : " informado"}. O valor retido
          de verdade está na nota de resgate do banco.
        </p>
      )}
    </section>
  );
}

function Rate({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] text-muted-foreground">{children}</span>
  );
}

function RateCell({
  lot,
  accountRate,
  editable,
  onSave,
}: {
  lot: PositionLot;
  accountRate?: number;
  editable: boolean;
  onSave: (rate: number | undefined) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(lot.cdiPercent ?? ""));
  const [saving, setSaving] = useState(false);
  const own = lot.cdiPercent !== undefined && lot.cdiPercent !== accountRate;
  const label = lot.cdiPercent ? `${pct(lot.cdiPercent)} CDI` : "—";
  if (!editable) return <>{label}</>;

  const save = async (rate: number | undefined) => {
    setSaving(true);
    try {
      await onSave(rate);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };
  const parsed = Number(value.replace(",", "."));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(String(lot.cdiPercent ?? ""));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            own && "font-medium",
          )}
          aria-label={`Taxa da aplicação de ${d(lot.date)}: ${label}`}
        >
          {label}
          <Pencil className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="end">
        <p className="text-sm font-medium">Taxa desta aplicação</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 font-financial tabular-nums"
            aria-label="% do CDI"
          />
          <span className="text-sm text-muted-foreground">% do CDI</span>
        </div>
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || !own}
            onClick={() => save(undefined)}
          >
            Usar a da conta
          </Button>
          <Button
            size="sm"
            disabled={saving || !(parsed > 0 && parsed <= 300)}
            onClick={() => save(parsed)}
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
