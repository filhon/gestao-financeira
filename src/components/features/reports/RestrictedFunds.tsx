"use client";

import Link from "next/link";
import { format } from "date-fns";
import { cn, formatCurrency } from "@/lib/utils";
import { effectiveDate } from "@/lib/chartOfAccounts";
import type { RestrictedFund } from "@/lib/cashStatement";
import { flowAmount, situationOf } from "@/lib/reports";
import type { Transaction } from "@/lib/types";
import {
  Drill,
  DrillValue,
  TD,
  TH,
  tone,
} from "@/components/features/reports/ReportTables";

/** Recursos com restrição do doador: recebido, aplicado e o que falta aplicar. */
export function RestrictedFunds({
  funds,
  start,
  canManage,
  onDrill,
}: {
  funds: RestrictedFund[];
  start: Date;
  canManage: boolean;
  onDrill: (d: Drill) => void;
}) {
  const drill = (title: string, lines: Transaction[]) =>
    onDrill({
      title,
      subtitle: "Lançamentos do recurso no período",
      lines: lines.map((t) => ({
        tx: t,
        date: effectiveDate(t),
        amount: flowAmount(t),
        status: situationOf(t),
      })),
    });

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        Recursos com restrição do doador
      </h2>
      {funds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum centro de custo está marcado como recurso vinculado.{" "}
          {canManage && (
            <Link
              href="/centros-custo"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Marcar em Centros de custo
            </Link>
          )}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr className="border-b text-left">
                  <th scope="col" className={cn(TH, "min-w-[14rem]")}>
                    Recurso e doador
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    A aplicar em {format(start, "dd/MM/yyyy")}
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    Recebido
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    Aplicado
                  </th>
                  <th scope="col" className={cn(TH, "text-right")}>
                    A aplicar
                  </th>
                </tr>
              </thead>
              <tbody className="font-financial">
                {funds.flatMap((f) => [
                  <tr
                    key={f.id}
                    className="border-b border-border/60 bg-muted/50 font-semibold"
                  >
                    <th scope="row" className={cn(TD, "text-left font-sans")}>
                      {f.name}
                    </th>
                    <td className={cn(TD, "text-right", tone(f.before))}>
                      {formatCurrency(f.before)}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <DrillValue
                        label={`${f.name}: recebido`}
                        value={f.received}
                        onOpen={() =>
                          drill(
                            `${f.name}: recebido`,
                            f.donors.flatMap((d) => d.lines),
                          )
                        }
                      />
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <DrillValue
                        label={`${f.name}: aplicado`}
                        value={f.applied}
                        onOpen={() =>
                          drill(
                            `${f.name}: aplicado`,
                            f.uses.flatMap((d) => d.lines),
                          )
                        }
                      />
                    </td>
                    <td className={cn(TD, "text-right", tone(f.balance))}>
                      {formatCurrency(f.balance)}
                    </td>
                  </tr>,
                  ...f.donors.map((d) => (
                    <tr
                      key={`${f.id}:${d.name}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className={cn(TD, "pl-8 font-sans")}>{d.name}</td>
                      <td />
                      <td className={cn(TD, "text-right")}>
                        <DrillValue
                          label={d.name}
                          value={d.value}
                          onOpen={() => drill(`${f.name}: ${d.name}`, d.lines)}
                        />
                      </td>
                      <td />
                      <td />
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Aplicado: o que foi pago no centro de custo e nos filhos dele. A
            aplicar negativo: o centro gastou mais do que os doadores mandaram
            até aqui, e a diferença saiu de recurso próprio.
          </p>
        </>
      )}
    </section>
  );
}
