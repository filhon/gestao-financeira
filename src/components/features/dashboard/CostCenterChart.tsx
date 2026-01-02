"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetProgressData } from "@/lib/services/dashboardService";
import { formatCurrency } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBudgetProgress } from "@/hooks/useDashboardData";

export function CostCenterChart() {
  const { data, isLoading } = useBudgetProgress();

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

  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Orçamento por Centro de Custo
        </CardTitle>
        <p className="text-xs text-muted-foreground">Mês atual</p>
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
          <div className="space-y-4 max-h-[320px] overflow-y-auto pr-2">
            {data.slice(0, 6).map((item) => (
              <div key={item.id} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    <span
                      className="font-medium truncate max-w-[120px]"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {item.status === "no-budget" ? (
                      <span className="text-muted-foreground">
                        Sem orçamento
                      </span>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "font-medium",
                            item.status === "danger" && "text-red-600",
                            item.status === "warning" && "text-amber-600",
                            item.status === "success" && "text-emerald-600"
                          )}
                        >
                          {item.percentage}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "absolute left-0 top-0 h-full rounded-full transition-all duration-500",
                      getProgressColor(item.status)
                    )}
                    style={{ width: `${Math.min(item.percentage, 100)}%` }}
                  />
                  {item.percentage > 100 && (
                    <div
                      className="absolute top-0 h-full bg-red-300 opacity-50 rounded-full"
                      style={{
                        left: "100%",
                        width: `${Math.min(item.percentage - 100, 50)}%`,
                        transform: "translateX(-100%)",
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{formatCurrency(item.spent)}</span>
                  {item.budget > 0 && (
                    <span>/ {formatCurrency(item.budget)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
