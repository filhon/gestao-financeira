"use client";

import { useState } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { dashboardService } from "@/lib/services/dashboardService";
import { transactionService } from "@/lib/services/transactionService";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Database,
  Wrench,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function SystemSettingsPage() {
  const { selectedCompany } = useCompany();
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [lastResult, setLastResult] = useState<{
    newBalance: number;
    transactionCount: number;
  } | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    updated: number;
    total: number;
  } | null>(null);

  const handleRecalculate = async () => {
    if (!selectedCompany) return;

    try {
      setIsRecalculating(true);
      const result = await dashboardService.recalculateBalance(
        selectedCompany.id,
      );

      if (result.success) {
        setLastResult({
          newBalance: result.newBalance,
          transactionCount: result.transactionCount,
        });
        toast.success("Saldo Recalculado", {
          description: `Novo saldo: R$ ${result.newBalance.toLocaleString(
            "pt-BR",
            { minimumFractionDigits: 2 },
          )} (${result.transactionCount} transações processadas)`,
        });
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro", {
        description: "Falha ao recalcular saldo. Tente novamente mais tarde.",
      });
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleBackfillCostCenterIds = async () => {
    if (!selectedCompany) return;

    try {
      setIsMigrating(true);
      const result = await transactionService.backfillCostCenterIds(
        selectedCompany.id,
      );

      setMigrationResult(result);

      if (result.updated > 0) {
        toast.success("Índices Corrigidos", {
          description: `${result.updated} transações corrigidas de ${result.total} analisadas.`,
        });
      } else {
        toast.success("Tudo certo!", {
          description: `Nenhuma correção necessária. ${result.total} transações verificadas.`,
        });
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro", {
        description: "Falha ao corrigir índices. Tente novamente mais tarde.",
      });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/configuracoes">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-950/60 shrink-0">
            <Wrench className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Sistema e Ferramentas
            </h1>
            <p className="text-sm text-muted-foreground">
              Manutenção, recalibração e correção de dados.
            </p>
          </div>
        </div>
      </div>

      {/* Section label */}
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        Ferramentas de Manutenção
      </h2>

      <div className="grid gap-4">
        {/* Card 1 — Recalibração de Saldo */}
        <Card
          className="border-l-4 border-l-amber-400 animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationFillMode: "both" }}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-amber-500" />
              Recalibração de Saldo
            </CardTitle>
            <CardDescription>
              Recalcule o saldo atual da empresa somando todas as transações
              pagas. Útil se houver discrepância nos valores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 p-3.5 border border-amber-100 dark:border-amber-900/50">
              <div className="flex gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Esta ação irá sobrescrever o saldo atual em cache pelo valor
                  exato da soma de todas as transações pagas. Pode levar alguns
                  segundos dependendo do volume de dados.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleRecalculate}
                disabled={isRecalculating || !selectedCompany}
                variant="outline"
                className="min-w-40"
              >
                {isRecalculating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Recalculando...
                  </>
                ) : (
                  "Recalcular Agora"
                )}
              </Button>
              {!selectedCompany && (
                <p className="text-xs text-muted-foreground">
                  Selecione uma empresa para continuar.
                </p>
              )}
            </div>

            {lastResult && (
              <div className="rounded-md bg-green-50 dark:bg-green-950/40 p-3.5 border border-green-100 dark:border-green-900/50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      Saldo atualizado para{" "}
                      <span className="font-bold">
                        R${" "}
                        {lastResult.newBalance.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400">
                      Baseado em {lastResult.transactionCount} transações.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2 — Corrigir Índices */}
        <Card
          className="border-l-4 border-l-blue-400 animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationDelay: "60ms", animationFillMode: "both" }}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-blue-500" />
              Corrigir Filtro por Centro de Custo
            </CardTitle>
            <CardDescription>
              Corrige transações que possuem rateio de centro de custo mas não
              aparecem ao filtrar pelo centro de custo. Preenche os índices
              internos de busca.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/40 p-3.5 border border-blue-100 dark:border-blue-900/50">
              <div className="flex gap-2.5">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  Analisa todas as transações e corrige os índices de centro de
                  custo para que o filtro funcione corretamente. É seguro
                  executar várias vezes.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleBackfillCostCenterIds}
                disabled={isMigrating || !selectedCompany}
                variant="outline"
                className="min-w-40"
              >
                {isMigrating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Corrigindo...
                  </>
                ) : (
                  "Corrigir Índices"
                )}
              </Button>
              {!selectedCompany && (
                <p className="text-xs text-muted-foreground">
                  Selecione uma empresa para continuar.
                </p>
              )}
            </div>

            {migrationResult && (
              <div className="rounded-md bg-green-50 dark:bg-green-950/40 p-3.5 border border-green-100 dark:border-green-900/50 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      <span className="font-bold">
                        {migrationResult.updated}
                      </span>{" "}
                      {migrationResult.updated === 1
                        ? "transação corrigida"
                        : "transações corrigidas"}
                      .
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400">
                      {migrationResult.total} transações analisadas no total.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
