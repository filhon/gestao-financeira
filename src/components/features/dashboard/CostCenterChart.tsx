"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BudgetProgressData } from "@/lib/services/dashboardService";
import { formatCurrency } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { getDaysInMonth, getDate } from "date-fns";

export function CostCenterChart({ year }: { year?: number }) {
  const { data, isLoading } = useBudgetProgress(year);
  const [view, setView] = useState("risk");

  const today = new Date();
  const currentDay = getDate(today);
  const totalDays = getDaysInMonth(today);
  const monthProgress = (currentDay / totalDays) * 100;

  const getStatusIcon = (status: BudgetProgressData["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "danger":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getProgressColor = (status: BudgetProgressData["status"]) => {
    switch (status) {
      case "success":
        return "bg-emerald-500";
      case "warning":
        return "bg-amber-500";
      case "danger":
        return "bg-red-500";
      default:
        return "bg-muted-foreground";
    }
  };

  const isBurningTooFast = (percentage: number) => {
    // Se gastou 10% a mais do que o tempo decorrido do mês
    // Só faz sentido se tiver orçamento
    return percentage > monthProgress + 10;
  };

  // Sort for Volume view (highest budget or spent first, let's say spent)
  const volumeData = data
    ? [...data].sort((a, b) => b.spent - a.spent).slice(0, 6)
    : [];

  return (
    <Card className="col-span-full md:col-span-3">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm md:text-base font-medium leading-tight">
            Orçamento por
            <br className="sm:hidden" /> Centro de Custo
          </CardTitle>
          <Tabs
            value={view}
            onValueChange={setView}
            className="w-[140px] md:w-40 shrink-0"
          >
            <TabsList className="grid w-full grid-cols-2 h-7 md:h-8">
              <TabsTrigger
                value="risk"
                className="text-[10px] md:text-xs h-5 md:h-6"
              >
                Risco %
              </TabsTrigger>
              <TabsTrigger
                value="volume"
                className="text-[10px] md:text-xs h-5 md:h-6"
              >
                Volume R$
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex justify-between items-center text-xs text-muted-foreground min-h-4">
          <span>Mês atual</span>
          {view === "risk" && (
            <span
              className="flex items-center gap-1 text-amber-600 font-medium opacity-80"
              title={`Progresso do mês: ${Math.round(monthProgress)}%`}
            >
              <TrendingUp className="h-3 w-3" /> Ritmo Esperado:{" "}
              {Math.round(monthProgress)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            Nenhum centro de custo encontrado.
          </div>
        ) : (
          <div className="h-80">
            {view === "risk" ? (
              <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                {data.slice(0, 6).map((item) => (
                  <Popover key={item.id}>
                    <PopoverTrigger asChild>
                      <div className="space-y-2 cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors group">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {getStatusIcon(item.status)}
                            <span
                              className="font-medium truncate"
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            {isBurningTooFast(item.percentage) &&
                              item.status !== "no-budget" && (
                                <span
                                  title="Ritmo de gastos acima do tempo decorrido no mês"
                                  className="shrink-0"
                                >
                                  <TrendingUp className="h-3 w-3 text-red-500 animate-pulse" />
                                </span>
                              )}
                          </div>
                          <div className="flex items-center gap-2 text-xs shrink-0">
                            {item.status === "no-budget" ? (
                              <span className="text-muted-foreground">
                                Sem orçamento
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  "font-medium",
                                  item.status === "danger" && "text-red-600",
                                  item.status === "warning" && "text-amber-600",
                                  item.status === "success" &&
                                    "text-emerald-600",
                                )}
                              >
                                {item.percentage}%
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "absolute left-0 top-0 h-full rounded-full transition-all duration-500",
                              getProgressColor(item.status),
                            )}
                            style={{
                              width: `${Math.min(item.percentage, 100)}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground group-hover:text-foreground transition-colors font-financial">
                          <span>{formatCurrency(item.spent)}</span>
                          {item.budget > 0 && (
                            <span>meta: {formatCurrency(item.budget)}</span>
                          )}
                        </div>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-64">
                      <div className="space-y-2">
                        <h4 className="font-medium leading-none">
                          {item.name}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          Detalhamento rápido
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-sm mt-3 pt-3 border-t">
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase text-muted-foreground">
                              Realizado
                            </span>
                            <span className="font-bold font-financial text-red-600">
                              {formatCurrency(item.spent)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase text-muted-foreground">
                              Orçamento
                            </span>
                            <span className="font-bold font-financial text-emerald-600">
                              {formatCurrency(item.budget)}
                            </span>
                          </div>
                        </div>
                        <div className="bg-muted p-2 rounded text-xs text-center mt-2">
                          {item.percentage > monthProgress ? (
                            <span className="text-amber-600 flex items-center justify-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Atenção: Consumo acelerado
                            </span>
                          ) : (
                            <span className="text-emerald-600 flex items-center justify-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Consumo dentro do prazo
                            </span>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={volumeData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={80}
                    tick={{ fontSize: 10 }}
                    interval={0}
                  />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-popover border text-popover-foreground shadow-sm rounded-lg p-2 text-xs">
                            <p className="font-semibold mb-1">{data.name}</p>
                            <p className="font-financial">
                              Realizado: {formatCurrency(data.spent)}
                            </p>
                            <p className="font-financial">
                              Orçado: {formatCurrency(data.budget)}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="budget"
                    fill="#f4f4f5"
                    radius={[0, 4, 4, 0]}
                    barSize={20}
                    stackId="a"
                  />
                  <Bar
                    dataKey="spent"
                    radius={[0, 4, 4, 0]}
                    barSize={20}
                    stackId="b"
                  >
                    {volumeData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.spent > entry.budget ? "#ef4444" : "#3b82f6"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
