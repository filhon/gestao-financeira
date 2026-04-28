import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { PaymentBatch, Transaction } from "@/lib/types";
import { useEffect, useState, useCallback } from "react";
import { transactionService } from "@/lib/services/transactionService";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import {
  Loader2,
  Download,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  PackageOpen,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Workbook, Style } from "exceljs";
import { useAuth } from "@/components/providers/AuthProvider";
import { costCenterService } from "@/lib/services/costCenterService";
import { dashboardService } from "@/lib/services/dashboardService";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSortableData } from "@/hooks/useSortableData";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface BatchDetailsDialogProps {
  batch: PaymentBatch | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export function BatchDetailsDialog({
  batch,
  isOpen,
  onClose,
  onUpdate,
}: BatchDetailsDialogProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [missingTransactions, setMissingTransactions] = useState<Transaction[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { user } = useAuth();
  const { canManageBatches } = usePermissions();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

  const {
    items: sortedTransactions,
    requestSort,
    sortConfig,
  } = useSortableData(transactions);

  const loadTransactions = useCallback(async () => {
    if (batch && isOpen) {
      setIsLoading(true);
      try {
        const data = await transactionService.getAll({ batchId: batch.id });
        setTransactions(data);
        setSelectedIds(new Set()); // Reset selection on reload
      } catch (error) {
        console.error("Error loading batch transactions", error);
      } finally {
        setIsLoading(false);
      }
    }
  }, [batch, isOpen]);

  const [hasMoreMissing, setHasMoreMissing] = useState(false);
  const MISSING_LIMIT = 50;

  const loadMissingTransactions = useCallback(async () => {
    if (
      batch &&
      isOpen &&
      batch.status === "open" &&
      batch.startDate &&
      batch.endDate &&
      canManageBatches
    ) {
      try {
        const missing = await transactionService.getAll({
          companyId: batch.companyId,
          startDate: batch.startDate,
          endDate: batch.endDate,
          status: "draft",
          type: "payable",
          batchId: null, // Only fetch those NOT in a batch
          limit: MISSING_LIMIT, // Limit to 50 to avoid performance issues
        });

        setMissingTransactions(missing);
        setHasMoreMissing(missing.length === MISSING_LIMIT);
      } catch (err) {
        console.error("Error loading missing transactions", err);
      }
    } else {
      setMissingTransactions([]);
      setHasMoreMissing(false);
    }
  }, [batch, isOpen, canManageBatches]);

  useEffect(() => {
    loadTransactions();
    loadMissingTransactions();
  }, [loadTransactions, loadMissingTransactions]);

  const handleRemoveTransaction = async () => {
    if (!batch || !deleteId) return;

    try {
      const tx = transactions.find((t) => t.id === deleteId);
      if (!tx) return;

      await paymentBatchService.removeTransactions(batch.id, [tx]);
      toast.success("Transação removida do lote");
      setDeleteId(null);

      // Update local list
      loadTransactions();
      loadMissingTransactions();

      // Notify parent to update batch details (total amount, etc)
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      console.error("Error removing transaction", error);
      toast.error("Erro ao remover transação");
    }
  };

  const handleBulkRemove = async () => {
    if (!batch || selectedIds.size === 0) return;
    try {
      const txToRemove = transactions.filter((t) => selectedIds.has(t.id));
      await paymentBatchService.removeTransactions(batch.id, txToRemove);
      toast.success(`${txToRemove.length} transações removidas do lote`);
      setIsBulkDeleteOpen(false);
      setSelectedIds(new Set());
      loadTransactions();
      loadMissingTransactions();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error("Error bulk removing transactions", error);
      toast.error("Erro ao remover transações");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedTransactions.map((t) => t.id)));
    }
  };

  const handleAddTransaction = async (tx: Transaction) => {
    if (!batch) return;
    setAddingId(tx.id);
    try {
      await paymentBatchService.addTransactions(batch.id, [tx]);
      toast.success("Transação adicionada ao lote");
      loadTransactions();
      loadMissingTransactions();
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error("Error adding transaction", error);
      toast.error("Erro ao adicionar transação");
    } finally {
      setAddingId(null);
    }
  };

  const handleExport = async () => {
    if (!batch || !user) return;
    setIsExporting(true);

    try {
      // 1. Fetch Data
      const [costCenters, metrics] = await Promise.all([
        costCenterService.getAll(batch.companyId),
        dashboardService.getFinancialMetrics(batch.companyId),
      ]);

      const costCenterMap = new Map(costCenters.map((cc) => [cc.id, cc]));
      const getCostCenterName = (t: Transaction) => {
        let id = t.costCenterId;
        // Fallback to allocation if main ID is missing
        if (
          !id &&
          t.costCenterAllocation &&
          t.costCenterAllocation.length > 0
        ) {
          id = t.costCenterAllocation[0].costCenterId;
        }

        if (!id) return "Sem Centro de Custo";
        const cc = costCenterMap.get(id);
        if (!cc) return "Desconhecido";

        if (cc.parentId) {
          const parent = costCenterMap.get(cc.parentId);
          return parent ? `${parent.name} > ${cc.name}` : cc.name;
        }
        return cc.name;
      };

      // 2. Prepare Data
      const data = transactions.map((t) => ({
        ...t,
        // Use the batch-adjusted amount when an approver modified it; fall back to original
        effectiveAmount:
          (t as Transaction & { batchAdjustedAmount?: number })
            .batchAdjustedAmount ?? t.amount,
        costCenterName: getCostCenterName(t),
        installmentText: t.recurrence?.isRecurring
          ? "Contínua"
          : t.installments
            ? `${t.installments.current}/${t.installments.total}`
            : "1/1",
      }));

      // 3. Sort Data
      data.sort((a, b) => {
        // Group by Cost Center
        if (a.costCenterName !== b.costCenterName) {
          return a.costCenterName.localeCompare(b.costCenterName);
        }
        // Value (Desc)
        if (b.amount !== a.amount) {
          return b.amount - a.amount;
        }
        // Description (A-Z)
        if (a.description !== b.description) {
          return a.description.localeCompare(b.description);
        }
        // Status
        if (a.status !== b.status) {
          return a.status.localeCompare(b.status);
        }
        // Supplier (A-Z)
        const supplierA = a.supplierOrClient || "";
        const supplierB = b.supplierOrClient || "";
        if (supplierA !== supplierB) {
          return supplierA.localeCompare(supplierB);
        }
        // Due Date (Asc)
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

      // 4. Create Workbook
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet("Lote de Pagamento");

      // Styles
      const headerStyle = {
        font: { bold: true, size: 12, color: { argb: "FFFFFFFF" } },
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF2563EB" },
        }, // Blue-600
        alignment: { horizontal: "center", vertical: "middle" },
      };

      // Columns
      const columns = [
        { key: "supplier", width: 30 },
        { key: "description", width: 40 },
        { key: "costCenter", width: 40 },
        { key: "dueDate", width: 15 },
        { key: "installment", width: 10 },
        { key: "amount", width: 15 },
      ];

      worksheet.columns = columns;

      // Header Info
      worksheet.mergeCells("A1:F1");
      worksheet.getCell("A1").value = `Lote: ${batch.name}`;
      worksheet.getCell("A1").font = { bold: true, size: 16 };

      worksheet.mergeCells("A2:F2");
      worksheet.getCell("A2").value =
        `Solicitante: ${user.displayName} (${user.email})`;

      worksheet.mergeCells("A3:F3");
      worksheet.getCell("A3").value =
        `Data: ${format(new Date(), "dd/MM/yyyy HH:mm")}`;

      worksheet.addRow([]); // Spacer

      // Add Header Row manually to style it
      const headerRow = worksheet.getRow(5);
      headerRow.values = [
        "Favorecido",
        "Descrição",
        "Centro de Custo",
        "Data de Pagamento",
        "Parcela",
        "Valor",
      ];
      headerRow.height = 25;
      headerRow.eachCell((cell, colNumber) => {
        cell.style = headerStyle as Style;
        if (colNumber === 1 || colNumber === 2) {
          cell.alignment = { horizontal: "left", vertical: "middle" };
        }
      });

      // Add Data
      let currentCostCenter = "";
      let currentRowIndex = 6;

      data.forEach((item) => {
        if (currentCostCenter && item.costCenterName !== currentCostCenter) {
          // Add blank line
          currentRowIndex++;
        }
        currentCostCenter = item.costCenterName;

        const row = worksheet.getRow(currentRowIndex);
        row.values = {
          supplier: item.supplierOrClient,
          description: item.description,
          costCenter: item.costCenterName,
          dueDate: format(new Date(item.dueDate), "dd/MM/yyyy"),
          installment: item.installmentText,
          amount: item.effectiveAmount,
        };

        // Format Currency
        row.getCell("amount").numFmt = '"R$"#,##0.00';

        // Apply borders and alignment to all cells in the row
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber <= 6) {
            // Only for the 6 columns
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };

            // Alignment: Center for Cost Center (3), Date (4), Installment (5), Amount (6)
            if (colNumber >= 3) {
              cell.alignment = { horizontal: "center" };
            } else {
              cell.alignment = { horizontal: "left" };
            }
          }
        });

        currentRowIndex++;
      });

      // Footer
      currentRowIndex += 2;

      const addFooterRow = (label: string, value: number, color?: string) => {
        const row = worksheet.getRow(currentRowIndex);
        row.getCell(5).value = label;
        row.getCell(5).font = { bold: true };
        row.getCell(5).alignment = { horizontal: "right" };

        row.getCell(6).value = value;
        row.getCell(6).numFmt = '"R$"#,##0.00';
        row.getCell(6).font = {
          bold: true,
          color: color ? { argb: color } : undefined,
        };

        currentRowIndex++;
      };

      const currentBalance = metrics?.balance || 0;
      // Compute total from live transaction data to reflect any edits made after batch creation
      const liveTotal = data.reduce((sum, t) => sum + t.effectiveAmount, 0);
      const balanceAfter = currentBalance - liveTotal;

      addFooterRow("Valor total do lote:", liveTotal);
      addFooterRow("Saldo atual:", currentBalance);
      addFooterRow(
        "Saldo após pagamentos:",
        balanceAfter,
        balanceAfter < 0 ? "FFFF0000" : "FF008000",
      ); // Red if negative, Green if positive

      // --- Summary Sheet ---
      const summarySheet = workbook.addWorksheet("Resumo");

      // Calculate Summaries
      const costCenterSummary = new Map<
        string,
        { count: number; total: number }
      >();
      const supplierSummary = new Map<
        string,
        { count: number; total: number }
      >();

      data.forEach((t) => {
        // Cost Center
        const ccName = t.costCenterName;
        const ccCurrent = costCenterSummary.get(ccName) || {
          count: 0,
          total: 0,
        };
        costCenterSummary.set(ccName, {
          count: ccCurrent.count + 1,
          total: ccCurrent.total + t.effectiveAmount,
        });

        // Supplier
        const supplierName = t.supplierOrClient || "Sem Favorecido";
        const supCurrent = supplierSummary.get(supplierName) || {
          count: 0,
          total: 0,
        };
        supplierSummary.set(supplierName, {
          count: supCurrent.count + 1,
          total: supCurrent.total + t.effectiveAmount,
        });
      });

      // Sort Summaries (Total Descending)
      const sortedCostCenters = Array.from(costCenterSummary.entries()).sort(
        (a, b) => b[1].total - a[1].total,
      );
      const sortedSuppliers = Array.from(supplierSummary.entries()).sort(
        (a, b) => b[1].total - a[1].total,
      );

      // Cost Center Table
      summarySheet.getCell("A1").value = "Resumo por Centro de Custo";
      summarySheet.getCell("A1").font = { bold: true, size: 14 };

      const ccHeaderRow = summarySheet.getRow(3);
      ccHeaderRow.values = [
        "Nome do Centro de Custo",
        "Número de Transações",
        "Valor Total",
      ];
      ccHeaderRow.height = 25;
      ccHeaderRow.eachCell((cell) => {
        cell.style = headerStyle as Style;
      });

      let summaryRowIndex = 4;
      sortedCostCenters.forEach(([name, stats]) => {
        const row = summarySheet.getRow(summaryRowIndex);
        row.values = [name, stats.count, stats.total];
        row.getCell(3).numFmt = '"R$"#,##0.00';
        // Borders
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber <= 3) {
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          }
        });
        summaryRowIndex++;
      });

      // Supplier Table
      summaryRowIndex += 2; // Gap
      summarySheet.getCell(`A${summaryRowIndex}`).value =
        "Resumo por Favorecido";
      summarySheet.getCell(`A${summaryRowIndex}`).font = {
        bold: true,
        size: 14,
      };
      summaryRowIndex += 2;

      const supHeaderRow = summarySheet.getRow(summaryRowIndex);
      supHeaderRow.values = ["Nome", "Número", "Total"];
      supHeaderRow.height = 25;
      supHeaderRow.eachCell((cell) => {
        cell.style = headerStyle as Style;
      });

      summaryRowIndex++;

      sortedSuppliers.forEach(([name, stats]) => {
        const row = summarySheet.getRow(summaryRowIndex);
        row.values = [name, stats.count, stats.total];
        row.getCell(3).numFmt = '"R$"#,##0.00';
        // Borders
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (colNumber <= 3) {
            cell.border = {
              top: { style: "thin" },
              left: { style: "thin" },
              bottom: { style: "thin" },
              right: { style: "thin" },
            };
          }
        });
        summaryRowIndex++;
      });

      // Column widths
      summarySheet.getColumn(1).width = 50;
      summarySheet.getColumn(2).width = 20;
      summarySheet.getColumn(3).width = 20;

      // Generate Buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Lote_${batch.name.replace(/\s+/g, "_")}_${format(new Date(), "yyyyMMdd")}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error exporting batch", error);
    } finally {
      setIsExporting(false);
    }
  };

  if (!batch) return null;

  const liveTotal = transactions.reduce(
    (sum, t) =>
      sum +
      ((t as Transaction & { batchAdjustedAmount?: number })
        .batchAdjustedAmount ?? t.amount),
    0,
  );

  const batchStatusLabel = batch.status === "open" ? "Aberto" : "Fechado";

  return (
    <ResponsiveModal open={isOpen} onOpenChange={onClose}>
      <ResponsiveModalContent className="sm:max-w-[90vw] w-full max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="shrink-0">
                  {batchStatusLabel}
                </Badge>
                {batch.startDate && batch.endDate && (
                  <span className="text-xs text-muted-foreground truncate">
                    {format(new Date(batch.startDate), "dd/MM/yyyy")} →{" "}
                    {format(new Date(batch.endDate), "dd/MM/yyyy")}
                  </span>
                )}
              </div>
              <ResponsiveModalTitle className="text-xl leading-tight">
                {batch.name}
              </ResponsiveModalTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
              className="shrink-0"
            >
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Exportar
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground mb-1">
                Total do Lote
              </p>
              <p className="text-xl font-bold font-financial">
                {formatCurrency(liveTotal)}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground mb-1">Transações</p>
              <p className="text-xl font-bold tabular-nums">
                {transactions.length}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground mb-1">
                Não incluídas
              </p>
              <p
                className={`text-xl font-bold tabular-nums ${missingTransactions.length > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}
              >
                {missingTransactions.length}
              </p>
            </div>
          </div>
        </ResponsiveModalHeader>

        <div className="space-y-4">
          {missingTransactions.length > 0 &&
            batch.status === "open" &&
            canManageBatches && (
              <Collapsible defaultOpen>
                <div className="border rounded-md border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <CollapsibleTrigger className="flex w-full items-center justify-between p-4 border-b border-amber-200 hover:bg-amber-100/50 dark:hover:bg-amber-950/30 transition-colors rounded-t-md">
                    <div className="text-left">
                      <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                        Transações não incluídas ({missingTransactions.length})
                      </h3>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        Existem transações em rascunho neste período que ainda
                        não foram adicionadas ao lote.
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-amber-700 dark:text-amber-300 shrink-0 ml-2 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Fornecedor</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {missingTransactions.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell>
                              {format(t.dueDate, "dd/MM/yyyy")}
                            </TableCell>
                            <TableCell className="max-w-0 w-[300px]">
                              <span
                                className="block truncate"
                                title={t.description}
                              >
                                {t.description}
                              </span>
                            </TableCell>
                            <TableCell>{t.supplierOrClient}</TableCell>
                            <TableCell className="text-right font-financial">
                              {formatCurrency(t.amount)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                onClick={() => handleAddTransaction(t)}
                                disabled={addingId === t.id}
                              >
                                {addingId === t.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Plus className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {hasMoreMissing && (
                      <div className="p-2 text-center text-xs text-amber-700 dark:text-amber-300 border-t border-amber-200 bg-amber-50/50">
                        Exibindo os primeiros {MISSING_LIMIT} itens. Adicione
                        estes itens para ver o restante ou refine o período.
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              {/* Bulk selection toolbar */}
              {batch.status === "open" &&
                canManageBatches &&
                selectedIds.size > 0 && (
                  <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-4 py-2">
                    <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {selectedIds.size} transação(es) selecionada(s)
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setIsBulkDeleteOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remover selecionadas
                    </Button>
                  </div>
                )}
              <div className="border rounded-md">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      {batch.status === "open" && canManageBatches && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={
                              sortedTransactions.length > 0 &&
                              selectedIds.size === sortedTransactions.length
                            }
                            onCheckedChange={toggleSelectAll}
                            aria-label="Selecionar todas"
                          />
                        </TableHead>
                      )}
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 transition-colors w-[120px]"
                        onClick={() => requestSort("dueDate")}
                      >
                        <div className="flex items-center gap-2">
                          Vencimento
                          {sortConfig?.key === "dueDate" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 transition-colors w-[35%]"
                        onClick={() => requestSort("description")}
                      >
                        <div className="flex items-center gap-2">
                          Descrição
                          {sortConfig?.key === "description" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 transition-colors w-[30%]"
                        onClick={() => requestSort("supplierOrClient")}
                      >
                        <div className="flex items-center gap-2">
                          Fornecedor
                          {sortConfig?.key === "supplierOrClient" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead
                        className="text-right cursor-pointer hover:bg-muted/50 transition-colors w-[120px]"
                        onClick={() => requestSort("amount")}
                      >
                        <div className="flex items-center justify-end gap-2">
                          Valor
                          {sortConfig?.key === "amount" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50 transition-colors w-[100px]"
                        onClick={() => requestSort("status")}
                      >
                        <div className="flex items-center gap-2">
                          Status
                          {sortConfig?.key === "status" ? (
                            sortConfig.direction === "asc" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                      </TableHead>
                      {batch.status === "open" && canManageBatches && (
                        <TableHead className="w-[50px]"></TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={
                            batch.status === "open" && canManageBatches ? 7 : 5
                          }
                          className="py-12 text-center"
                        >
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <PackageOpen className="h-10 w-10 opacity-30" />
                            <p className="font-medium">
                              Nenhuma transação neste lote
                            </p>
                            {batch.status === "open" && canManageBatches && (
                              <p className="text-sm">
                                Adicione transações usando o painel acima.
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedTransactions.map((t) => (
                        <TableRow
                          key={t.id}
                          data-selected={selectedIds.has(t.id)}
                        >
                          {batch.status === "open" && canManageBatches && (
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(t.id)}
                                onCheckedChange={() => toggleSelect(t.id)}
                                aria-label={`Selecionar ${t.description}`}
                              />
                            </TableCell>
                          )}
                          <TableCell>
                            {format(t.dueDate, "dd/MM/yyyy")}
                          </TableCell>
                          <TableCell className="max-w-0">
                            <span
                              className="block truncate"
                              title={t.description}
                            >
                              {t.description}
                            </span>
                          </TableCell>
                          <TableCell>{t.supplierOrClient}</TableCell>
                          <TableCell className="text-right font-financial">
                            {formatCurrency(t.amount)}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              switch (t.status) {
                                case "paid":
                                  return (
                                    <Badge className="bg-emerald-500 hover:bg-emerald-600">
                                      Pago
                                    </Badge>
                                  );
                                case "authorized":
                                  return (
                                    <Badge className="bg-blue-500 hover:bg-blue-600">
                                      Autorizado
                                    </Badge>
                                  );
                                case "approved":
                                  return (
                                    <Badge className="bg-blue-400 hover:bg-blue-500">
                                      Aprovado
                                    </Badge>
                                  );
                                case "pending_authorization":
                                  return (
                                    <Badge className="bg-amber-500 hover:bg-amber-600">
                                      Aguardando Autorização
                                    </Badge>
                                  );
                                case "pending_approval":
                                  return (
                                    <Badge className="bg-amber-400 hover:bg-amber-500">
                                      Aguardando Aprovação
                                    </Badge>
                                  );
                                case "rejected":
                                  return (
                                    <Badge variant="destructive">
                                      Rejeitado
                                    </Badge>
                                  );
                                case "draft":
                                  return (
                                    <Badge variant="secondary">Rascunho</Badge>
                                  );
                                default:
                                  return (
                                    <Badge variant="outline">
                                      {t.status === "open"
                                        ? "Aberto"
                                        : t.status}
                                    </Badge>
                                  );
                              }
                            })()}
                          </TableCell>
                          {batch.status === "open" && canManageBatches && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteId(t.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title="Remover transação"
          description="Tem certeza que deseja remover esta transação do lote? Ela voltará para a lista de contas a pagar disponíveis."
          confirmText="Remover"
          variant="destructive"
          onConfirm={handleRemoveTransaction}
        />
        <ConfirmDialog
          open={isBulkDeleteOpen}
          onOpenChange={(open) => !open && setIsBulkDeleteOpen(false)}
          title="Remover transações selecionadas"
          description={`Tem certeza que deseja remover ${selectedIds.size} transação(es) do lote? Elas voltarão para a lista de contas a pagar disponíveis.`}
          confirmText="Remover"
          variant="destructive"
          onConfirm={handleBulkRemove}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
