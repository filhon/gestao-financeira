/**
 * /api/internal/expense-submission
 *
 * Link pessoal do funcionário (página /enviar-despesa/[token]), sem login:
 *   GET    ?token=          empresa, funcionário e as notas que ele enviou
 *   POST   form(token,file) guarda a nota, lê com IA e checa duplicata
 *   PATCH  {token,id,...}   o funcionário corrige o que foi lido
 *   DELETE {token,id}       o funcionário remove uma nota ainda não lançada
 *
 * O token é a credencial: o documento do link tem como id o SHA-256 dele.
 * Só o Admin SDK escreve em `expense_submissions`; o link não lança despesa,
 * só põe a nota na caixa de entrada do financeiro.
 */
import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { extractReceiptData } from "@/lib/services/documentExtractionService";
import {
  normalizeAccessKey,
  receiptFlags,
  type DuplicateCandidate,
} from "@/lib/reimbursement/receiptChecks";

const SUBMISSIONS = "expense_submissions";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
// ponytail: limite por funcionário em 24 h, contado em memória; mover para
// contador se o volume crescer.
const DAILY_LIMIT = 60;

type Link = {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
};

const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

async function loadLink(token: unknown): Promise<Link | null> {
  if (typeof token !== "string" || token.length < 32) return null;
  const snap = await adminDb
    .collection("reimbursement_links")
    .doc(hashToken(token))
    .get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    id: snap.id,
    companyId: d.companyId,
    employeeId: d.employeeId,
    employeeName: d.employeeName,
  };
}

/** "2026-10-31" → meio-dia de Brasília (não vira o dia anterior em UTC). */
function parseDay(iso: unknown): Date | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00-03:00`);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && isFinite(n) && n > 0 && n < 1_000_000
    ? Math.round(n * 100) / 100
    : null;
}

const toDate = (v: unknown) => (v as Timestamp | null)?.toDate?.() ?? null;
const brDate = (d: Date | null) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

/** Notas do funcionário e as despesas de reembolso já lançadas para ele. */
async function employeeRecords(link: Link, accessKey?: string | null) {
  const [subs, txs, byKey] = await Promise.all([
    adminDb
      .collection(SUBMISSIONS)
      .where("companyId", "==", link.companyId)
      .where("employeeId", "==", link.employeeId)
      .get(),
    adminDb
      .collection("transactions")
      .where("companyId", "==", link.companyId)
      .where("entityId", "==", link.employeeId)
      .where("isReimbursement", "==", true)
      .get(),
    // A mesma nota pode ter sido mandada por um colega.
    accessKey
      ? adminDb
          .collection(SUBMISSIONS)
          .where("companyId", "==", link.companyId)
          .where("accessKey", "==", accessKey)
          .get()
      : null,
  ]);
  return { subs: subs.docs, txs: txs.docs, byKey: byKey?.docs ?? [] };
}

function candidates(
  link: Link,
  records: Awaited<ReturnType<typeof employeeRecords>>,
  excludeId?: string,
): DuplicateCandidate[] {
  const seen = new Set<string>();
  const subs = [...records.subs, ...records.byKey].filter((d) => {
    if (d.id === excludeId || seen.has(d.id)) return false;
    seen.add(d.id);
    return d.get("status") !== "refused";
  });
  return [
    ...subs.map((d) => ({
      kind: "submission" as const,
      id: d.id,
      label: `enviada em ${brDate(toDate(d.get("createdAt")))}${
        d.get("employeeId") !== link.employeeId
          ? ` por ${d.get("employeeName")}`
          : ""
      }`,
      amount: d.get("amount") ?? null,
      date: toDate(d.get("date")),
      supplierDocument: d.get("supplierDocument") ?? null,
      accessKey: d.get("accessKey") ?? null,
    })),
    ...records.txs
      .filter((d) => d.get("status") !== "rejected")
      .map((d) => ({
        kind: "transaction" as const,
        id: d.id,
        label: `"${d.get("description")}" de ${brDate(toDate(d.get("dueDate")))}`,
        amount: d.get("amount") ?? null,
        date: toDate(d.get("dueDate")),
      })),
  ];
}

function serialize(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id,
    status: d.status,
    description: d.description ?? "",
    amount: d.amount ?? null,
    date: toDate(d.date)?.toISOString() ?? null,
    supplierName: d.supplierName ?? null,
    note: d.note ?? "",
    flags: d.flags ?? [],
    attachment: { url: d.attachment?.url, type: d.attachment?.type },
    createdAt: toDate(d.createdAt)?.toISOString() ?? null,
  };
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    const link = await loadLink(token);
    if (!link) return fail("Link inválido ou revogado.", 404);

    const [company, records] = await Promise.all([
      adminDb.collection("companies").doc(link.companyId).get(),
      employeeRecords(link),
    ]);

    // Onde está o dinheiro: a despesa lançada diz se já entrou em RD ou foi paga.
    const txById = new Map(records.txs.map((d) => [d.id, d.data()]));
    const rdIds = [
      ...new Set(
        records.txs
          .map((d) => d.get("reimbursementReportId") as string | undefined)
          .filter((x): x is string => !!x),
      ),
    ];
    const rds = rdIds.length
      ? await adminDb.getAll(
          ...rdIds.map((id) =>
            adminDb.collection("reimbursement_reports").doc(id),
          ),
        )
      : [];
    const rdNumber = new Map(rds.map((d) => [d.id, d.get("rdNumber")]));

    const submissions = records.subs
      .map((doc) => {
        const d = doc.data();
        let stage = "Recebida";
        let detail = "O financeiro vai conferir.";
        if (d.status === "refused") {
          stage = "Recusada";
          detail = d.refusedReason ?? "";
        } else if (d.status === "launched") {
          const tx = d.transactionId ? txById.get(d.transactionId) : undefined;
          stage = "Lançada";
          detail = "Vai entrar no próximo relatório.";
          if (tx?.status === "paid") {
            stage = "Paga";
            detail = tx.paymentDate
              ? `em ${brDate(toDate(tx.paymentDate))}`
              : "";
          } else if (tx?.reimbursementReportId) {
            stage = "Em relatório";
            detail = rdNumber.get(tx.reimbursementReportId) ?? "";
          }
        }
        return { ...serialize(doc.id, d), stage, detail };
      })
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 50);

    return NextResponse.json({
      companyName: company.get("name") ?? "",
      employeeName: link.employeeName,
      submissions,
    });
  } catch (error) {
    console.error("[expense-submission] GET", error);
    return fail("Erro interno do servidor.", 500);
  }
}

// ── POST: nova nota ──────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const link = await loadLink(form.get("token"));
    if (!link) return fail("Link inválido ou revogado.", 404);

    const file = form.get("file");
    if (!(file instanceof File)) return fail("Envie a foto ou o PDF.", 400);
    if (!ALLOWED.test(file.type))
      return fail("Use foto (JPG, PNG, HEIC) ou PDF.", 415);
    if (file.size > MAX_BYTES) return fail("Arquivo acima de 8 MB.", 413);

    const before = await employeeRecords(link);
    const dayAgo = Date.now() - 86_400_000;
    const today = before.subs.filter(
      (d) => (toDate(d.get("createdAt"))?.getTime() ?? 0) > dayAgo,
    ).length;
    if (today >= DAILY_LIMIT)
      return fail("Limite de envios do dia atingido. Tente amanhã.", 429);

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileId = randomUUID();
    const downloadToken = randomUUID();
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "nota";
    const path = `transactions/${link.companyId}/${fileId}-${safeName}`;
    const bucket = adminStorage.bucket(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    );

    const [read] = await Promise.all([
      extractReceiptData(buffer, file.type),
      bucket.file(path).save(buffer, {
        contentType: file.type,
        metadata: {
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      }),
    ]);

    const accessKey = normalizeAccessKey(read.accessKey);
    const records = accessKey ? await employeeRecords(link, accessKey) : before;
    const facts = {
      amount: parseAmount(read.amount),
      date: parseDay(read.date),
      supplierDocument: read.supplierDocument?.replace(/\D/g, "") || null,
      accessKey,
      confidence: Number(read.confidence) || 0,
    };
    const flags = receiptFlags(facts, candidates(link, records));

    const data = {
      companyId: link.companyId,
      employeeId: link.employeeId,
      employeeName: link.employeeName,
      linkId: link.id,
      status: "pending",
      attachment: {
        id: fileId,
        url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`,
        name: file.name || safeName,
        type: file.type,
        path,
      },
      description:
        read.description?.trim() || read.supplierName?.trim() || "Despesa",
      amount: facts.amount,
      date: facts.date ? Timestamp.fromDate(facts.date) : null,
      supplierName: read.supplierName?.trim() || null,
      supplierDocument: facts.supplierDocument,
      accessKey,
      confidence: facts.confidence,
      note: "",
      flags,
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await adminDb.collection(SUBMISSIONS).add(data);

    return NextResponse.json(
      serialize(ref.id, { ...data, createdAt: Timestamp.now() }),
    );
  } catch (error) {
    console.error("[expense-submission] POST", error);
    return fail("Não foi possível enviar. Tente de novo.", 500);
  }
}

// ── PATCH / DELETE: só nota ainda não lançada, do próprio funcionário ────────

async function ownPending(link: Link, id: unknown) {
  if (typeof id !== "string" || !id) return null;
  const snap = await adminDb.collection(SUBMISSIONS).doc(id).get();
  if (
    !snap.exists ||
    snap.get("companyId") !== link.companyId ||
    snap.get("employeeId") !== link.employeeId
  )
    return null;
  return snap;
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const link = await loadLink(body.token);
    if (!link) return fail("Link inválido ou revogado.", 404);
    const snap = await ownPending(link, body.id);
    if (!snap) return fail("Nota não encontrada.", 404);
    if (snap.get("status") !== "pending")
      return fail("O financeiro já tratou esta nota.", 409);

    const amount = parseAmount(body.amount);
    const date = parseDay(body.date);
    const description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, 120)
        : snap.get("description");
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    const accessKey = snap.get("accessKey") ?? null;
    const records = await employeeRecords(link, accessKey);
    const flags = receiptFlags(
      {
        amount,
        date,
        supplierDocument: snap.get("supplierDocument") ?? null,
        accessKey,
        confidence: snap.get("confidence") ?? 0,
        edited: true,
      },
      candidates(link, records, snap.id),
    );

    const patch = {
      description: description || "Despesa",
      amount,
      date: date ? Timestamp.fromDate(date) : null,
      note,
      edited: true,
      flags,
    };
    await snap.ref.update(patch);
    return NextResponse.json(serialize(snap.id, { ...snap.data(), ...patch }));
  } catch (error) {
    console.error("[expense-submission] PATCH", error);
    return fail("Não foi possível salvar.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const link = await loadLink(body.token);
    if (!link) return fail("Link inválido ou revogado.", 404);
    const snap = await ownPending(link, body.id);
    if (!snap) return fail("Nota não encontrada.", 404);
    if (snap.get("status") !== "pending")
      return fail("O financeiro já tratou esta nota.", 409);

    await snap.ref.delete();
    const path = snap.get("attachment.path");
    if (path)
      await adminStorage
        .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
        .file(path)
        .delete()
        .catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[expense-submission] DELETE", error);
    return fail("Não foi possível remover.", 500);
  }
}
