/**
 * POST /api/internal/reimbursement-approve
 *
 * Handles magic-link approval/rejection for Reimbursement Reports (RDs).
 * Called from the approve-reimbursement/[token] page.
 * Does NOT require auth cookie — authentication is the possession of the token.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const COLLECTION = "reimbursement_reports";

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

    // Find report by token
    const snapshot = await adminDb
      .collection(COLLECTION)
      .where("approvalToken", "==", token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: "Token inválido ou expirado." },
        { status: 404 },
      );
    }

    const docRef = snapshot.docs[0].ref;
    const data = snapshot.docs[0].data();

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
        approvalToken: null,
        approvalTokenExpiresAt: null,
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
      await docRef.update({
        status: "rejected",
        approvalToken: null,
        approvalTokenExpiresAt: null,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: reason.trim(),
        updatedAt: FieldValue.serverTimestamp(),
      });
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

    const snapshot = await adminDb
      .collection(COLLECTION)
      .where("approvalToken", "==", token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: "Token inválido ou expirado." },
        { status: 404 },
      );
    }

    const data = snapshot.docs[0].data();

    // Return safe subset of report data for the approval page
    return NextResponse.json({
      rdNumber: data.rdNumber,
      employeeName: data.employeeName,
      employeeDocument: data.employeeDocument,
      periodStart: (data.periodStart as Timestamp)?.toDate().toISOString(),
      periodEnd: (data.periodEnd as Timestamp)?.toDate().toISOString(),
      totalAmount: data.totalAmount,
      transactionCount: data.transactionIds?.length ?? 0,
      status: data.status,
      notes: data.notes,
    });
  } catch (error) {
    console.error("[reimbursement-approve] GET Error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 },
    );
  }
}
