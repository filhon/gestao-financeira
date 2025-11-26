"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { transactionService } from "@/lib/services/transactionService";
import { reportService } from "@/lib/services/reportService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { startOfMonth, endOfMonth, format } from "date-fns";

export default function ReportsPage() {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();
    const [isLoading, setIsLoading] = useState(false);

    // Default to current month
    const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
    const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
    const [reportType, setReportType] = useState("cash_flow");

    const handleGenerate = async (formatType: 'pdf' | 'csv') => {
        if (!selectedCompany) return;

        try {
            setIsLoading(true);

            // 1. Fetch Data
            // We need a method to fetch by date range. 
            // transactionService.getAll currently takes filters but maybe not range?
            // Let's check transactionService.getAll implementation.
            // Assuming we might need to fetch all and filter client side if service doesn't support range yet,
            // or update service. For now, let's fetch all and filter client side to be safe.

            const allTransactions = await transactionService.getAll({ companyId: selectedCompany.id });

            const start = new Date(startDate);
            const end = new Date(endDate);
            // Adjust end date to end of day
            end.setHours(23, 59, 59, 999);

            const filtered = allTransactions.filter(t => {
                const date = t.dueDate; // Report based on due date or payment date? Usually Due Date for projection, Payment for realized.
                // Let's use Due Date for now as it covers both paid and unpaid.
                return date >= start && date <= end;
            });

            if (filtered.length === 0) {
                toast.warning("Nenhuma transação encontrada no período.");
                return;
            }

            // 2. Generate Report
            if (formatType === 'csv') {
                reportService.exportToCSV(filtered);
                toast.success("Exportação CSV concluída!");
            } else {
                if (reportType === 'cash_flow') {
                    reportService.generateCashFlowPDF(filtered, start, end, selectedCompany.name);
                } else if (reportType === 'dre') {
                    reportService.generateDREPDF(filtered, start, end, selectedCompany.name);
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
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Data Final</Label>
                            <Input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tipo de Relatório</Label>
                            <Select value={reportType} onValueChange={setReportType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="cash_flow">Fluxo de Caixa</SelectItem>
                                    <SelectItem value="dre">DRE (Demonstrativo de Resultados)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex gap-4 pt-4">
                        <Button
                            onClick={() => handleGenerate('pdf')}
                            disabled={isLoading}
                            className="flex-1 md:flex-none"
                        >
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                            Gerar PDF
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => handleGenerate('csv')}
                            disabled={isLoading}
                            className="flex-1 md:flex-none"
                        >
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Exportar CSV
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
