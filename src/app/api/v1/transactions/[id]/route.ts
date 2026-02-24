/**
 * GET /api/v1/transactions/:id
 *
 * Retorna os detalhes de uma transação específica da empresa.
 * Valida que a transação pertence à empresa vinculada à API Key.
 */
import type { NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import { sanitizeTransaction } from "@/lib/api/apiSanitizer";
import { logger } from "@/lib/logger";
import type { Transaction, CostCenter } from "@/lib/types";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Autenticação ──────────────────────────────────────────────────────────
  const auth = await authenticateApiRequest(request, "transactions");
  if (!auth.success) return auth.response;
  const { context } = auth;
  const { companyId, requestId } = context;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";

  const { id } = await params;

  if (!id) {
    return ApiErrors.badRequest("Transaction ID is required");
  }

  try {
    // ── Buscar transação ──────────────────────────────────────────────────
    const doc = await adminDb.collection(TRANSACTIONS_COLLECTION).doc(id).get();

    if (!doc.exists) {
      return ApiErrors.notFound("Transaction");
    }

    const data = doc.data()!;

    // ── Validar isolamento de tenant ─────────────────────────────────────
    if (data.companyId !== companyId) {
      // Retornamos 404 intencionalmente (não 403) para não confirmar existência
      return ApiErrors.notFound("Transaction");
    }

    // ── Converter datas ───────────────────────────────────────────────────
    const txn: Transaction = {
      id: doc.id,
      ...data,
      dueDate: (data.dueDate as Timestamp)?.toDate() ?? new Date(),
      paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      approvedAt: (data.approvedAt as Timestamp)?.toDate(),
      releasedAt: (data.releasedAt as Timestamp)?.toDate(),
      createdAt: (data.createdAt as Timestamp)?.toDate() ?? new Date(),
      updatedAt: (data.updatedAt as Timestamp)?.toDate() ?? new Date(),
    } as Transaction;

    // ── Enriquecer com dados do centro de custo ───────────────────────────
    const costCenterMap = new Map<string, CostCenter>();
    const costCenterIds = new Set<string>();

    if (txn.costCenterId) costCenterIds.add(txn.costCenterId);
    txn.costCenterAllocation?.forEach((a) => costCenterIds.add(a.costCenterId));

    if (costCenterIds.size > 0) {
      const ids = [...costCenterIds];
      // Chunks de até 30 (limite do Firestore para `in`)
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 30) {
        chunks.push(ids.slice(i, i + 30));
      }

      await Promise.all(
        chunks.map(async (chunk) => {
          const snap = await adminDb
            .collection(COST_CENTERS_COLLECTION)
            .where("__name__", "in", chunk)
            .get();
          snap.docs.forEach((ccDoc) => {
            costCenterMap.set(ccDoc.id, {
              id: ccDoc.id,
              ...(ccDoc.data() as Omit<CostCenter, "id">),
            });
          });
        }),
      );
    }

    // ── Audit log ─────────────────────────────────────────────────────────
    await writeApiAuditLog(context, {
      endpoint: `/api/v1/transactions/${id}`,
      method: "GET",
      queryParams: {},
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    // ── Resposta sanitizada ───────────────────────────────────────────────
    return apiSuccess(sanitizeTransaction(txn, costCenterMap), {
      companyId,
      requestId,
    });
  } catch (error) {
    logger.error("GET /api/v1/transactions/:id failed", {
      error,
      id,
      companyId,
      requestId,
    });
    return ApiErrors.internalError(requestId);
  }
}
