/**
 * GET /api/v1/transactions
 *
 * Lista transações da empresa com filtros, paginação e ordenação.
 * Todos os resultados são sanitizados (campos sensíveis removidos).
 *
 * Query params:
 *   page, limit, type, status, startDate, endDate, allDates,
 *   costCenterId, costCenterIds, entityId, minAmount, maxAmount,
 *   search, sortBy, sortOrder
 *
 * Busca textual:
 *   - search: termo de busca textual (mín. 2 caracteres, máx. 100).
 *     Pesquisa case-insensitive nos campos description, notes e supplier.
 *     Quando presente, a filtragem é feita em memória após a query base,
 *     garantindo contagens e paginação precisas.
 *
 * Filtro por centro de custo:
 *   - costCenterId: filtra por um único centro de custo pelo ID (retrocompatível)
 *   - costCenterIds: filtra por um ou mais centros de custo pelo ID, separados por vírgula
 *     (ex: costCenterIds=id1,id2,id3). Máximo: 10.
 *   - costCenterCodes: filtra por um ou mais centros de custo pelo código (code),
 *     separados por vírgula (ex: costCenterCodes=MKT-001,VND-002). Máximo: 10.
 *   Prioridade: costCenterCodes > costCenterIds > costCenterId.
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

/** Máximo de documentos escaneados em memória para filtros client-side */
const MAX_CLIENT_SIDE_SCAN = 5_000;

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
  const costCenterCodesParam = searchParams.get("costCenterCodes");
  const entityIdParam = searchParams.get("entityId");
  const searchParam = searchParams.get("search");
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
  if (searchParam !== null && searchParam.length < 2) {
    return ApiErrors.badRequest(
      "Parameter 'search' must be at least 2 characters long.",
    );
  }
  if (searchParam !== null && searchParam.length > 100) {
    return ApiErrors.badRequest(
      "Parameter 'search' must be at most 100 characters long.",
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

  // Resolve lista de códigos de centro de custo
  const costCenterCodes: string[] = costCenterCodesParam
    ? costCenterCodesParam
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : [];

  // Resolve lista de IDs de centros de custo (costCenterIds tem prioridade sobre costCenterId)
  const costCenterIdsDirect: string[] = (() => {
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

  if (costCenterCodes.length > 10) {
    return ApiErrors.badRequest(
      "Too many cost center codes. Maximum allowed: 10.",
    );
  }
  if (costCenterIdsDirect.length > 10) {
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
    // ── Resolver costCenterCodes → IDs (se necessário) ─────────────────────
    let costCenterIds: string[] = costCenterIdsDirect;

    if (costCenterCodes.length > 0) {
      // Busca centros de custo pelo code para resolver os IDs
      const ccSnap = await adminDb
        .collection(COST_CENTERS_COLLECTION)
        .where("companyId", "==", companyId)
        .where("code", "in", costCenterCodes)
        .get();

      costCenterIds = ccSnap.docs.map((doc) => doc.id);

      if (costCenterIds.length === 0) {
        // Nenhum código encontrado — retorna resultado vazio ao invés de ignorar o filtro
        return apiSuccessPaginated(
          [],
          {
            page,
            limit,
            totalItems: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false,
          },
          {
            companyId,
            requestId,
            extra: {
              dateRange: allDates
                ? { startDate: null, endDate: null, isDefault: false }
                : {
                    startDate: effectiveStartDate!.toISOString().split("T")[0],
                    endDate: effectiveEndDate!.toISOString().split("T")[0],
                    isDefault: isDefaultDateRange,
                  },
              costCenterCodesNotFound: costCenterCodes,
            },
          },
        );
      }
    }

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

    // Normaliza o termo de busca para comparação case-insensitive
    const searchTerm = searchParam?.trim().toLowerCase() ?? null;
    const hasClientSideFilters =
      searchTerm !== null || minAmount !== null || maxAmount !== null;

    // ── Busca de centros de custo (sempre necessária para enriquecer dados)
    const costCentersSnap = await adminDb
      .collection(COST_CENTERS_COLLECTION)
      .where("companyId", "==", companyId)
      .get();

    // Mapa id → CostCenter para lookup eficiente
    const costCenterMap = new Map<string, CostCenter>();
    costCentersSnap.docs.forEach((doc) => {
      const data = doc.data() as CostCenter;
      costCenterMap.set(doc.id, { ...data, id: doc.id });
    });

    // Helper para converter doc → Transaction
    const docToTransaction = (
      doc: import("firebase-admin/firestore").QueryDocumentSnapshot,
    ): Transaction => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        dueDate: (data.dueDate as Timestamp)?.toDate() ?? new Date(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
        approvedAt: (data.approvedAt as Timestamp)?.toDate(),
        releasedAt: (data.releasedAt as Timestamp)?.toDate(),
        createdAt: (data.createdAt as Timestamp)?.toDate() ?? new Date(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate() ?? new Date(),
      } as Transaction;
    };

    // Helper para verificar se uma transação contém o termo de busca
    const matchesSearch = (txn: Transaction): boolean => {
      if (!searchTerm) return true;
      const fields = [txn.description, txn.notes, txn.supplierOrClient];
      return fields.some(
        (field) => field && field.toLowerCase().includes(searchTerm),
      );
    };

    let sanitized;
    let totalItems: number;
    let totalPages: number;

    if (hasClientSideFilters) {
      // ── Caminho com filtros client-side (search, minAmount, maxAmount) ──
      // Precisamos buscar TODOS os docs da query base, filtrar em memória,
      // e então aplicar paginação manualmente para garantir contagens corretas.
      // Cap de segurança: limita documentos escaneados para evitar sobrecarga.
      const allDocsQuery = baseQuery
        .orderBy(sortByParam, sortOrder)
        .limit(MAX_CLIENT_SIDE_SCAN);
      const allDocsSnap = await allDocsQuery.get();

      let transactions = allDocsSnap.docs.map(docToTransaction);

      // Aplica filtros client-side
      if (searchTerm) {
        transactions = transactions.filter(matchesSearch);
      }
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

      totalItems = transactions.length;
      totalPages = Math.ceil(totalItems / limit);

      // Aplica paginação em memória
      const paginatedTransactions = transactions.slice(offset, offset + limit);

      sanitized = paginatedTransactions.map((txn: Transaction) =>
        sanitizeTransaction(txn, costCenterMap),
      );
    } else {
      // ── Caminho padrão (sem filtros client-side) ─────────────────────────
      // Usa paginação nativa do Firestore para máxima performance.
      const [countSnap, dataSnap] = await Promise.all([
        baseQuery.count().get(),
        baseQuery
          .orderBy(sortByParam, sortOrder)
          .offset(offset)
          .limit(limit)
          .get(),
      ]);

      totalItems = countSnap.data().count ?? 0;
      totalPages = Math.ceil(totalItems / limit);

      const transactions = dataSnap.docs.map(docToTransaction);

      sanitized = transactions.map((txn: Transaction) =>
        sanitizeTransaction(txn, costCenterMap),
      );
    }

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
