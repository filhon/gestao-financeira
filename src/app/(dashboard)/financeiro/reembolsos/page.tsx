"use client";

import { useState, useEffect, useCallback } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { reimbursementReportService } from "@/lib/services/reimbursementReportService";
import { transactionService } from "@/lib/services/transactionService";
import { entityService } from "@/lib/services/entityService";
import {
  ReimbursementReport,
  ReimbursementReportStatus,
  Entity,
  Company,
} from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, Loader2, Receipt, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateReimbursementDialog } from "@/components/features/finance/reembolsos/CreateReimbursementDialog";
import { ReimbursementDetailsDialog } from "@/components/features/finance/reembolsos/ReimbursementDetailsDialog";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ReimbursementReportStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Rascunho",
    className: "bg-slate-100 text-slate-700 border-slate-300",
  },
  pending_approval: {
    label: "Aguardando Aprovação",
    className: "bg-amber-50 text-amber-700 border-amber-400",
  },
  approved: {
    label: "Aprovado",
    className: "bg-green-50 text-green-700 border-green-400",
  },
  paid: {
    label: "Pago",
    className: "bg-blue-50 text-blue-700 border-blue-400",
  },
  rejected: {
    label: "Rejeitado",
    className: "bg-red-50 text-red-700 border-red-400",
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function ReembolsosPage() {
  const { selectedCompany } = useCompany();
  const { isAdmin, isFinancialManager } = usePermissions();

  const [reports, setReports] = useState<ReimbursementReport[]>([]);
  const [individuals, setIndividuals] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState<string | null>(null);

  // Filters
  const [filterEmployee, setFilterEmployee] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedReport, setSelectedReport] =
    useState<ReimbursementReport | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const canManage = isAdmin || isFinancialManager;

  const loadData = useCallback(async () => {
    if (!selectedCompany) return;
    setIsLoading(true);
    try {
      const [reps, ents] = await Promise.all([
        reimbursementReportService.getAll(selectedCompany.id),
        entityService.getAll(selectedCompany.id),
      ]);
      setReports(reps);
      setIndividuals(ents.filter((e) => e.type === "individual"));
    } catch (err) {
      console.error("Erro ao carregar relatórios de reembolso:", err);
      toast.error("Erro ao carregar relatórios.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for download PDF event dispatched by the details dialog
  useEffect(() => {
    const handler = async (e: Event) => {
      const { reportId } = (e as CustomEvent).detail;
      const report = reports.find((r) => r.id === reportId);
      if (!report || !selectedCompany) return;

      setIsGeneratingPDF(reportId);
      try {
        const [txs, allEntities] = await Promise.all([
          transactionService.getByIds(report.transactionIds),
          entityService.getAll(selectedCompany.id),
        ]);
        const employee = allEntities.find((e) => e.id === report.employeeId);
        if (!employee) {
          toast.error("Funcionário não encontrado nos cadastros.");
          return;
        }
        const company: Company = {
          ...selectedCompany,
          createdAt: selectedCompany.createdAt ?? new Date(),
          updatedAt: selectedCompany.updatedAt ?? new Date(),
        };
        await reimbursementReportService.generatePDF(
          report,
          txs,
          employee,
          company,
        );
        toast.success("PDF gerado com sucesso!");
      } catch (err) {
        console.error(err);
        toast.error("Erro ao gerar o PDF.");
      } finally {
        setIsGeneratingPDF(null);
      }
    };

    window.addEventListener("rd:download-pdf", handler);
    return () => window.removeEventListener("rd:download-pdf", handler);
  }, [reports, selectedCompany]);

  const filteredReports = reports.filter((r) => {
    if (filterEmployee !== "all" && r.employeeId !== filterEmployee)
      return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  });

  // Summary counts
  const counts = reports.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Relatórios de Despesas
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Reembolsos de funcionários — histórico e gestão
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Relatório
          </Button>
        )}
      </div>

      {/* Summary KPIs */}
      {!isLoading && reports.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {(
            [
              "draft",
              "pending_approval",
              "approved",
              "paid",
              "rejected",
            ] as ReimbursementReportStatus[]
          ).map((status) => {
            const cfg = STATUS_CONFIG[status];
            const count = counts[status] ?? 0;
            return (
              <button
                key={status}
                onClick={() =>
                  setFilterStatus((prev) => (prev === status ? "all" : status))
                }
                className={cn(
                  "rounded-lg border p-3 text-left transition-all",
                  filterStatus === status
                    ? cfg.className
                    : "bg-card hover:bg-muted/40",
                )}
              >
                <p className="text-xs text-muted-foreground">{cfg.label}</p>
                <p className="text-2xl font-bold mt-0.5">{count}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filterEmployee} onValueChange={setFilterEmployee}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Funcionário" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Funcionários</SelectItem>
            {individuals.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Status</SelectItem>
            {(
              Object.entries(STATUS_CONFIG) as [
                ReimbursementReportStatus,
                { label: string },
              ][]
            ).map(([status, { label }]) => (
              <SelectItem key={status} value={status}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterEmployee !== "all" || filterStatus !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterEmployee("all");
              setFilterStatus("all");
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <Receipt className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-lg">
              {reports.length === 0
                ? "Nenhum relatório de despesas ainda"
                : "Nenhum resultado com os filtros aplicados"}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              {reports.length === 0
                ? 'Crie o primeiro relatório clicando em "Novo Relatório".'
                : "Tente ajustar os filtros."}
            </p>
          </div>
          {canManage && reports.length === 0 && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Relatório
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Nº
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Funcionário
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                  Período
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Itens
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Total
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  PDF
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredReports.map((r, i) => {
                const cfg = STATUS_CONFIG[r.status];
                const isDownloading = isGeneratingPDF === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => {
                      setSelectedReport(r);
                      setDetailsOpen(true);
                    }}
                    className={cn(
                      "border-b last:border-b-0 cursor-pointer hover:bg-muted/30 transition-colors",
                      i % 2 === 0 ? "bg-background" : "bg-muted/10",
                    )}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-xs">
                      {r.rdNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[140px]">
                        {r.employeeName}
                      </p>
                      {r.employeeDocument && (
                        <p className="text-xs text-muted-foreground">
                          {r.employeeDocument}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                      {format(r.periodStart, "dd/MM/yy", { locale: ptBR })} —{" "}
                      {format(r.periodEnd, "dd/MM/yy", { locale: ptBR })}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground hidden md:table-cell">
                      {r.transactionIds.length}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                      {formatCurrency(r.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs px-2 py-0.5 whitespace-nowrap",
                          cfg.className,
                        )}
                      >
                        {cfg.label}
                      </Badge>
                    </td>
                    <td
                      className="px-4 py-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={isDownloading}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!selectedCompany) return;
                          setIsGeneratingPDF(r.id);
                          try {
                            const [txs, allEnts] = await Promise.all([
                              transactionService.getByIds(r.transactionIds),
                              entityService.getAll(selectedCompany.id),
                            ]);
                            const emp = allEnts.find(
                              (en) => en.id === r.employeeId,
                            );
                            if (!emp) {
                              toast.error("Funcionário não encontrado.");
                              return;
                            }
                            const company: Company = {
                              ...selectedCompany,
                              createdAt:
                                selectedCompany.createdAt ?? new Date(),
                              updatedAt:
                                selectedCompany.updatedAt ?? new Date(),
                            };
                            await reimbursementReportService.generatePDF(
                              r,
                              txs,
                              emp,
                              company,
                            );
                            toast.success("PDF gerado!");
                          } catch (err) {
                            console.error(err);
                            toast.error("Erro ao gerar PDF.");
                          } finally {
                            setIsGeneratingPDF(null);
                          }
                        }}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialogs */}
      <CreateReimbursementDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={loadData}
      />

      <ReimbursementDetailsDialog
        report={selectedReport}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setSelectedReport(null);
        }}
        onUpdated={() => {
          loadData();
          // Refresh selectedReport from fresh data
          if (selectedReport) {
            reimbursementReportService
              .getById(selectedReport.id)
              .then((r) => r && setSelectedReport(r));
          }
        }}
      />
    </div>
  );
}
