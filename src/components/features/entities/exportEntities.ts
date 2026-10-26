import { format } from "date-fns";
import { Entity } from "@/lib/types";
import { EntityPosition } from "./entityPositions";
import {
  CATEGORY_LABELS,
  PIX_KEY_TYPE_LABELS,
  TAX_REGIME_LABELS,
  displayDocument,
  isActive,
} from "./entityDisplay";

/** Planilha do cadastro com a posição de cada entidade. */
export async function exportEntitiesXlsx(
  rows: (Entity & { position: EntityPosition })[],
) {
  // exceljs pesa ~250 KB gz: só carrega quando alguém exporta.
  const { Workbook } = (await import("exceljs")).default;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Entidades");

  sheet.columns = [
    { header: "Nome / Razão social", key: "name", width: 40 },
    { header: "Nome fantasia", key: "tradeName", width: 28 },
    { header: "CPF/CNPJ", key: "document", width: 20 },
    { header: "Categoria", key: "category", width: 20 },
    { header: "Situação", key: "active", width: 10 },
    { header: "Regime", key: "taxRegime", width: 18 },
    { header: "IE", key: "ie", width: 16 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Telefone", key: "phone", width: 16 },
    { header: "Cidade", key: "city", width: 20 },
    { header: "UF", key: "state", width: 5 },
    { header: "Chave PIX", key: "pixKey", width: 30 },
    { header: "Banco", key: "bankName", width: 30 },
    { header: "Agência", key: "agency", width: 10 },
    { header: "Conta", key: "account", width: 14 },
    { header: "Em aberto", key: "open", width: 14 },
    { header: "Vencido", key: "overdue", width: 14 },
    { header: "Último pagamento", key: "lastPaid", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const e of rows) {
    sheet.addRow({
      name: e.name,
      tradeName: e.tradeName ?? "",
      document: e.document ? displayDocument(e.document) : "",
      category: CATEGORY_LABELS[e.category] ?? e.category,
      active: isActive(e) ? "Ativa" : "Inativa",
      taxRegime: e.taxRegime ? TAX_REGIME_LABELS[e.taxRegime] : "",
      ie: e.stateRegistration ?? "",
      email: e.email ?? "",
      phone: e.phone ?? "",
      city: e.city ?? "",
      state: e.state ?? "",
      pixKey: e.pixKey
        ? `${e.pixKey}${e.pixKeyType ? ` (${PIX_KEY_TYPE_LABELS[e.pixKeyType]})` : ""}`
        : "",
      bankName: e.bankName ?? "",
      agency: e.agency ?? "",
      account: e.account ?? "",
      open: e.position.open,
      overdue: e.position.overdue,
      lastPaid: e.position.lastPaid ?? null,
    });
  }
  for (const key of ["open", "overdue"]) {
    sheet.getColumn(key).numFmt = '"R$" #,##0.00';
  }
  sheet.getColumn("lastPaid").numFmt = "dd/mm/yyyy";

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Entidades_${format(new Date(), "yyyyMMdd")}.xlsx`;
  a.click();
  window.URL.revokeObjectURL(url);
}
