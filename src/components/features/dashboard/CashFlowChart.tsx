"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProjectedCashFlowData } from "@/lib/services/dashboardService";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calendar, Maximize2, Minimize2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useProjectedCashFlow } from "@/hooks/useDashboardData";

export function CashFlowChart() {
  const [mode, setMode] = useState<"30days" | "year">("30days");
  const { data, isLoading } = useProjectedCashFlow(mode);

  // Calculate min balance for the reference line
  const minBalance =
    data && data.length > 0 ? Math.min(...data.map((d) => d.balance)) : 0;
  const hasNegative = minBalance < 0;

  // Custom gradient ID for the area
  const gradientId = "cashFlowGradient";

  return (
    <Card className="col-span-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">
          Fluxo de Caixa Projetado
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant={mode === "30days" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("30days")}
            className="h-8 text-xs"
          >
            <Calendar className="mr-1 h-3 w-3" />
            30 dias
          </Button>
          <Button
            variant={mode === "year" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("year")}
            className="h-8 text-xs"
          >
            {mode === "year" ? (
              <Minimize2 className="mr-1 h-3 w-3" />
            ) : (
              <Maximize2 className="mr-1 h-3 w-3" />
            )}
            Ano Completo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pl-2">
        {isLoading ? (
          <div className="flex h-[350px] items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart
              data={data}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                stroke="#888888"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                interval={mode === "year" ? 3 : 2}
              />
              <YAxis
                stroke="#888888"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => {
                  if (Math.abs(value) >= 1000) {
                    return `R$${(value / 1000).toFixed(0)}k`;
                  }
                  return `R$${value}`;
                }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as ProjectedCashFlowData;
                    return (
                      <div className="rounded-lg border bg-popover p-3 shadow-md">
                        <p className="text-sm font-medium text-popover-foreground">
                          {label}
                        </p>
                        <div className="mt-2 space-y-1">
                          <p className="text-sm">
                            <span className="text-muted-foreground">
                              Saldo:{" "}
                            </span>
                            <span
                              className={
                                data.balance >= 0
                                  ? "text-emerald-600 font-medium"
                                  : "text-red-600 font-medium"
                              }
                            >
                              {formatCurrency(data.balance)}
                            </span>
                          </p>
                          {data.income > 0 && (
                            <p className="text-xs text-emerald-600">
                              + {formatCurrency(data.income)} receitas
                            </p>
                          )}
                          {data.expense > 0 && (
                            <p className="text-xs text-red-600">
                              - {formatCurrency(data.expense)} despesas
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Reference line at zero */}
              <ReferenceLine y={0} stroke="#888888" strokeDasharray="3 3" />
              {/* Danger zone indication if negative balance */}
              {hasNegative && (
                <ReferenceLine
                  y={0}
                  stroke="#ef4444"
                  strokeWidth={2}
                  label={{
                    value: "Saldo Zero",
                    position: "right",
                    fill: "#ef4444",
                    fontSize: 10,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{
                  r: 6,
                  fill: "#3b82f6",
                  stroke: "#fff",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
