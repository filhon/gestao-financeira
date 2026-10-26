import { format } from "date-fns";
import type { AuditLog } from "@/lib/types";
import {
  ACTION_NOUNS,
  ACTOR_KIND_LABELS,
  ENTITY_LABELS,
  actorKind,
  detailRows,
  getActionSummary,
  type NameResolver,
} from "@/lib/auditFormatter";

/**
 * Planilha de auditoria: uma linha por campo alterado, para o auditor filtrar
 * "quem mexeu em Chave PIX" direto no Excel.
 */
export async function exportAuditXlsx(
  logs: AuditLog[],
  names: NameResolver,
  subjects: Record<string, string>,
  filterSummary: string,
) {
  // exceljs pesa ~250 KB gz: só carrega quando alguém exporta.
  const { Workbook } = (await import("exceljs")).default;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Auditoria");

  sheet.columns = [
    { header: "Data/hora", key: "at", width: 18 },
    { header: "Usuário", key: "user", width: 28 },
    { header: "E-mail", key: "email", width: 30 },
    { header: "Origem", key: "kind", width: 16 },
    { header: "Ação", key: "action", width: 18 },
    { header: "Entidade", key: "entity", width: 18 },
    { header: "Registro", key: "subject", width: 40 },
    { header: "ID do registro", key: "entityId", width: 24 },
    { header: "Campo", key: "field", width: 26 },
    { header: "Antes", key: "before", width: 30 },
    { header: "Depois", key: "after", width: 30 },
    { header: "Resumo", key: "summary", width: 40 },
    { header: "ID do log", key: "logId", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const log of logs) {
    const base = {
      at: log.createdAt,
      user: names.get(log.userId) ?? log.userName ?? "",
      email: log.userEmail,
      kind: ACTOR_KIND_LABELS[actorKind(log)],
      action: ACTION_NOUNS[log.action] ?? log.action,
      entity: ENTITY_LABELS[log.entity] ?? log.entity,
      subject:
        log.subject ?? subjects[log.entityId] ?? names.get(log.entityId) ?? "",
      entityId: log.entityId,
      summary: getActionSummary(log.action, log.details, names),
      logId: log.id,
    };
    const rows = detailRows(log.details, names);
    if (rows.length === 0) sheet.addRow(base);
    for (const r of rows) {
      sheet.addRow({
        ...base,
        field: r.label,
        before: r.before ?? "",
        after: r.after,
      });
    }
  }
  sheet.getColumn("at").numFmt = "dd/mm/yyyy hh:mm:ss";

  sheet.addRow([]);
  sheet.addRow([`Filtros: ${filterSummary}`]);
  sheet.addRow([`Exportado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`]);

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `Auditoria_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
