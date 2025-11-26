import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Transaction } from "@/lib/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatCurrency } from "@/lib/utils";

export const reportService = {
    generateCashFlowPDF: (transactions: Transaction[], startDate: Date, endDate: Date, companyName: string) => {
        const doc = new jsPDF();

        // Header
        doc.setFontSize(18);
        doc.text("Relatório de Fluxo de Caixa", 14, 20);
        doc.setFontSize(12);
        doc.text(companyName, 14, 30);
        doc.text(`Período: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`, 14, 36);

        // Data Processing
        const tableData = transactions.map(t => [
            format(t.dueDate, "dd/MM/yyyy"),
            t.description,
            t.type === 'receivable' ? 'Receita' : 'Despesa',
            t.supplierOrClient || "-",
            formatCurrency(t.amount)
        ]);

        autoTable(doc, {
            startY: 45,
            head: [["Data", "Descrição", "Tipo", "Entidade", "Valor"]],
            body: tableData,
        });

        // Totals
        const totalIn = transactions.filter(t => t.type === 'receivable').reduce((acc, t) => acc + t.amount, 0);
        const totalOut = transactions.filter(t => t.type === 'payable').reduce((acc, t) => acc + t.amount, 0);
        const balance = totalIn - totalOut;

        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.text(`Total Receitas: ${formatCurrency(totalIn)}`, 14, finalY);
        doc.text(`Total Despesas: ${formatCurrency(totalOut)}`, 14, finalY + 6);
        doc.text(`Saldo: ${formatCurrency(balance)}`, 14, finalY + 12);

        doc.save(`fluxo_caixa_${format(new Date(), "yyyyMMdd")}.pdf`);
    },

    generateDREPDF: (transactions: Transaction[], startDate: Date, endDate: Date, companyName: string) => {
        const doc = new jsPDF();

        // Header
        doc.setFontSize(18);
        doc.text("Demonstrativo de Resultados (DRE)", 14, 20);
        doc.setFontSize(12);
        doc.text(companyName, 14, 30);
        doc.text(`Período: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`, 14, 36);

        // Calculate Totals
        const revenue = transactions.filter(t => t.type === 'receivable').reduce((acc, t) => acc + t.amount, 0);
        const expenses = transactions.filter(t => t.type === 'payable').reduce((acc, t) => acc + t.amount, 0);
        const result = revenue - expenses;

        // Simple DRE Structure
        const tableData = [
            ["Receita Bruta", formatCurrency(revenue)],
            ["(-) Despesas Operacionais", formatCurrency(expenses)],
            ["(=) Resultado Operacional", formatCurrency(result)],
        ];

        autoTable(doc, {
            startY: 45,
            head: [["Descrição", "Valor"]],
            body: tableData,
        });

        doc.save(`dre_${format(new Date(), "yyyyMMdd")}.pdf`);
    },

    exportToCSV: (transactions: Transaction[]) => {
        const headers = ["Data", "Descrição", "Tipo", "Entidade", "Valor", "Status"];
        const rows = transactions.map(t => [
            format(t.dueDate, "yyyy-MM-dd"),
            `"${t.description}"`, // Escape quotes
            t.type,
            `"${t.supplierOrClient || ""}"`,
            t.amount.toFixed(2),
            t.status
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(r => r.join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `transacoes_${format(new Date(), "yyyyMMdd")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
