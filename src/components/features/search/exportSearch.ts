import currency from "currency.js";
import { format } from "date-fns";
import type { SearchRow } from "@/hooks/useSearch";
import { statusLabel } from "@/lib/search/query";

/** Planilha com as linhas da busca (todas as filtradas ou só as marcadas). */
export async function exportSearchXlsx(rows: SearchRow[], query: string) {
  // exceljs pesa ~250 KB gz: só carrega quando alguém exporta.
  const { Workbook } = (await import("exceljs")).default;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Busca");

  sheet.columns = [
    { header: "Tipo", key: "type", width: 10 },
    { header: "Descrição", key: "description", width: 45 },
    { header: "Fornecedor / Cliente", key: "counterpart", width: 32 },
    { header: "Nº documento", key: "document", width: 16 },
    { header: "Origem", key: "origin", width: 24 },
    { header: "Centro de custo", key: "costCenter", width: 28 },
    { header: "Conta", key: "account", width: 28 },
    { header: "Vencimento", key: "dueDate", width: 12 },
    { header: "Pagamento", key: "paymentDate", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "Lote", key: "batch", width: 20 },
    { header: "RD", key: "rd", width: 10 },
    { header: "Valor", key: "amount", width: 15 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const { tx: t, info } of rows) {
    sheet.addRow({
      type: t.type === "payable" ? "Pagar" : "Receber",
      description: t.description,
      counterpart: t.supplierOrClient ?? "",
      document: t.documentNumber ?? "",
      origin: t.requestOrigin?.name ?? "",
      costCenter: info.costCenter ?? "",
      account: info.account ?? "",
      dueDate: t.dueDate,
      paymentDate: t.paymentDate ?? null,
      status: statusLabel(t),
      batch: info.batch ?? "",
      rd: info.rd ?? "",
      // Saída negativa, entrada positiva: a soma da coluna é o saldo.
      amount: t.type === "payable" ? -t.amount : t.amount,
    });
  }
  sheet.getColumn("dueDate").numFmt = "dd/mm/yyyy";
  sheet.getColumn("paymentDate").numFmt = "dd/mm/yyyy";
  sheet.getColumn("amount").numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

  const total = rows.reduce(
    (acc, { tx: t }) =>
      t.status === "rejected"
        ? acc
        : t.type === "payable"
          ? acc.subtract(t.amount)
          : acc.add(t.amount),
    currency(0),
  ).value;
  const footer = sheet.addRow({
    status: "Saldo (sem rejeitadas)",
    amount: total,
  });
  footer.font = { bold: true };

  sheet.addRow([]);
  sheet.addRow([`Busca: ${query}`]);
  sheet.addRow([`Exportado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`]);

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `Busca_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
