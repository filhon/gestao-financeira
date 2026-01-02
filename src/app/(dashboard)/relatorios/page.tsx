"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { transactionService } from "@/lib/services/transactionService";
import { reportService } from "@/lib/services/reportService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, Download, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function ReportsPage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { onlyOwnPayables } = usePermissions();
  const [isLoading, setIsLoading] = useState(false);

  // Default to current month
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [reportType, setReportType] = useState("cash_flow");

  const handleGenerate = async (formatType: "pdf" | "csv") => {
    if (!selectedCompany || !user) return;

    try {
      setIsLoading(true);

      // For 'user' role, filter by createdBy to match Firestore rules
      const filter: {
        companyId: string;
        createdBy?: string;
        startDate?: Date;
        endDate?: Date;
      } = {
        companyId: selectedCompany.id,
        startDate: startDate,
        endDate: endDate,
      };
      if (onlyOwnPayables) {
        filter.createdBy = user.uid;
      }

      const allTransactions = await transactionService.getAll(filter);

      const start = new Date(startDate);
      const end = new Date(endDate);
      // Adjust end date to end of day
      end.setHours(23, 59, 59, 999);

      // Filter using paymentDate for paid transactions, dueDate for others
      const filtered = allTransactions.filter((t) => {
        const dateToCheck =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        return dateToCheck >= start && dateToCheck <= end;
      });

      if (filtered.length === 0) {
        toast.warning("Nenhuma transação encontrada no período.");
        return;
      }

      // 2. Generate Report
      if (formatType === "csv") {
        reportService.exportToCSV(filtered);
        toast.success("Exportação CSV concluída!");
      } else {
        if (reportType === "cash_flow") {
          reportService.generateCashFlowPDF(
            filtered,
            start,
            end,
            selectedCompany.name
          );
        } else if (reportType === "dre") {
          reportService.generateDREPDF(
            filtered,
            start,
            end,
            selectedCompany.name
          );
        }
        toast.success("Relatório PDF gerado!");
      }
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar relatório.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">
          Gere relatórios financeiros e exporte dados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração do Relatório</CardTitle>
          <CardDescription>
            Selecione o período e o tipo de relatório desejado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Data Inicial</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full pl-3 text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    {startDate ? (
                      format(startDate, "PPP", { locale: ptBR })
                    ) : (
                      <span>Selecione</span>
                    )}
                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    initialFocus
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Data Final</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full pl-3 text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    {endDate ? (
                      format(endDate, "PPP", { locale: ptBR })
                    ) : (
                      <span>Selecione</span>
                    )}
                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    initialFocus
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Tipo de Relatório</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash_flow">Fluxo de Caixa</SelectItem>
                  <SelectItem value="dre">
                    DRE (Demonstrativo de Resultados)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <Button
              onClick={() => handleGenerate("pdf")}
              disabled={isLoading}
              className="flex-1 md:flex-none"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Gerar PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => handleGenerate("csv")}
              disabled={isLoading}
              className="flex-1 md:flex-none"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
