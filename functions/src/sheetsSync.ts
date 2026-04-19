import * as admin from "firebase-admin";
import { google } from "googleapis";

export interface SheetsSyncConfig {
  spreadsheetId: string;
  sheetName: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function buildSheetAuth(serviceAccountJson: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credentials = JSON.parse(serviceAccountJson) as any;
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

async function getExistingIdRowMap(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string,
): Promise<Map<string, number>> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!N:N`,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[][] = response.data.values ?? [];
  const idMap = new Map<string, number>();

  // Row 0 is the header; data starts at index 1 → sheet row 2
  for (let i = 1; i < rows.length; i++) {
    const cellValue = rows[i]?.[0];
    if (cellValue) {
      idMap.set(String(cellValue), i + 1);
    }
  }
  return idMap;
}

function buildRow(
  doc: admin.firestore.QueryDocumentSnapshot,
  entityMap: Map<string, string>,
  ccMap: Map<string, { name: string; parentName: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const t = doc.data();

  // A: LANÇ.
  const lancamento = t.type === "payable" ? "Despesa" : "Receita";

  // C: FAVORECIDO
  const favorecido: string =
    (t.supplierOrClient as string | undefined) ||
    (t.entityId ? (entityMap.get(t.entityId as string) ?? "") : "");

  // E: CATEGORIA  F: TIPO
  const cc = t.costCenterId ? ccMap.get(t.costCenterId as string) : undefined;
  const tipo = cc?.name ?? "";
  const categoria = cc?.parentName ?? "";

  // G/H/I: data
  const dateTs: admin.firestore.Timestamp =
    t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
  const date = (dateTs as admin.firestore.Timestamp).toDate();
  const mes = date.getMonth() + 1;
  const ano = date.getFullYear();
  const dataPgto = formatDate(date);

  // J: N DA PARC
  let parcela = "";
  if (t.installments?.current != null && t.installments?.total != null) {
    parcela = `${t.installments.current}/${t.installments.total}`;
  } else if (t.recurrence?.isRecurring === true) {
    parcela = "Continua";
  }

  // K/L: VALOR / TOTAL
  const valor = Number(t.finalAmount ?? t.amount ?? 0);
  const total = t.type === "payable" ? -valor : valor;

  // M: EFTVD
  const eftvd = t.status === "paid";

  return [
    lancamento, // A
    "", // B VÍNCULO (manual)
    favorecido, // C
    (t.description as string) ?? "", // D
    categoria, // E
    tipo, // F
    mes, // G
    ano, // H
    dataPgto, // I
    parcela, // J
    valor, // K
    total, // L
    eftvd, // M
    doc.id, // N (hidden — upsert key)
  ];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function syncCompany(
  companyId: string,
  config: SheetsSyncConfig,
  serviceAccountJson: string,
): Promise<void> {
  const db = admin.firestore();
  const auth = buildSheetAuth(serviceAccountJson);
  const sheets = google.sheets({ version: "v4", auth });

  // Fetch all data in parallel
  const [txSnap, entitySnap, ccSnap] = await Promise.all([
    db.collection("transactions").where("companyId", "==", companyId).get(),
    db.collection("entities").where("companyId", "==", companyId).get(),
    db.collection("cost_centers").where("companyId", "==", companyId).get(),
  ]);

  // Build entity lookup: entityId → name
  const entityMap = new Map<string, string>();
  entitySnap.forEach((d) =>
    entityMap.set(d.id, (d.data().name as string) ?? ""),
  );

  // Build cost center lookup: id → { name, parentName }
  const rawCcMap = new Map<string, { name: string; parentId?: string }>();
  ccSnap.forEach((d) => {
    const cc = d.data();
    rawCcMap.set(d.id, {
      name: (cc.name as string) ?? "",
      parentId: cc.parentId as string | undefined,
    });
  });

  const ccMap = new Map<string, { name: string; parentName: string }>();
  rawCcMap.forEach((cc, id) => {
    const parentName = cc.parentId
      ? (rawCcMap.get(cc.parentId)?.name ?? "")
      : "";
    ccMap.set(id, { name: cc.name, parentName });
  });

  // Read existing ID→rowNumber map from column N
  const idRowMap = await getExistingIdRowMap(
    sheets,
    config.spreadsheetId,
    config.sheetName,
  );

  // Classify rows as updates or appends
  const updates: Array<{ range: string; values: unknown[][] }> = [];
  const appends: unknown[][] = [];

  for (const doc of txSnap.docs) {
    const row = buildRow(doc, entityMap, ccMap);
    const existingRowNum = idRowMap.get(doc.id);

    if (existingRowNum != null) {
      updates.push({
        range: `${config.sheetName}!A${existingRowNum}:N${existingRowNum}`,
        values: [row],
      });
    } else {
      appends.push(row);
    }
  }

  // Batch update existing rows (Sheets API limit: 1000 ranges per call)
  const CHUNK = 1000;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: chunk as any,
      },
    });
  }

  // Append new rows
  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestBody: { values: appends as any },
    });
  }

  console.log(
    `syncCompany [${companyId}]: ${updates.length} atualizados, ${appends.length} inseridos.`,
  );
}
