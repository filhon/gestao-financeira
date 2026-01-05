import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentBatch, Transaction } from "@/lib/types";
import { useEffect, useState } from "react";
import { transactionService } from "@/lib/services/transactionService";
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
import { Loader2, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Workbook, Style } from "exceljs";
import { useAuth } from "@/components/providers/AuthProvider";
import { costCenterService } from "@/lib/services/costCenterService";
import { dashboardService } from "@/lib/services/dashboardService";

interface BatchDetailsDialogProps {
  batch: PaymentBatch | null;
  isOpen: boolean;
  onClose: () => void;
}

export function BatchDetailsDialog({
  batch,
  isOpen,
  onClose,
}: BatchDetailsDialogProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const loadTransactions = async () => {
      if (batch && isOpen) {
        setIsLoading(true);
        try {
          const data = await transactionService.getAll({ batchId: batch.id });
          setTransactions(data);
        } catch (error) {
          console.error("Error loading batch transactions", error);
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadTransactions();
  }, [batch, isOpen]);

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
          amount: item.amount,
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
      const balanceAfter = currentBalance - batch.totalAmount;

      addFooterRow("Valor total do lote:", batch.totalAmount);
      addFooterRow("Saldo atual:", currentBalance);
      addFooterRow(
        "Saldo após pagamentos:",
        balanceAfter,
        balanceAfter < 0 ? "FFFF0000" : "FF008000"
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
          total: ccCurrent.total + t.amount,
        });

        // Supplier
        const supplierName = t.supplierOrClient || "Sem Favorecido";
        const supCurrent = supplierSummary.get(supplierName) || {
          count: 0,
          total: 0,
        };
        supplierSummary.set(supplierName, {
          count: supCurrent.count + 1,
          total: supCurrent.total + t.amount,
        });
      });

      // Sort Summaries (Total Descending)
      const sortedCostCenters = Array.from(costCenterSummary.entries()).sort(
        (a, b) => b[1].total - a[1].total
      );
      const sortedSuppliers = Array.from(supplierSummary.entries()).sort(
        (a, b) => b[1].total - a[1].total
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[90vw] w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhes do Lote: {batch.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>Total: {formatCurrency(batch.totalAmount)}</span>
              <span>Itens: {batch.transactionIds.length}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Exportar
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center py-4 text-muted-foreground"
                      >
                        Nenhuma transação encontrada neste lote.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex items-center gap-2">
                            <span className="truncate" title={t.description}>
                              {t.description}
                            </span>
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[10px]"
                            >
                              Em Lote
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>{t.supplierOrClient}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(t.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
