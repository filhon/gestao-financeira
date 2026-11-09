"use client";

import { Fragment, type ReactNode } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import currency from "currency.js";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cashCover,
  overdueOf,
  positionTitle,
  type AnalyticsReport,
} from "@/lib/analytics";
import {
  useAccountPositions,
  useCashAvailable,
  type AccountPosition,
} from "@/hooks/useAnalytics";
import { useBankBalance, useCashReserve } from "@/hooks/useDashboardData";
import { cn } from "@/lib/utils";
import { fullMoney, money, Section } from "./primitives";

/** Extrato com mais de uma semana: o saldo pode ter mudado. */
const STALE_DAYS = 7;
const dayText = (key: string) =>
  format(new Date(`${key}T12:00:00`), "dd/MM/yyyy");

interface Line {
  key: string;
  label: ReactNode;
  note?: ReactNode;
  value: number;
  /** Subtotal: "= Caixa disponível", "= Total no banco". */
  total?: boolean;
}

/**
 * Posição numa conta só, que fecha: contas correntes e aplicação automática
 * somam o caixa disponível; as demais aplicações levam ao total no banco.
 * Os mesmos três números que antes apareciam soltos, agora ligados.
 */
export function PositionSection({ report }: { report: AnalyticsReport }) {
  const cash = useCashAvailable();
  const bank = useBankBalance();
  const reserve = useCashReserve();
  const accounts = useAccountPositions();

  const available = cash.data?.balance ?? null;
  const cover = cashCover(report, available);
  const liquid = (reserve.data ?? []).reduce(
    (s, r) => s.add(r.position.net),
    currency(0),
  ).value;
  const owedOut = overdueOf(report, "payable").value;

  const positions = accounts.data?.positions ?? [];
  const today = new Date();
  const lineOf = (p: AccountPosition): Line => {
    const age = differenceInCalendarDays(today, p.date);
    return {
      key: p.id,
      label: p.name,
      note: (
        <span
          className={cn(
            age > STALE_DAYS &&
              "inline-flex items-center gap-1 text-amber-700 dark:text-amber-400",
          )}
        >
          {age > STALE_DAYS && (
            <AlertTriangle className="h-3 w-3" aria-hidden />
          )}
          {p.sweep
            ? "Aplicação automática, "
            : p.investment
              ? "Aplicação, "
              : ""}
          {age > STALE_DAYS ? "sem extrato desde" : "saldo de"}{" "}
          {format(p.date, "dd/MM/yyyy")}
        </span>
      ),
      value: p.balance,
    };
  };

  const inCash = positions.filter((p) => !p.investment || p.sweep);
  const outside = positions.filter((p) => p.investment && !p.sweep);
  const sum = (ps: AccountPosition[]) =>
    ps.reduce((s, p) => s.add(p.balance), currency(0)).value;

  const lines: Line[] = [];
  if (available !== null) {
    lines.push(...inCash.map(lineOf));
    // Baixas registradas depois do extrato já mexeram no caixa.
    const after = currency(available).subtract(sum(inCash)).value;
    if (Math.abs(after) >= 0.01)
      lines.push({
        key: "after",
        label: "Pagamentos e recebimentos depois do último extrato",
        value: after,
      });
    lines.push({
      key: "cash",
      label: "Caixa disponível",
      value: available,
      total: true,
    });
    if (bank.data && outside.length) {
      lines.push(...outside.map(lineOf));
      const rest = currency(bank.data.balance)
        .subtract(available)
        .subtract(sum(outside)).value;
      if (Math.abs(rest) >= 0.01)
        lines.push({ key: "rest", label: "Outros ajustes", value: rest });
      lines.push({
        key: "bank",
        label: "Total no banco",
        note: "Com as aplicações que não são de resgate automático",
        value: bank.data.balance,
        total: true,
      });
    }
  }

  const description = cover?.next ? (
    <>
      Próxima entrada prevista: {money(cover.next.amount)} em{" "}
      {dayText(cover.next.date)}. Até lá vencem {money(cover.due)} a pagar já
      lançados
      {owedOut > 0 && `, fora ${money(owedOut)} já vencidos`}.
      {!cover.covered &&
        liquid > 0 &&
        available !== null &&
        available + liquid >= cover.due &&
        ` Resgatando as aplicações de liquidez diária (${money(liquid)}), cobre.`}
    </>
  ) : undefined;

  return (
    <Section
      id="posicao"
      kicker="Posição agora"
      title={positionTitle(available, cover)}
      description={description}
    >
      {cash.isLoading || accounts.isLoading ? (
        <div className="space-y-3 py-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : accounts.isError || cash.isError ? (
        <p className="py-3 text-sm text-muted-foreground">
          Não foi possível ler as contas bancárias. Use Atualizar para tentar de
          novo.
        </p>
      ) : available === null || positions.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Nenhuma conta corrente ativa. Cadastre em Cadastros, Contas Bancárias,
          para ver o caixa aqui.
        </p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
          {lines.map((l) => (
            <Fragment key={l.key}>
              <dt
                className={cn(
                  "py-2 pr-4",
                  l.total
                    ? "border-t-2 border-foreground/20 font-semibold"
                    : "border-t",
                )}
              >
                {l.total ? "= " : ""}
                {l.label}
              </dt>
              <dd
                className={cn(
                  "hidden py-2 pr-4 text-xs text-muted-foreground sm:block",
                  l.total ? "border-t-2 border-foreground/20" : "border-t",
                )}
              >
                {l.note}
              </dd>
              <dd
                className={cn(
                  "py-2 text-right font-financial",
                  l.total
                    ? "border-t-2 border-foreground/20 font-semibold"
                    : "border-t",
                )}
              >
                {fullMoney(l.value)}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Section>
  );
}
