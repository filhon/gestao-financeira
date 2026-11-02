/**
 * POST /api/internal/reimbursement-approve
 *
 * Handles magic-link approval/rejection for Reimbursement Reports (RDs).
 * Called from the approve-reimbursement/[token] page.
 * Does NOT require auth cookie: authentication is the possession of the token.
 * Only the SHA-256 hash of the token is stored.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const COLLECTION = "reimbursement_reports";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function findByToken(token: string) {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("approvalTokenHash", "==", hashToken(token))
    .limit(1)
    .get();
  return snapshot.empty ? null : snapshot.docs[0];
}

export async function POST(request: Request) {
  try {
    const { token, action, reason } = await request.json();

    if (!token || !action) {
      return NextResponse.json(
        { error: "Token e ação são obrigatórios." },
        { status: 400 },
      );
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }

    const found = await findByToken(token);
    if (!found) {
      return NextResponse.json(
        { error: "Token inválido ou expirado." },
        { status: 404 },
      );
    }

    const docRef = found.ref;
    const data = found.data();

    if (data.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Este relatório não está aguardando aprovação." },
        { status: 409 },
      );
    }

    // Check token expiry
    const expiresAt = data.approvalTokenExpiresAt as Timestamp | undefined;
    if (expiresAt && expiresAt.toDate() < new Date()) {
      return NextResponse.json(
        { error: "O link de aprovação expirou." },
        { status: 410 },
      );
    }

    if (action === "approve") {
      await docRef.update({
        status: "approved",
        approvalTokenHash: null,
        approvalTokenExpiresAt: null,
        approvedBy: `magic-link:${data.approverEmail ?? ""}`,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      if (!reason || reason.trim().length < 3) {
        return NextResponse.json(
          { error: "Informe o motivo da recusa (mínimo 3 caracteres)." },
          { status: 400 },
        );
      }
      // Recusar devolve os itens à fila, para entrarem num relatório novo.
      const batch = adminDb.batch();
      batch.update(docRef, {
        status: "rejected",
        approvalTokenHash: null,
        approvalTokenExpiresAt: null,
        rejectedBy: `magic-link:${data.approverEmail ?? ""}`,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: reason.trim(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const ids: string[] = data.transactionIds ?? [];
      const items = ids.length
        ? await adminDb.getAll(
            ...ids.map((id) => adminDb.collection("transactions").doc(id)),
          )
        : [];
      for (const item of items) {
        if (!item.exists) continue;
        const linked = item.get("reimbursementReportId");
        if (linked && linked !== docRef.id) continue;
        batch.update(item.ref, {
          reimbursementReportId: FieldValue.delete(),
        });
      }
      await batch.commit();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[reimbursement-approve] Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Token é obrigatório." },
        { status: 400 },
      );
    }

    const found = await findByToken(token);
    if (!found) {
      return NextResponse.json(
        { error: "Token inválido ou expirado." },
        { status: 404 },
      );
    }

    const data = found.data();
    const ids: string[] = data.transactionIds ?? [];
    const items = ids.length
      ? await adminDb.getAll(
          ...ids.map((id) => adminDb.collection("transactions").doc(id)),
        )
      : [];

    // Return safe subset of report data for the approval page. Quem aprova
    // precisa ver cada despesa e a nota dela, não só o total.
    return NextResponse.json({
      rdNumber: data.rdNumber,
      employeeName: data.employeeName,
      employeeDocument: data.employeeDocument,
      periodStart: (data.periodStart as Timestamp)?.toDate().toISOString(),
      periodEnd: (data.periodEnd as Timestamp)?.toDate().toISOString(),
      totalAmount: data.totalAmount,
      transactionCount: ids.length,
      status: data.status,
      notes: data.notes,
      items: items
        .filter((d) => d.exists)
        .map((d) => {
          const t = d.data()!;
          const paid = t.status === "paid" && t.finalAmount;
          return {
            date: (t.dueDate as Timestamp)?.toDate().toISOString(),
            description: t.description ?? "",
            amount: paid ? t.finalAmount : t.amount,
            attachments: (
              (t.attachments ?? []) as Array<{
                name?: string;
                url?: string;
              }>
            )
              .filter((a) => !!a.url)
              .map((a) => ({ name: a.name ?? "Nota", url: a.url })),
          };
        })
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    });
  } catch (error) {
    console.error("[reimbursement-approve] GET Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
