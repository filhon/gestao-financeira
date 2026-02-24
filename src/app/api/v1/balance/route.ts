/**
 * GET /api/v1/balance
 *
 * Retorna o saldo realizado (efetivo) atual da empresa vinculada à API Key.
 * O saldo é mantido em tempo real pela Cloud Function `onTransactionWrite`.
 *
 * Query params:
 *   - includeProjected (boolean): incluir saldo projetado com entradas/saídas pendentes
 */
import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import { logger } from "@/lib/logger";
import { Timestamp } from "firebase-admin/firestore";

const COMPANY_STATS_COLLECTION = "company_stats";
const TRANSACTIONS_COLLECTION = "transactions";

export async function GET(request: NextRequest) {
  // ── Autenticação ──────────────────────────────────────────────────────────
  const auth = await authenticateApiRequest(request, "balance");
  if (!auth.success) return auth.response;
  const { context } = auth;
  const { companyId, requestId } = context;

  // ── Query params ─────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const includeProjected =
    searchParams.get("includeProjected") === "true" ||
    searchParams.get("includeProjected") === "1";

  try {
    // ── Saldo realizado ──────────────────────────────────────────────────────
    const statsDoc = await adminDb
      .collection(COMPANY_STATS_COLLECTION)
      .doc(companyId)
      .get();

    const statsData = statsDoc.data();
    const currentBalance: number = statsData?.currentBalance ?? 0;
    const updatedAt: Date = statsData?.updatedAt
      ? (statsData.updatedAt as Timestamp).toDate()
      : new Date();

    let responseData: Record<string, unknown> = {
      currentBalance,
      currency: "BRL",
      updatedAt: updatedAt.toISOString(),
    };

    // ── Saldo projetado (opcional) ───────────────────────────────────────────
    if (includeProjected) {
      const pendingStatuses = [
        "draft",
        "pending_approval",
        "approved",
        "pending_authorization",
        "authorized",
      ];

      const [pendingIncomeSnap, pendingExpenseSnap] = await Promise.all([
        adminDb
          .collection(TRANSACTIONS_COLLECTION)
          .where("companyId", "==", companyId)
          .where("type", "==", "receivable")
          .where("status", "in", pendingStatuses)
          .get(),
        adminDb
          .collection(TRANSACTIONS_COLLECTION)
          .where("companyId", "==", companyId)
          .where("type", "==", "payable")
          .where("status", "in", pendingStatuses)
          .get(),
      ]);

      const projectedIncome = pendingIncomeSnap.docs.reduce((acc, doc) => {
        return acc + (Number(doc.data().amount) || 0);
      }, 0);

      const projectedExpenses = pendingExpenseSnap.docs.reduce((acc, doc) => {
        return acc + (Number(doc.data().amount) || 0);
      }, 0);

      responseData = {
        ...responseData,
        projectedIncome,
        projectedExpenses,
        projectedBalance: currentBalance + projectedIncome - projectedExpenses,
      };
    }

    // ── Audit log ─────────────────────────────────────────────────────────
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "127.0.0.1";

    await writeApiAuditLog(context, {
      endpoint: "/api/v1/balance",
      method: "GET",
      queryParams: extractQueryParams(request.url),
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    // ── Resposta ─────────────────────────────────────────────────────────
    return apiSuccess(responseData, { companyId, requestId });
  } catch (error) {
    logger.error("GET /api/v1/balance failed", { error, companyId, requestId });
    return ApiErrors.internalError(requestId);
  }
}
