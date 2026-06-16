/**
 * POST /api/internal/batch-approval
 * GET  /api/internal/batch-approval?token=...
 *
 * Server-side handler for the approve-batch magic-link page.
 * Uses Admin SDK so Firestore rules are bypassed — the token IS the credential.
 * Token is validated (SHA-256 hash + expiration) server-side on every request.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const BATCHES = "payment_batches";
const TRANSACTIONS = "transactions";
const COST_CENTERS = "cost_centers";
const AUDIT_LOGS = "audit_logs";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function logAudit(entry: {
  companyId: string;
  userId: string;
  userEmail: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await adminDb.collection(AUDIT_LOGS).add({
      ...entry,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[batch-approval] audit log failed:", err);
  }
}

/** Looks up a pending_approval batch by token. Returns null for not-found, error obj for invalid state. */
async function loadPendingBatch(token: string) {
  const snap = await adminDb
    .collection(BATCHES)
    .where("approvalTokenHash", "==", hashToken(token))
    .limit(1)
    .get();

  if (snap.empty) return null;

  const batchDoc = snap.docs[0];
  const data = batchDoc.data();

  const expiresAt = data.approvalTokenExpiresAt as Timestamp | undefined;
  if (expiresAt && expiresAt.toDate() < new Date()) {
    return {
      error: "Link expirado. Solicite um novo link ao gestor financeiro.",
      status: 410,
    };
  }

  if (data.status !== "pending_approval") {
    return {
      error:
        "Este lote não está mais aguardando aprovação. Verifique com o gestor financeiro.",
      status: 409,
    };
  }

  return { doc: batchDoc, data };
}

// ---------------------------------------------------------------------------
// GET — load batch, transactions, and cost centers for the approval page
// ---------------------------------------------------------------------------
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

    const result = await loadPendingBatch(token);

    if (!result) {
      return NextResponse.json(
        { error: "Link inválido ou expirado." },
        { status: 404 },
      );
    }
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    const { doc: batchDoc, data } = result;
    const batchId = batchDoc.id;

    const [txSnap, ccSnap] = await Promise.all([
      adminDb
        .collection(TRANSACTIONS)
        .where("batchId", "==", batchId)
        .limit(500)
        .get(),
      adminDb
        .collection(COST_CENTERS)
        .where("companyId", "==", data.companyId)
        .select("name", "parentId")
        .get(),
    ]);

    const transactions = txSnap.docs.map((d) => {
      const td = d.data();
      return {
        id: d.id,
        description: td.description ?? "",
        amount: td.amount ?? 0,
        dueDate: (td.dueDate as Timestamp)?.toDate().toISOString() ?? null,
        createdAt: (td.createdAt as Timestamp)?.toDate().toISOString() ?? null,
        costCenterId: td.costCenterId ?? null,
        supplierOrClient: td.supplierOrClient ?? null,
      };
    });

    const costCenters = ccSnap.docs.map((d) => {
      const cd = d.data();
      return {
        id: d.id,
        name: cd.name ?? "",
        parentId: cd.parentId ?? null,
      };
    });

    return NextResponse.json({
      batch: {
        id: batchId,
        name: data.name ?? "",
        status: data.status,
        companyId: data.companyId,
      },
      transactions,
      costCenters,
    });
  } catch (error) {
    console.error("[batch-approval] GET Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — approve | reject-transaction | return
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, action } = body as { token?: string; action?: string };

    if (!token || !action) {
      return NextResponse.json(
        { error: "Token e ação são obrigatórios." },
        { status: 400 },
      );
    }

    const result = await loadPendingBatch(token);

    if (!result) {
      return NextResponse.json(
        { error: "Link inválido ou expirado." },
        { status: 404 },
      );
    }
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    const { doc: batchDoc, data: batchData } = result;

    const approverId: string = (batchData.approverId as string) ?? "magic-link";
    const approverEmail: string =
      (batchData.approverEmail as string) ?? "magic-link@system";

    // -----------------------------------------------------------------------
    // approve
    // -----------------------------------------------------------------------
    if (action === "approve") {
      const comment: string | undefined = body.comment;
      const adjustments: Array<{ id: string; adjustedAmount: number }> =
        body.adjustments ?? [];

      const adjustmentMap = new Map(
        adjustments.map((a) => [a.id, a.adjustedAmount]),
      );

      const allTxSnap = await adminDb
        .collection(TRANSACTIONS)
        .where("batchId", "==", batchDoc.id)
        .get();

      const fsWriteBatch = adminDb.batch();

      let newTotalAmount = 0;
      allTxSnap.docs.forEach((tDoc) => {
        const originalAmount = (tDoc.data().amount as number) ?? 0;
        const adjustedAmount = adjustmentMap.get(tDoc.id);
        newTotalAmount += adjustedAmount ?? originalAmount;
      });

      const batchUpdate: Record<string, unknown> = {
        status: "approved",
        approvedBy: approverId,
        approvedAt: FieldValue.serverTimestamp(),
        approvalTokenHash: null,
        approvalToken: null,
        approvalTokenExpiresAt: null,
        totalAmount: newTotalAmount,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (comment) batchUpdate.approverComment = comment;
      fsWriteBatch.update(batchDoc.ref, batchUpdate);

      allTxSnap.docs.forEach((tDoc) => {
        const txUpdate: Record<string, unknown> = {
          status: "approved",
          approvedBy: approverId,
          approvedAt: FieldValue.serverTimestamp(),
        };
        if (adjustmentMap.has(tDoc.id)) {
          txUpdate.batchAdjustedAmount = adjustmentMap.get(tDoc.id);
        }
        fsWriteBatch.update(tDoc.ref, txUpdate);
      });

      await fsWriteBatch.commit();

      await logAudit({
        companyId: batchData.companyId as string,
        userId: approverId,
        userEmail: approverEmail,
        action: "approve",
        entity: "batch",
        entityId: batchDoc.id,
        details: {
          transactionCount: allTxSnap.size,
          adjustmentCount: adjustments.length,
          totalAmount: newTotalAmount,
          ...(comment ? { comment } : {}),
        },
      });

      return NextResponse.json({ success: true });
    }

    // -----------------------------------------------------------------------
    // reject-transaction
    // -----------------------------------------------------------------------
    if (action === "reject-transaction") {
      const transactionId: string | undefined = body.transactionId;
      const reason: string | undefined = body.reason;

      if (!transactionId || !reason?.trim()) {
        return NextResponse.json(
          { error: "transactionId e motivo são obrigatórios." },
          { status: 400 },
        );
      }

      const tRef = adminDb.collection(TRANSACTIONS).doc(transactionId);
      const tSnap = await tRef.get();
      if (!tSnap.exists) {
        return NextResponse.json(
          { error: "Transação não encontrada." },
          { status: 404 },
        );
      }
      const tData = tSnap.data()!;

      const newTransactionIds = (
        (batchData.transactionIds as string[]) ?? []
      ).filter((id) => id !== transactionId);

      const rejectedIds = [
        ...((batchData.rejectedTransactionIds as string[]) ?? []),
        transactionId,
      ];

      const fsWriteBatch = adminDb.batch();

      fsWriteBatch.update(batchDoc.ref, {
        transactionIds: newTransactionIds,
        rejectedTransactionIds: rejectedIds,
        totalAmount: Math.max(
          0,
          (batchData.totalAmount as number) - (tData.amount as number),
        ),
        updatedAt: FieldValue.serverTimestamp(),
      });

      fsWriteBatch.update(tRef, {
        batchId: null,
        batchRejectionReason: reason.trim(),
        status: "draft",
      });

      await fsWriteBatch.commit();

      await logAudit({
        companyId: batchData.companyId as string,
        userId: approverId,
        userEmail: approverEmail,
        action: "reject",
        entity: "batch",
        entityId: batchDoc.id,
        details: { transactionId, reason: reason.trim() },
      });

      return NextResponse.json({ success: true });
    }

    // -----------------------------------------------------------------------
    // return
    // -----------------------------------------------------------------------
    if (action === "return") {
      const reason: string | undefined = body.reason;

      if (!reason?.trim()) {
        return NextResponse.json(
          { error: "Informe o motivo da devolução." },
          { status: 400 },
        );
      }

      await batchDoc.ref.update({
        status: "open",
        approvalTokenHash: null,
        approvalToken: null,
        approvalTokenExpiresAt: null,
        approverId: null,
        approverEmail: null,
        approverComment: `Devolvido: ${reason.trim()}`,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logAudit({
        companyId: batchData.companyId as string,
        userId: approverId,
        userEmail: approverEmail,
        action: "update",
        entity: "batch",
        entityId: batchDoc.id,
        details: { returnedToManager: true, reason: reason.trim() },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.error("[batch-approval] POST Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
