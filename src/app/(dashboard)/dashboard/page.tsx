"use client";

import { useState } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";
import { KPICards } from "@/components/features/dashboard/KPICards";
import { ActionQueue } from "@/components/features/dashboard/ActionQueue";
import { CashAlert } from "@/components/features/dashboard/CashAlert";
import { CashFlowChart } from "@/components/features/dashboard/CashFlowChart";
import { CostCenterChart } from "@/components/features/dashboard/CostCenterChart";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DASHBOARD_QUERY_KEYS,
  useActionQueue,
  useDashboardMetrics,
  useRelatedPartyIds,
  useProjectedCashFlow,
} from "@/hooks/useDashboardData";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";

// ─── Skeletons ────────────────────────────────────────────────────────────────

function KPICardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2 bg-card px-4 py-3 sm:px-5 sm:py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ─── Section-level error ──────────────────────────────────────────────────────

/** A causa provável, em vez de sempre culpar a conexão. */
function errorHint(error: unknown) {
  const code = (error as { code?: string } | null)?.code ?? "";
  if (code.includes("permission-denied"))
    return "Seu perfil não tem permissão para ver estes dados.";
  if (code.includes("failed-precondition"))
    return "Um índice do banco de dados está faltando ou ainda sendo criado. Tente de novo em alguns minutos.";
  if (code.includes("unavailable"))
    return "Sem conexão com o servidor. Verifique sua internet.";
  return "Tente novamente. Se persistir, avise o suporte.";
}

function SectionError({
  onRetry,
  label,
  error,
}: {
  onRetry: () => void;
  label: string;
  error: unknown;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">Falha ao carregar {label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {errorHint(error)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 text-xs"
        >
          <RefreshCcw className="mr-1.5 h-3 w-3" />
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  const metrics = useDashboardMetrics(selectedYear);
  const queue = useActionQueue();
  // Mesma consulta (mesma chave de cache) que o gráfico usa no modo 30 dias:
  // KPI, alerta e gráfico leem a mesma série.
  const projection = useProjectedCashFlow("30days");
  const relatedPartyIds = useRelatedPartyIds();

  const queryClient = useQueryClient();
  const isDashboardQuery = (key: unknown) =>
    DASHBOARD_QUERY_KEYS.includes(key as string);
  const isFetching =
    useIsFetching({ predicate: (q) => isDashboardQuery(q.queryKey[0]) }) > 0;
  // O horário mostrado é o da consulta mais antiga entre as do painel,
  // inclusive as dos gráficos. `isFetching` re-renderiza a página a cada
  // busca, então o valor acompanha.
  const updatedAt = Math.min(
    ...queryClient
      .getQueryCache()
      .findAll({ predicate: (q) => isDashboardQuery(q.queryKey[0]) })
      .map((q) => q.state.dataUpdatedAt)
      .filter((t) => t > 0),
  );

  // Inclui o próximo exercício: o planejamento dos envelopes começa antes da
  // virada.
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i);

  // Recalculado a cada render: um useMemo fixaria a data depois da meia-noite.
  const todayLabel = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", {
    locale: ptBR,
  });

  function handleRefreshAll() {
    DASHBOARD_QUERY_KEYS.forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
            Dashboard
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5 first-letter:uppercase">
            {todayLabel}
            {Number.isFinite(updatedAt) &&
              ` · atualizado às ${format(updatedAt, "HH:mm")}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            onClick={handleRefreshAll}
            disabled={isFetching}
            aria-label="Atualizar dados"
            title="Atualizar dados"
          >
            <RefreshCcw
              className={cn("h-4 w-4", isFetching && "animate-spin")}
            />
          </Button>
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(Number(v))}
          >
            <SelectTrigger className="h-9 w-[150px]" aria-label="Exercício">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  Exercício {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Fila do dia ────────────────────────────────────────────── */}
      <section aria-labelledby="fila-titulo" className="space-y-3">
        <h2 id="fila-titulo" className="text-sm font-semibold">
          Para resolver hoje
        </h2>
        <CashAlert
          projection={projection.data}
          projectionFailed={projection.isError}
          onRetry={() => projection.refetch()}
          receivables={queue.data?.find((s) => s.id === "receivable-overdue")}
          relatedPartyIds={relatedPartyIds}
        />
        {queue.isLoading ? (
          // Uma faixa só: o número de seções só se sabe depois de carregar.
          <Skeleton className="h-44 rounded-xl" />
        ) : queue.isError ? (
          <SectionError
            onRetry={() => queue.refetch()}
            label="a fila do dia"
            error={queue.error}
          />
        ) : (
          <ActionQueue
            sections={queue.data ?? []}
            relatedPartyIds={relatedPartyIds}
          />
        )}
      </section>

      {/* ── Indicadores ────────────────────────────────────────────── */}
      <section aria-label="Indicadores" className="space-y-3">
        {selectedYear !== currentYear && (
          <p className="text-xs text-muted-foreground">
            Recebido, pago e envelopes mostram o exercício {selectedYear}. A
            fila, o saldo previsto e o alerta de saldo olham sempre para hoje.
          </p>
        )}
        {metrics.isLoading ? (
          <KPICardsSkeleton />
        ) : metrics.isError ? (
          <SectionError
            onRetry={() => metrics.refetch()}
            label="os indicadores"
            error={metrics.error}
          />
        ) : (
          metrics.data && (
            <KPICards
              metrics={metrics.data}
              projection={projection.data}
              projectionLoading={projection.isLoading}
            />
          )
        )}
      </section>

      {/* ── Gráficos ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-7">
        <CashFlowChart year={selectedYear} />
        <CostCenterChart year={selectedYear} />
      </div>
    </div>
  );
}
