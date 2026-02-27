/**
 * GET /api/v1/transactions
 *
 * Lista transações da empresa com filtros, paginação e ordenação.
 * Todos os resultados são sanitizados (campos sensíveis removidos).
 *
 * Query params:
 *   page, limit, type, status, startDate, endDate, allDates,
 *   costCenterId, costCenterIds, entityId, minAmount, maxAmount,
 *   sortBy, sortOrder
 *
 * Filtro por centro de custo:
 *   - costCenterId: filtra por um único centro de custo (retrocompatível)
 *   - costCenterIds: filtra por um ou mais centros de custo, separados por vírgula
 *     (ex: costCenterIds=cc1,cc2,cc3). Máximo: 10 IDs.
 *   Se ambos forem informados, costCenterIds tem prioridade.
 *
 * Intervalo padrão de datas:
 *   Quando startDate e endDate são omitidos (e allDates não é true),
 *   o endpoint retorna apenas transações com vencimento entre
 *   hoje (00:00) e hoje + 30 dias (23:59:59).
 *   Passe allDates=true para desabilitar esse filtro e retornar
 *   transações de qualquer período.
 */
import type { NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccessPaginated, ApiErrors } from "@/lib/api/apiResponse";
import { sanitizeTransaction } from "@/lib/api/apiSanitizer";
import { logger } from "@/lib/logger";
import type { Transaction, CostCenter } from "@/lib/types";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";

const VALID_SORT_FIELDS = new Set(["dueDate", "amount", "createdAt"]);
const VALID_SORT_ORDERS = new Set(["asc", "desc"]);
const VALID_TYPES = new Set(["payable", "receivable"]);
const VALID_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
  "paid",
  "rejected",
]);

export async function GET(request: NextRequest) {
  // ── Autenticação ──────────────────────────────────────────────────────────
  const auth = await authenticateApiRequest(request, "transactions");
  if (!auth.success) return auth.response;
  const { context } = auth;
  const { companyId, requestId } = context;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";

  // ── Query params ─────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const pageRaw = parseInt(searchParams.get("page") ?? "1", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "25", 10);
  const page = isNaN(pageRaw) || pageRaw < 1 ? 1 : pageRaw;
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 25 : Math.min(limitRaw, 100);
  const offset = (page - 1) * limit;

  const typeParam = searchParams.get("type");
  const statusParam = searchParams.get("status");
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const allDatesParam = searchParams.get("allDates");
  const allDates = allDatesParam === "true";
  const costCenterIdParam = searchParams.get("costCenterId");
  const costCenterIdsParam = searchParams.get("costCenterIds");
  const entityIdParam = searchParams.get("entityId");
  const minAmountParam = searchParams.get("minAmount");
  const maxAmountParam = searchParams.get("maxAmount");
  const sortByParam = searchParams.get("sortBy") ?? "dueDate";
  const sortOrderParam = searchParams.get("sortOrder") ?? "desc";

  // Validações
  if (typeParam && !VALID_TYPES.has(typeParam)) {
    return ApiErrors.badRequest(
      `Invalid 'type'. Must be: ${[...VALID_TYPES].join(", ")}`,
    );
  }
  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return ApiErrors.badRequest(
      `Invalid 'status'. Must be: ${[...VALID_STATUSES].join(", ")}`,
    );
  }
  if (!VALID_SORT_FIELDS.has(sortByParam)) {
    return ApiErrors.badRequest(
      `Invalid 'sortBy'. Must be: ${[...VALID_SORT_FIELDS].join(", ")}`,
    );
  }
  if (!VALID_SORT_ORDERS.has(sortOrderParam)) {
    return ApiErrors.badRequest("Invalid 'sortOrder'. Must be: asc, desc");
  }

  // Resolve lista de IDs de centros de custo (costCenterIds tem prioridade)
  const costCenterIds: string[] = (() => {
    if (costCenterIdsParam) {
      return costCenterIdsParam
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    }
    if (costCenterIdParam) {
      return [costCenterIdParam];
    }
    return [];
  })();

  if (costCenterIds.length > 10) {
    return ApiErrors.badRequest(
      "Too many cost center IDs. Maximum allowed: 10.",
    );
  }

  // Validação explícita das datas, quando informadas
  if (startDateParam && isNaN(new Date(startDateParam).getTime())) {
    return ApiErrors.badRequest(
      "Parâmetro 'startDate' inválido. Use o formato ISO 8601 (ex: 2026-01-01).",
    );
  }
  if (endDateParam && isNaN(new Date(endDateParam).getTime())) {
    return ApiErrors.badRequest(
      "Parâmetro 'endDate' inválido. Use o formato ISO 8601 (ex: 2026-12-31).",
    );
  }

  // ── Intervalo de datas efetivo ───────────────────────────────────────────
  // Padrão: hoje → hoje + 30 dias.
  // Desativado quando allDates=true ou quando o consumidor informa datas explícitas.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayPlus30 = new Date(todayStart);
  todayPlus30.setDate(todayStart.getDate() + 30);
  todayPlus30.setHours(23, 59, 59, 999);

  const effectiveStartDate: Date | null = allDates
    ? null
    : startDateParam
      ? new Date(startDateParam)
      : todayStart;
  const effectiveEndDate: Date | null = allDates
    ? null
    : endDateParam
      ? new Date(endDateParam)
      : todayPlus30;

  const isDefaultDateRange = !allDates && !startDateParam && !endDateParam;

  const sortOrder = sortOrderParam as "asc" | "desc";

  try {
    // ── Construir query base ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let baseQuery: any = adminDb
      .collection(TRANSACTIONS_COLLECTION)
      .where("companyId", "==", companyId);

    if (typeParam) {
      baseQuery = baseQuery.where("type", "==", typeParam);
    }
    if (statusParam) {
      baseQuery = baseQuery.where("status", "==", statusParam);
    }
    if (costCenterIds.length === 1) {
      baseQuery = baseQuery.where(
        "costCenterIds",
        "array-contains",
        costCenterIds[0],
      );
    } else if (costCenterIds.length > 1) {
      baseQuery = baseQuery.where(
        "costCenterIds",
        "array-contains-any",
        costCenterIds,
      );
    }
    if (entityIdParam) {
      baseQuery = baseQuery.where("entityId", "==", entityIdParam);
    }
    if (effectiveStartDate) {
      effectiveStartDate.setHours(0, 0, 0, 0);
      baseQuery = baseQuery.where(
        "dueDate",
        ">=",
        Timestamp.fromDate(effectiveStartDate),
      );
    }
    if (effectiveEndDate) {
      effectiveEndDate.setHours(23, 59, 59, 999);
      baseQuery = baseQuery.where(
        "dueDate",
        "<=",
        Timestamp.fromDate(effectiveEndDate),
      );
    }

    // Filtro por valor (client-side — Firestore não faz range em campos distintos sem índice composto)
    const minAmount = minAmountParam ? parseFloat(minAmountParam) : null;
    const maxAmount = maxAmountParam ? parseFloat(maxAmountParam) : null;

    // ── Contagem total ────────────────────────────────────────────────────
    const countSnap = await baseQuery.count().get();
    const totalItems: number = countSnap.data().count ?? 0;

    // ── Dados paginados ──────────────────────────────────────────────────
    const dataQuery = baseQuery
      .orderBy(sortByParam, sortOrder)
      .offset(offset)
      .limit(limit);

    const [dataSnap, costCentersSnap] = await Promise.all([
      dataQuery.get(),
      // Busca todos os centros de custo da empresa para enriquecer os dados
      adminDb
        .collection(COST_CENTERS_COLLECTION)
        .where("companyId", "==", companyId)
        .get(),
    ]);

    // Mapa id → CostCenter para lookup eficiente
    const costCenterMap = new Map<string, CostCenter>();
    costCentersSnap.docs.forEach((doc) => {
      const data = doc.data() as CostCenter;
      costCenterMap.set(doc.id, { ...data, id: doc.id });
    });

    // Converte e sanitiza transações
    let transactions = dataSnap.docs.map(
      (doc: import("firebase-admin/firestore").QueryDocumentSnapshot) => {
        const data = doc.data();
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
        return txn;
      },
    );

    // Filtros client-side (para os que não têm suporte eficiente no Firestore)
    if (minAmount !== null) {
      transactions = transactions.filter(
        (t: Transaction) => t.amount >= minAmount!,
      );
    }
    if (maxAmount !== null) {
      transactions = transactions.filter(
        (t: Transaction) => t.amount <= maxAmount!,
      );
    }

    const sanitized = transactions.map((txn: Transaction) =>
      sanitizeTransaction(txn, costCenterMap),
    );

    const totalPages = Math.ceil(totalItems / limit);

    // ── Audit log ─────────────────────────────────────────────────────────
    await writeApiAuditLog(context, {
      endpoint: "/api/v1/transactions",
      method: "GET",
      queryParams: extractQueryParams(request.url),
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    // ── Resposta ─────────────────────────────────────────────────────────
    const dateRangeMeta = allDates
      ? { startDate: null, endDate: null, isDefault: false }
      : {
          startDate: effectiveStartDate!.toISOString().split("T")[0],
          endDate: effectiveEndDate!.toISOString().split("T")[0],
          isDefault: isDefaultDateRange,
        };

    return apiSuccessPaginated(
      sanitized,
      {
        page,
        limit,
        totalItems,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      { companyId, requestId, extra: { dateRange: dateRangeMeta } },
    );
  } catch (error) {
    logger.error("GET /api/v1/transactions failed", {
      error,
      companyId,
      requestId,
    });
    return ApiErrors.internalError(requestId);
  }
}
