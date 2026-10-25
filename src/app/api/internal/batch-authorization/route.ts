/**
 * GET  /api/internal/batch-authorization?token=...
 * POST /api/internal/batch-authorization  { token }
 *
 * Server-side handler for the authorize-batch magic-link page.
 * Uses Admin SDK so Firestore rules are bypassed — the token IS the credential.
 * Token is validated (SHA-256 hash + expiration + status) server-side on every request.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function loadPendingBatch(token: string | null | undefined) {
  if (!token) return { error: "Token é obrigatório.", status: 400 };

  const snap = await adminDb
    .collection("payment_batches")
    .where("approvalTokenHash", "==", hashToken(token))
    .limit(1)
    .get();

  if (snap.empty) return { error: "Link inválido ou expirado.", status: 404 };

  const batchDoc = snap.docs[0];
  const data = batchDoc.data();

  const expiresAt = data.approvalTokenExpiresAt as Timestamp | undefined;
  if (expiresAt && expiresAt.toDate() < new Date()) {
    return {
      error: "Link expirado. Solicite um novo link ao gestor financeiro.",
      status: 410,
    };
  }

  if (data.status !== "pending_authorization") {
    return {
      error: "Este lote não está mais aguardando autorização.",
      status: 409,
    };
  }

  return { doc: batchDoc, data };
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    const result = await loadPendingBatch(token);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    const { doc: batchDoc, data } = result;
    return NextResponse.json({
      id: batchDoc.id,
      name: data.name ?? "",
      transactionCount: ((data.transactionIds as string[]) ?? []).length,
      totalAmount: data.totalAmount ?? 0,
    });
  } catch (error) {
    console.error("[batch-authorization] GET Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { token } = (await request.json()) as { token?: string };
    const result = await loadPendingBatch(token);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    const { doc: batchDoc, data } = result;
    const authorizerId = (data.authorizerId as string) ?? "magic-link";
    const authorizerEmail =
      (data.authorizerEmail as string) ?? "magic-link@system";

    // Transaction so two clicks on the same link can't both consume the token.
    const consumed = await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(batchDoc.ref);
      if (fresh.get("approvalTokenHash") !== hashToken(token!)) return false;
      tx.update(batchDoc.ref, {
        status: "authorized",
        authorizedBy: authorizerId,
        authorizedAt: FieldValue.serverTimestamp(),
        approvalTokenHash: null,
        approvalToken: null,
        approvalTokenExpiresAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (!consumed) {
      return NextResponse.json(
        { error: "Este link já foi utilizado." },
        { status: 409 },
      );
    }

    try {
      await adminDb.collection("audit_logs").add({
        companyId: data.companyId,
        userId: authorizerId,
        userEmail: authorizerEmail,
        action: "authorize",
        entity: "batch",
        entityId: batchDoc.id,
        details: { viaMagicLink: true, totalAmount: data.totalAmount ?? 0 },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("[batch-authorization] audit log failed:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[batch-authorization] POST Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
