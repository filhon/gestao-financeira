"use client";

import { differenceInCalendarDays, format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import currency from "currency.js";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsReport } from "@/lib/analytics";
import { variation } from "@/lib/reports";
import { useAccountPositions, useCashAvailable } from "@/hooks/useAnalytics";
import { useBankBalance, useCashReserve } from "@/hooks/useDashboardData";
import {
  fullMoney,
  money,
  pct,
  RankedBars,
  Section,
  signedMoney,
  StatTile,
  VIZ,
} from "./primitives";

/** Extrato com mais de uma semana: o saldo pode ter mudado. */
const STALE_DAYS = 7;

const months = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${v < 2 ? "mês" : "meses"}`;

export function PositionSection({
  report,
  compareLabel,
}: {
  report: AnalyticsReport;
  compareLabel: string | null;
}) {
  const cash = useCashAvailable();
  const bank = useBankBalance();
  const reserve = useCashReserve();
  const accounts = useAccountPositions();

  const available = cash.data?.balance ?? null;
  const liquid = (reserve.data ?? []).reduce(
    (s, r) => s.add(r.position.net),
    currency(0),
  ).value;
  const burn = report.average.outflow;
  const runway = available !== null && burn > 0 ? available / burn : null;
  const runwayWithReserve =
    available !== null && burn > 0 && liquid > 0
      ? (available + liquid) / burn
      : null;

  const net = report.totals.net;
  const netDelta = report.compareTotals
    ? variation(net, report.compareTotals.net)
    : null;
  const plan = report.plan.receivable.bridge;
  const revenueShare = plan.planned ? plan.realized / plan.planned : null;

  const positions = accounts.data?.positions ?? [];
  const informed = positions.reduce((s, p) => s.add(p.balance), currency(0));
  // O patrimônio no banco soma as baixas lançadas depois do último extrato;
  // a diferença aparece como linha própria, para a lista fechar com o total.
  const afterStatement =
    bank.data && positions.length
      ? currency(bank.data.balance).subtract(informed).value
      : 0;
  const today = new Date();

  const title =
    available === null
      ? "Posição de caixa"
      : runway !== null
        ? `Caixa de ${money(available)} cobre ${months(runway)} de despesa`
        : `Caixa disponível de ${money(available)}`;

  return (
    <Section
      id="posicao"
      kicker="Posição agora"
      title={title}
      description={
        runway !== null
          ? `Despesa média paga nos últimos ${report.average.months} meses: ${money(burn)} por mês. Sem nenhuma receita nova, é por quanto tempo o caixa paga as contas.`
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {cash.isLoading ? (
          <div className="bg-card px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-6 w-32" />
          </div>
        ) : (
          <StatTile
            label="Caixa disponível"
            value={available === null ? "—" : fullMoney(available)}
            tone={available !== null && available < 0 ? "danger" : undefined}
            detail={
              available === null
                ? "Cadastre as contas correntes em Contas Bancárias."
                : `Contas correntes e aplicação automática, até ${format(cash.data!.asOf, "dd/MM")}`
            }
          />
        )}
        <StatTile
          label="Resultado do período"
          value={signedMoney(net)}
          tone={net < 0 ? "danger" : undefined}
          detail={
            report.compareTotals && compareLabel
              ? `${signedMoney(net - report.compareTotals.net)} sobre ${compareLabel}${netDelta !== null ? ` (${netDelta > 0 ? "+" : ""}${pct(netDelta)})` : ""}`
              : `Receitas ${money(report.totals.inflow)}, despesas ${money(report.totals.outflow)}`
          }
        />
        <StatTile
          label="Folga de caixa"
          value={runway === null ? "—" : months(runway)}
          tone={runway !== null && runway < 1 ? "danger" : undefined}
          detail={
            runwayWithReserve !== null
              ? `${months(runwayWithReserve)} com as aplicações de liquidez diária`
              : runway === null
                ? "Sem saldo bancário ou sem despesa paga recente."
                : "Sem aplicações de liquidez diária."
          }
        />
        <StatTile
          label="Receita realizada da prevista"
          value={revenueShare === null ? "—" : pct(revenueShare)}
          detail={
            plan.planned
              ? `${money(plan.realized)} de ${money(plan.planned)} previstos no período`
              : "Nenhuma receita prevista no período."
          }
        />
      </div>

      <div className="mt-6">
        <p className="mb-1 text-sm font-medium">Saldo por conta</p>
        {accounts.isLoading ? (
          <div className="space-y-3 py-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : accounts.isError ? (
          <p className="py-3 text-sm text-muted-foreground">
            Não foi possível ler as contas bancárias. Use Atualizar para tentar
            de novo.
          </p>
        ) : positions.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            Nenhuma conta bancária ativa. Cadastre em Cadastros, Contas
            Bancárias, para ver o saldo de cada uma aqui.
          </p>
        ) : (
          <RankedBars
            color={VIZ.in}
            items={[
              ...positions.map((p) => {
                const age = differenceInCalendarDays(today, p.date);
                return {
                  key: p.id,
                  label: p.name,
                  muted: p.investment,
                  sublabel: (
                    <span
                      className={
                        age > STALE_DAYS
                          ? "inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                          : undefined
                      }
                    >
                      {age > STALE_DAYS && (
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                      )}
                      {p.investment ? "Aplicação, " : ""}
                      {age > STALE_DAYS ? "sem extrato desde" : "saldo de"}{" "}
                      {format(p.date, "dd/MM/yyyy")}
                    </span>
                  ),
                  value: p.balance,
                  aside:
                    p.balance < 0 ? (
                      <span className="text-destructive">negativo</span>
                    ) : undefined,
                };
              }),
              ...(Math.abs(afterStatement) >= 0.01
                ? [
                    {
                      key: "after",
                      label: "Baixas lançadas depois do último extrato",
                      muted: true,
                      value: afterStatement,
                    },
                  ]
                : []),
            ]}
          />
        )}
        {bank.data && positions.length > 0 && (
          <p className="mt-2 px-2 text-xs text-muted-foreground">
            Total no banco, com todas as aplicações:{" "}
            <span className="font-financial font-medium text-foreground">
              {fullMoney(bank.data.balance)}
            </span>
          </p>
        )}
      </div>
    </Section>
  );
}
