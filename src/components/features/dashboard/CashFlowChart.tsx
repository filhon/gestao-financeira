"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  AlertTriangle,
  Calendar,
  FlaskConical,
  Maximize2,
  Minimize2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useProjectedCashFlow } from "@/hooks/useDashboardData";
import { format, parseISO } from "date-fns";

// ─── Simulated entry type (lightweight — no need for full Transaction fields) ─
interface SimulatedEntry {
  id: string;
  amount: number;
  type: "receivable" | "payable";
  date: string; // "yyyy-MM-dd"
}

// Extended point type — adds simulatedBalance alongside the original balance.
type ChartPoint = ProjectedCashFlowData & { simulatedBalance?: number };

// Annotates each data point with `simulatedBalance` (real balance + cumulative
// simulation delta). The original `balance` field is left untouched so both
// lines can be rendered simultaneously in the same AreaChart.
function annotateWithSimulations(
  data: ProjectedCashFlowData[],
  simulations: SimulatedEntry[],
): ChartPoint[] {
  if (simulations.length === 0) return data;

  // Determine which label format the chart uses ("dd/MM" vs. "MMM")
  const usesMonthFormat =
    data.length > 0 && /^[A-Za-z]/.test(data[0]?.date ?? "");

  // Build a lookup: chartDateLabel → net delta per slot
  const deltas = new Map<string, number>();
  for (const sim of simulations) {
    const d = parseISO(sim.date);
    const key = usesMonthFormat ? format(d, "MMM") : format(d, "dd/MM");
    const sign = sim.type === "receivable" ? 1 : -1;
    deltas.set(key, (deltas.get(key) ?? 0) + sign * sim.amount);
  }

  // Walk through data points accumulating the delta into simulatedBalance
  let cumulativeDelta = 0;
  return data.map((point) => {
    const delta = deltas.get(point.date);
    if (delta !== undefined) cumulativeDelta += delta;
    return {
      ...point,
      simulatedBalance: point.balance + cumulativeDelta,
    };
  });
}

// ─── Component ───────────────────────────────────────────────────────────────
export function CashFlowChart({ year }: { year?: number }) {
  const [mode, setMode] = useState<"30days" | "year">("30days");
  const { data: result, isLoading } = useProjectedCashFlow(mode, year);

  // Simulation state
  const [simulatedTransactions, setSimulatedTransactions] = useState<
    SimulatedEntry[]
  >([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Form state inside the popover
  const [formAmount, setFormAmount] = useState("");
  const [formType, setFormType] = useState<"receivable" | "payable">(
    "receivable",
  );
  // Default date = today
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [formDate, setFormDate] = useState(todayStr);

  const hasCompanyStats = result?.hasCompanyStats ?? true;

  // Annotate each point with `simulatedBalance` while keeping `balance` intact.
  // Use result?.data as the stable dependency — the `?? []` fallback lives inside
  // the callback so a new empty array is NOT created on every render.
  const data = useMemo(
    () => annotateWithSimulations(result?.data ?? [], simulatedTransactions),
    [result?.data, simulatedTransactions],
  );

  const isSimulating = simulatedTransactions.length > 0;

  // Compute min across both balance and simulatedBalance for the red reference line
  const minBalance =
    data.length > 0
      ? Math.min(
          ...data.map((d) =>
            Math.min(d.balance, d.simulatedBalance ?? d.balance),
          ),
        )
      : 0;
  const hasNegative = minBalance < 0;

  // ── Handlers ──
  function addSimulation() {
    const amt = parseFloat(formAmount.replace(",", "."));
    if (isNaN(amt) || amt <= 0 || !formDate) return;

    const entry: SimulatedEntry = {
      id: crypto.randomUUID(),
      amount: amt,
      type: formType,
      date: formDate,
    };
    setSimulatedTransactions((prev) => [...prev, entry]);
    setFormAmount("");
    setFormDate(todayStr);
    setPopoverOpen(false);
  }

  function removeSimulation(id: string) {
    setSimulatedTransactions((prev) => prev.filter((s) => s.id !== id));
  }

  function clearAll() {
    setSimulatedTransactions([]);
  }

  return (
    <Card className="col-span-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium">
            Fluxo de Caixa Projetado
          </CardTitle>
          {isSimulating && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-950/50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-400">
              <FlaskConical className="h-3 w-3" />
              Simulação
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Simulation button + popover */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-dashed"
              >
                <Plus className="mr-1 h-3 w-3" />
                Adicionar Simulação
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="end">
              <p className="text-sm font-semibold mb-3">Nova simulação</p>
              <div className="space-y-3">
                {/* Amount */}
                <div className="space-y-1">
                  <Label htmlFor="sim-amount" className="text-xs">
                    Valor (R$)
                  </Label>
                  <Input
                    id="sim-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                {/* Type */}
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={formType}
                    onValueChange={(v) =>
                      setFormType(v as "receivable" | "payable")
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receivable">
                        <span className="text-emerald-600 font-medium">
                          ↑ Entrada
                        </span>
                      </SelectItem>
                      <SelectItem value="payable">
                        <span className="text-red-600 font-medium">
                          ↓ Saída
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date */}
                <div className="space-y-1">
                  <Label htmlFor="sim-date" className="text-xs">
                    Data de vencimento
                  </Label>
                  <Input
                    id="sim-date"
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <Button
                  className="w-full h-8 text-xs"
                  onClick={addSimulation}
                  disabled={!formAmount || !formDate}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Adicionar
                </Button>
              </div>

              {/* List of existing simulations */}
              {simulatedTransactions.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground font-medium">
                      Simulações ativas
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1 text-[10px] text-muted-foreground hover:text-destructive"
                      onClick={clearAll}
                    >
                      Limpar todas
                    </Button>
                  </div>
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {simulatedTransactions.map((sim) => (
                      <li
                        key={sim.id}
                        className="flex items-center justify-between text-xs rounded-md bg-muted/50 px-2 py-1.5"
                      >
                        <span
                          className={
                            sim.type === "receivable"
                              ? "text-emerald-600 font-medium"
                              : "text-red-600 font-medium"
                          }
                        >
                          {sim.type === "receivable" ? "+" : "−"}
                          {formatCurrency(sim.amount)}
                        </span>
                        <span className="text-muted-foreground mx-2">
                          {format(parseISO(sim.date), "dd/MM")}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSimulation(sim.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Clear simulations shortcut (outside popover) */}
          {isSimulating && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              title="Limpar simulações"
              onClick={clearAll}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* Mode toggle buttons */}
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
        {!hasCompanyStats && !isLoading && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs rounded-md px-3 py-2 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Saldo base calculado a partir de R$0,00. Recalcule o saldo para
              projeções mais precisas.
            </span>
          </div>
        )}
        {isSimulating && !isLoading && (
          <div className="flex items-center gap-2 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 text-xs rounded-md px-3 py-2 mb-2">
            <FlaskConical className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Exibindo projeção com{" "}
              <strong>{simulatedTransactions.length}</strong>{" "}
              {simulatedTransactions.length === 1
                ? "transação simulada"
                : "transações simuladas"}
              . Os dados reais não são afetados.
            </span>
          </div>
        )}
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
                {/* Real balance gradient — always blue */}
                <linearGradient id="cfGradientReal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.04} />
                </linearGradient>
                {/* Simulated balance gradient — violet, shown only when simulating */}
                <linearGradient id="cfGradientSim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
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
                    const point = payload[0].payload as ChartPoint;
                    return (
                      <div className="rounded-lg border bg-popover p-3 shadow-md min-w-[176px]">
                        <p className="text-sm font-medium text-popover-foreground mb-2">
                          {label}
                        </p>
                        {/* Real balance row */}
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="inline-block h-2 w-4 rounded-sm bg-blue-500" />
                            Real
                          </span>
                          <span
                            className={
                              point.balance >= 0
                                ? "text-emerald-600 font-medium text-xs"
                                : "text-red-600 font-medium text-xs"
                            }
                          >
                            {formatCurrency(point.balance)}
                          </span>
                        </div>
                        {/* Simulated balance row — only when a simulation is active */}
                        {isSimulating && point.simulatedBalance !== undefined && (
                          <div className="flex items-center justify-between gap-3 mt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="inline-block h-2 w-4 rounded-sm bg-violet-500 opacity-70" style={{ background: 'repeating-linear-gradient(90deg,#8b5cf6 0,#8b5cf6 3px,transparent 3px,transparent 8px)' }} />
                              Simulado
                            </span>
                            <span
                              className={
                                point.simulatedBalance >= 0
                                  ? "text-violet-600 font-medium text-xs"
                                  : "text-red-500 font-medium text-xs"
                              }
                            >
                              {formatCurrency(point.simulatedBalance)}
                            </span>
                          </div>
                        )}
                        {/* Income / expense detail */}
                        {(point.income > 0 || point.expense > 0) && (
                          <div className="mt-2 pt-2 border-t space-y-0.5">
                            {point.income > 0 && (
                              <p className="text-xs text-emerald-600">
                                + {formatCurrency(point.income)} receitas
                              </p>
                            )}
                            {point.expense > 0 && (
                              <p className="text-xs text-red-600">
                                − {formatCurrency(point.expense)} despesas
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine y={0} stroke="#888888" strokeDasharray="3 3" />
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
              {/* ── Real balance line — always rendered, always blue ── */}
              <Area
                type="monotone"
                dataKey="balance"
                name="Real"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#cfGradientReal)"
                dot={false}
                activeDot={{ r: 5, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }}
              />
              {/* ── Simulated balance line — violet dashed, only when simulating ── */}
              {isSimulating && (
                <Area
                  type="monotone"
                  dataKey="simulatedBalance"
                  name="Simulado"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  fill="url(#cfGradientSim)"
                  dot={false}
                  activeDot={{ r: 5, fill: "#8b5cf6", stroke: "#fff", strokeWidth: 2 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

