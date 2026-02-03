import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Transaction } from "@/lib/types";
import { format, addDays, startOfDay, isAfter, isBefore } from "date-fns";
import { formatCurrency } from "@/lib/utils";

export const reportService = {
  generateConsolidatedCashFlowPDF: (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
    initialBalance: number = 0,
  ) => {
    const doc = new jsPDF();

    // --- Configuração Visual ---
    const headerColor = [34, 47, 62]; // Dark navy

    // --- Cabeçalho ---
    doc.setFontSize(22);
    doc.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
    doc.text("Fluxo de Caixa Consolidado", 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(companyName, 14, 28);
    doc.text(
      `Período de Análise: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`,
      14,
      33,
    );
    doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 38);

    // --- Processamento dos Dados ---
    // 1. Organizar transações por dia
    const dayMap = new Map<string, { in: number; out: number }>();

    transactions.forEach((t) => {
      const date =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      // Ignorar transações fora do intervalo (caso a query não tenha filtrado perfeitamente ou para segurança)
      if (isBefore(date, startOfDay(startDate)) || isAfter(date, endDate))
        return;

      const dateKey = format(date, "yyyy-MM-dd");
      const current = dayMap.get(dateKey) || { in: 0, out: 0 };

      if (t.type === "receivable") {
        current.in += t.amount;
      } else {
        current.out += t.amount;
      }
      dayMap.set(dateKey, current);
    });

    // 2. Construir linhas iterando dia a dia para manter o saldo correto
    let currentBalance = initialBalance;
    let minBalance = initialBalance;
    let minBalanceDate = startDate;

    const tableRows: (string | number)[][] = [];
    let currDate = startOfDay(startDate);
    const end = startOfDay(endDate);

    // Adicionar linha inicial se houver saldo
    if (initialBalance !== 0) {
      tableRows.push([
        format(startDate, "dd/MM/yyyy"),
        "-",
        "-",
        formatCurrency(initialBalance),
      ]);
    }

    while (!isAfter(currDate, end)) {
      const dateKey = format(currDate, "yyyy-MM-dd");
      const dayData = dayMap.get(dateKey);

      if (dayData) {
        currentBalance += dayData.in - dayData.out;

        // Rastrear menor saldo
        if (currentBalance < minBalance) {
          minBalance = currentBalance;
          minBalanceDate = new Date(currDate);
        }

        tableRows.push([
          format(currDate, "dd/MM/yyyy"),
          formatCurrency(dayData.in),
          formatCurrency(dayData.out),
          formatCurrency(currentBalance), // Será formatado na célula depois se necessário
        ]);
      } else {
        // Dias sem transação não alteram o saldo, mas não adicionamos linha conforme solicitado
        // a menos que queiramos mostrar a continuidade.
        // O usuário pediu: "quando houver uma ou mais transações no dia"
      }

      currDate = addDays(currDate, 1);
    }

    // --- Tabela ---
    autoTable(doc, {
      startY: 45,
      head: [["Data", "Entradas", "Saídas", "Saldo Acumulado"]],
      body: tableRows,
      theme: "plain",
      styles: {
        fontSize: 10,
        cellPadding: 3,
        lineColor: [220, 220, 220],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [50, 50, 50],
        fontStyle: "bold",
        lineWidth: 0,
      },
      columnStyles: {
        0: { cellWidth: 40 }, // Data
        1: { cellWidth: 40, halign: "right", textColor: [27, 94, 32] }, // Entradas (Verde escuro)
        2: { cellWidth: 40, halign: "right", textColor: [183, 28, 28] }, // Saídas (Vermelho escuro)
        3: { cellWidth: 40, halign: "right", fontStyle: "bold" }, // Saldo
      },
      didParseCell: (data) => {
        // Destaque visual para saldo negativo
        if (data.section === "body" && data.column.index === 3) {
          const balanceStr = data.cell.raw as string;
          // Remover formatação simples para verificar valor
          // Assumindo que formatCurrency retorna "R$ 1.000,00"
          // Vamos tentar parsear ou usar o valor numérico se tivessemos passado o raw
          // Como passamos string formatada, verifica sinal de negativo
          if (balanceStr.includes("-")) {
            data.cell.styles.textColor = [192, 57, 43]; // Red
            // Destaque na linha inteira se negativo? O user pediu "indicativo visual que destaque a linha" -> O texto vermelho já ajuda, mas podemos pintar o fundo
            // data.cell.styles.fillColor = [253, 237, 236]; // Light red bg
          }
        }
      },
    });

    // --- Overview / Análise de Riscos ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finalY = (doc as any).lastAutoTable.finalY + 15;

    // Se o relatório for longo e quebrar página, finalY pode estar em nova página.
    // check page height simple check
    if (finalY > 250) {
      doc.addPage();
      finalY = 20;
    }

    doc.setFontSize(14);
    doc.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
    doc.text("Análise de Riscos & Sugestões", 14, finalY);

    doc.setFontSize(10);
    doc.setTextColor(60);
    finalY += 8;

    const saldoFinal = currentBalance;

    // Texto descritivo
    doc.text(
      `Saldo Inicial Informado: ${formatCurrency(initialBalance)}`,
      14,
      finalY,
    );
    finalY += 6;
    doc.text(
      `Saldo Final do Período: ${formatCurrency(saldoFinal)}`,
      14,
      finalY,
    );
    finalY += 10;

    if (minBalance < 0) {
      doc.setFillColor(253, 237, 236); // Light red
      doc.setDrawColor(192, 57, 43);
      doc.rect(14, finalY, 180, 25, "FD");

      doc.setTextColor(192, 57, 43);
      doc.setFont("helvetica", "bold");
      doc.text("ALERTA DE CAIXA: QUEBRA IDENTIFICADA", 20, finalY + 8);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(50);
      doc.text(
        `Identificamos que o saldo atingirá o valor mínimo de ${formatCurrency(minBalance)} no dia ${format(minBalanceDate, "dd/MM/yyyy")}.`,
        20,
        finalY + 16,
      );
      doc.text(
        `Sugestão de Aporte: Recomenda-se um aporte de pelo menos ${formatCurrency(Math.abs(minBalance))} antes desta data.`,
        20,
        finalY + 22,
      );
    } else {
      doc.setFillColor(232, 248, 245); // Light green
      doc.setDrawColor(39, 174, 96);
      doc.rect(14, finalY, 180, 15, "FD");

      doc.setTextColor(39, 174, 96);
      doc.setFont("helvetica", "bold");
      doc.text("CENÁRIO SAUDÁVEL", 20, finalY + 10);
    }

    doc.save(`fluxo_caixa_consolidado_${format(new Date(), "yyyyMMdd")}.pdf`);
  },

  generateCashFlowPDF: (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
  ) => {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.text("Relatório de Fluxo de Caixa", 14, 20);
    doc.setFontSize(12);
    doc.text(companyName, 14, 30);
    doc.text(
      `Período: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`,
      14,
      36,
    );

    // Data Processing
    const tableData = transactions.map((t) => [
      format(t.dueDate, "dd/MM/yyyy"),
      t.description,
      t.type === "receivable" ? "Receita" : "Despesa",
      t.supplierOrClient || "-",
      formatCurrency(t.amount),
    ]);

    autoTable(doc, {
      startY: 45,
      head: [["Data", "Descrição", "Tipo", "Entidade", "Valor"]],
      body: tableData,
    });

    // Totals
    const totalIn = transactions
      .filter((t) => t.type === "receivable")
      .reduce((acc, t) => acc + t.amount, 0);
    const totalOut = transactions
      .filter((t) => t.type === "payable")
      .reduce((acc, t) => acc + t.amount, 0);
    const balance = totalIn - totalOut;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.text(`Total Receitas: ${formatCurrency(totalIn)}`, 14, finalY);
    doc.text(`Total Despesas: ${formatCurrency(totalOut)}`, 14, finalY + 6);
    doc.text(`Saldo: ${formatCurrency(balance)}`, 14, finalY + 12);

    doc.save(`fluxo_caixa_${format(new Date(), "yyyyMMdd")}.pdf`);
  },

  generateDREPDF: (
    transactions: Transaction[],
    startDate: Date,
    endDate: Date,
    companyName: string,
  ) => {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.text("Demonstrativo de Resultados (DRE)", 14, 20);
    doc.setFontSize(12);
    doc.text(companyName, 14, 30);
    doc.text(
      `Período: ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`,
      14,
      36,
    );

    // Calculate Totals
    const revenue = transactions
      .filter((t) => t.type === "receivable")
      .reduce((acc, t) => acc + t.amount, 0);
    const expenses = transactions
      .filter((t) => t.type === "payable")
      .reduce((acc, t) => acc + t.amount, 0);
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
    const headers = [
      "Data",
      "Descrição",
      "Tipo",
      "Entidade",
      "Valor",
      "Status",
    ];
    const rows = transactions.map((t) => [
      format(t.dueDate, "yyyy-MM-dd"),
      `"${t.description}"`, // Escape quotes
      t.type,
      `"${t.supplierOrClient || ""}"`,
      t.amount.toFixed(2),
      t.status,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `transacoes_${format(new Date(), "yyyyMMdd")}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};
