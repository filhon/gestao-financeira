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
      <div className="flex items-center gap-4">
        <Link href="/configuracoes">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          Sistema e Ferramentas
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Recalibração de Saldo
            </CardTitle>
            <CardDescription>
              Recalcule o saldo atual da empresa somando todas as transações
              pagas. Útil se houver discrepância nos valores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-amber-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-amber-800">
                    Atenção
                  </h3>
                  <div className="mt-2 text-sm text-amber-700">
                    <p>
                      Esta ação irá sobrescrever o saldo atual em cache pelo
                      valor exato da soma de todas as transações pagas. Isso
                      pode levar alguns segundos dependendo do volume de dados.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Button
              onClick={handleRecalculate}
              disabled={isRecalculating || !selectedCompany}
              className="w-full"
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

            {lastResult && (
              <div className="mt-4 rounded-md bg-green-50 p-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">
                      Sucesso
                    </h3>
                    <div className="mt-2 text-sm text-green-700">
                      <p>
                        Saldo atualizado para:{" "}
                        <span className="font-bold">
                          R${" "}
                          {lastResult.newBalance.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </p>
                      <p className="text-xs mt-1">
                        Baseado em {lastResult.transactionCount} transações.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Corrigir Filtro por Centro de Custo
            </CardTitle>
            <CardDescription>
              Corrige transações que possuem rateio de centro de custo mas não
              aparecem ao filtrar pelo centro de custo. Preenche os índices
              internos de busca.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-blue-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-blue-400" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">
                    Informação
                  </h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <p>
                      Esta ação analisa todas as transações e corrige os índices
                      de centro de custo para que o filtro funcione
                      corretamente. É seguro executar várias vezes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Button
              onClick={handleBackfillCostCenterIds}
              disabled={isMigrating || !selectedCompany}
              className="w-full"
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

            {migrationResult && (
              <div className="mt-4 rounded-md bg-green-50 p-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">
                      Concluído
                    </h3>
                    <div className="mt-2 text-sm text-green-700">
                      <p>
                        <span className="font-bold">
                          {migrationResult.updated}
                        </span>{" "}
                        transações corrigidas.
                      </p>
                      <p className="text-xs mt-1">
                        {migrationResult.total} transações analisadas no total.
                      </p>
                    </div>
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
