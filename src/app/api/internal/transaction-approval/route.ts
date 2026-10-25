/**
 * GET /api/internal/transaction-approval?token=...
 *
 * Loads the transaction for the /approve/[token] magic-link page.
 * Uses Admin SDK so Firestore rules are bypassed — the token IS the credential.
 * Approve/reject go through the approveTransactionByToken / rejectTransactionByToken
 * Cloud Functions, which revalidate the token themselves.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";

const iso = (v: unknown) =>
  v instanceof Timestamp ? v.toDate().toISOString() : null;

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { error: "Token é obrigatório." },
        { status: 400 },
      );
    }

    const snap = await adminDb
      .collection("transactions")
      .where("approvalToken", "==", token)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json(
        { error: "Link inválido ou expirado." },
        { status: 404 },
      );
    }

    const txDoc = snap.docs[0];
    const td = txDoc.data();

    const expiresAt = td.approvalTokenExpiresAt as Timestamp | undefined;
    if (expiresAt && expiresAt.toDate() < new Date()) {
      return NextResponse.json(
        { error: "Este link de aprovação expirou." },
        { status: 410 },
      );
    }

    if (td.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Esta transação não está mais aguardando aprovação." },
        { status: 409 },
      );
    }

    let costCenter: { name: string; description: string | null } | null = null;
    const ccId = td.costCenterAllocation?.[0]?.costCenterId as
      | string
      | undefined;
    if (ccId) {
      const ccSnap = await adminDb.collection("cost_centers").doc(ccId).get();
      // Tenant guard: only expose a cost center from the transaction's own company.
      if (ccSnap.exists && ccSnap.get("companyId") === td.companyId) {
        costCenter = {
          name: ccSnap.get("name") ?? "",
          description: ccSnap.get("description") ?? null,
        };
      }
    }

    return NextResponse.json({
      transaction: {
        id: txDoc.id,
        description: td.description ?? "",
        details: td.details ?? null,
        amount: td.amount ?? 0,
        dueDate: iso(td.dueDate),
        createdAt: iso(td.createdAt),
        requesterName: td.requestOrigin?.name ?? null,
      },
      costCenter,
    });
  } catch (error) {
    console.error("[transaction-approval] GET Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
