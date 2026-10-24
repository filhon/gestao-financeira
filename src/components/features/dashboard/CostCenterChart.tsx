"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "./Segmented";
import { BudgetProgressData } from "@/lib/services/dashboardService";
import { envelopePace } from "@/lib/dashboardRules";
import { cn, formatCurrency, formatCurrencyAbbr } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCcw,
} from "lucide-react";
import { useBudgetProgress } from "@/hooks/useDashboardData";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Cor só para o que pede atenção; o estado normal é neutro (verde diria
// "está ótimo" quando só significa "nada a sinalizar").
const barColor = (item: BudgetProgressData) =>
  item.status === "danger"
    ? "bg-red-500"
    : item.status === "warning"
      ? "bg-amber-500"
      : item.status === "no-budget"
        ? "bg-muted-foreground/30"
        : item.isLeaf
          ? "bg-foreground/60"
          : "bg-muted-foreground/40";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const money = formatCurrencyAbbr;

/** Texto que acompanha a cor, para o estado não depender só dela. */
function statusText(item: BudgetProgressData) {
  if (item.status === "no-budget") return "Sem envelope";
  if (item.status === "danger")
    return item.budget === 0
      ? "Gasto sem envelope"
      : `${item.percentage}% · estourou`;
  if (item.tight) return `${item.percentage}% · sem folga para novas despesas`;
  if (item.status === "warning")
    return `Pago ${item.paidPercentage}% · acima do ritmo`;
  if (!item.isLeaf) return `${item.percentage}% distribuído`;
  if (item.exhausted) return "Esgotado · tudo pago";
  return item.percentage >= 100
    ? "100% · sem folga"
    : `${item.percentage}% comprometido`;
}

function EnvelopeRow({
  item,
  pace,
}: {
  item: BudgetProgressData;
  pace: number | null;
}) {
  // A escala cresce além de 100% para o excedente aparecer: 140% não pode
  // parecer igual a 100%.
  const scale = Math.max(100, item.percentage);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const over = item.spent - item.budget;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${item.name}: ${statusText(item)}. ${
            item.isLeaf ? `${formatCurrency(item.paid)} pago, ` : ""
          }envelope ${formatCurrency(item.budget)}, disponível ${formatCurrency(item.available)}. Ver detalhes`}
          className={cn(
            "block w-full space-y-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50",
            focusRing,
          )}
        >
          <span className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              {item.status === "danger" && (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
              )}
              {item.status === "warning" && (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              <span className="truncate font-medium" title={item.name}>
                {item.name}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-xs font-medium font-financial",
                item.status === "danger" && "text-red-700 dark:text-red-400",
                item.status === "warning" &&
                  "text-amber-700 dark:text-amber-400",
                (item.status === "success" || item.status === "no-budget") &&
                  "text-muted-foreground",
              )}
            >
              {statusText(item)}
            </span>
          </span>
          <span className="relative block h-2 w-full overflow-hidden rounded-full bg-muted">
            {/* Folha: comprometido claro por baixo, pago sólido por cima. */}
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                barColor(item),
                item.isLeaf && "opacity-35",
              )}
              style={{ width: pct(item.percentage) }}
            />
            {item.isLeaf && item.paid > 0 && (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  barColor(item),
                )}
                style={{ width: pct(item.paidPercentage) }}
              />
            )}
            {item.percentage > 100 && (
              <span
                className="absolute inset-y-0 w-0.5 bg-background"
                style={{ left: pct(100) }}
                aria-hidden
              />
            )}
            {item.isLeaf && pace !== null && item.status !== "no-budget" && (
              <span
                className="absolute inset-y-0 w-0.5 bg-foreground/70"
                style={{ left: pct(pace) }}
                aria-hidden
              />
            )}
          </span>
          <span className="flex justify-between gap-2 text-xs text-muted-foreground font-financial">
            <span className="min-w-0 truncate">
              {item.isLeaf
                ? `${money(item.paid)} pago`
                : `${money(item.spent)} distribuído`}
              {item.budget > 0 && ` · envelope ${money(item.budget)}`}
            </span>
            {item.budget > 0 && (
              <span
                className={cn(
                  "shrink-0",
                  over > 0 && "text-red-700 dark:text-red-400",
                )}
              >
                {over > 0
                  ? `excedente ${money(over)}`
                  : `disponível ${money(item.available)}`}
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <p className="font-medium leading-none">{item.name}</p>
        <dl className="mt-3 space-y-1.5 border-t pt-3 text-xs font-financial">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Envelope do exercício</dt>
            <dd>{formatCurrency(item.budget)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Comprometido em despesas</dt>
            <dd>{formatCurrency(item.spentDirect)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Já pago</dt>
            <dd>{formatCurrency(item.paid)}</dd>
          </div>
          {!item.isLeaf && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Distribuído aos filhos</dt>
              <dd>{formatCurrency(item.allocated)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-1.5 font-medium">
            <dt>Disponível</dt>
            <dd className={cn(item.available < 0 && "text-destructive")}>
              {formatCurrency(item.available)}
            </dd>
          </div>
        </dl>
        {item.isLeaf && pace !== null && item.budget > 0 && (
          <p className="mt-3 rounded bg-muted p-2 text-xs">
            {item.exhausted
              ? `Tudo o que foi comprometido já foi pago e não há saldo, com ${Math.round(100 - pace)}% do exercício pela frente.`
              : item.tight
                ? `Restam ${formatCurrency(item.available)} com ${Math.round(100 - pace)}% do exercício pela frente: a próxima despesa acima disso será recusada.`
                : item.status === "warning"
                  ? `Pagou ${item.paidPercentage}% do envelope com ${Math.round(pace)}% do exercício decorrido.`
                  : `Pagamentos dentro do ritmo: ${item.paidPercentage}% do envelope com ${Math.round(pace)}% do exercício decorrido.`}
          </p>
        )}
        <Link
          href={`/centros-custo/${item.id}`}
          className={cn(
            "mt-3 inline-flex items-center gap-1 rounded text-xs font-medium hover:underline",
            focusRing,
          )}
        >
          Abrir centro de custo <ArrowRight className="h-3 w-3" />
        </Link>
        {item.tight && (
          <Link
            href="/centros-custo/distribuicao"
            className={cn(
              "mt-1 flex items-center gap-1 rounded text-xs font-medium hover:underline",
              focusRing,
            )}
          >
            Redistribuir envelopes <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function CostCenterChart({ year }: { year?: number }) {
  const exercise = year ?? new Date().getFullYear();
  const { data, isLoading, isError, error, refetch } =
    useBudgetProgress(exercise);
  const [view, setView] = useState<"risk" | "volume">("risk");
  const [showAll, setShowAll] = useState(false);
  const pace = envelopePace(exercise);
  // Lista curta por padrão, com o resto atrás de um botão que diz quantos
  // faltam: rolagem interna esconderia centros sem avisar.
  const VISIBLE = 5;
  const rows = data ? (showAll ? data : data.slice(0, VISIBLE)) : [];
  const hiddenCount = (data?.length ?? 0) - VISIBLE;

  // No volume, só folhas: o comprometido dos pais já inclui o dos filhos.
  const volumeData = (data ?? [])
    .filter((d) => d.isLeaf && d.status !== "no-budget")
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 8);

  return (
    <Card
      id="envelopes"
      className="col-span-full flex scroll-mt-20 flex-col md:col-span-3"
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle
            role="heading"
            aria-level={2}
            className="text-sm md:text-base font-medium leading-tight"
          >
            Envelope por centro de custo
          </CardTitle>
          <Segmented
            label="Visão do envelope"
            value={view}
            onChange={setView}
            options={[
              { value: "risk", label: "Consumo %" },
              { value: "volume", label: "Volume R$" },
            ]}
          />
        </div>
        <div className="flex min-h-4 items-center justify-between text-xs text-muted-foreground">
          <span>Exercício {exercise}</span>
          {view === "risk" && (
            <span className="flex items-center gap-3" aria-hidden>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded-sm bg-foreground/60" />
                pago
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded-sm bg-foreground/60 opacity-35" />
                comprometido
              </span>
              {pace !== null && pace < 100 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-0.5 bg-foreground/70" />
                  ritmo {Math.round(pace)}%
                </span>
              )}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <p className="max-w-xs text-sm text-muted-foreground">
              {/* Só a mensagem de hierarquia é escrita para o usuário; o resto
                  (erros do Firestore) vem em inglês técnico. */}
              {error instanceof Error && error.message.startsWith("Hierarquia")
                ? error.message
                : "Não foi possível calcular os envelopes. Tente novamente em instantes."}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => refetch()}
              >
                <RefreshCcw className="mr-1.5 h-3 w-3" />
                Tentar novamente
              </Button>
              <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
                <Link href="/centros-custo">Abrir centros de custo</Link>
              </Button>
            </div>
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            Nenhum centro de custo cadastrado.
            <Link
              href="/centros-custo"
              className="text-xs font-medium text-foreground hover:underline"
            >
              Cadastrar centros de custo
            </Link>
          </div>
        ) : view === "risk" ? (
          <div className="-mx-2 space-y-1">
            {rows.map((item) => (
              <EnvelopeRow key={item.id} item={item} pace={pace} />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
                className={cn(
                  "mx-2 rounded text-xs font-medium text-muted-foreground hover:text-foreground",
                  focusRing,
                )}
              >
                {showAll
                  ? "Mostrar menos"
                  : `Mostrar mais ${hiddenCount} ${hiddenCount === 1 ? "centro" : "centros"}`}
              </button>
            )}
          </div>
        ) : volumeData.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            Nenhum centro de último grau com envelope.
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={volumeData}
                layout="vertical"
                margin={{ top: 5, right: 8, left: 0, bottom: 5 }}
                barGap={-16}
              >
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrencyAbbr}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={110}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as BudgetProgressData;
                    return (
                      <div className="rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-sm">
                        <p className="mb-1 font-semibold">{d.name}</p>
                        <p className="font-financial">
                          Pago: {formatCurrency(d.paid)}
                        </p>
                        <p className="font-financial">
                          Comprometido: {formatCurrency(d.spent)}
                        </p>
                        <p className="font-financial">
                          Envelope: {formatCurrency(d.budget)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="budget"
                  fill="var(--muted)"
                  radius={[0, 4, 4, 0]}
                  barSize={16}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="spent"
                  radius={[0, 4, 4, 0]}
                  barSize={16}
                  isAnimationActive={false}
                >
                  {volumeData.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={
                        entry.spent > entry.budget
                          ? "var(--destructive)"
                          : // Mesmo cinza do modo Consumo: comprometido
                            // tem uma cor só no painel.
                            "var(--muted-foreground)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!isLoading && !isError && data && data.length > 0 && (
          <div className="mt-auto self-end pt-3">
            <Link
              href="/centros-custo"
              className={cn(
                "inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground",
                focusRing,
              )}
            >
              Ver todos os centros <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
