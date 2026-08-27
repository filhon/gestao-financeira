/**
 * GET /api/v1/transactions/search
 *
 * Endpoint leve e otimizado para busca textual de transações.
 * Projetado para uso em Typeahead/Combobox — retorna payload mínimo.
 *
 * Diferenças em relação a GET /api/v1/transactions?search=...:
 *   - Resposta compacta: apenas id, description, amount, type, status,
 *     dueDate, supplier e costCenter (nome+código).
 *   - Limite fixo de resultados (máx. 20) — ideal para listas de sugestões.
 *   - Cap de segurança: escaneia no máximo 5.000 documentos em memória.
 *   - Sem cálculo de paginação completa (não necessário para typeahead).
 *
 * Query params:
 *   q (obrigatório): termo de busca (mín. 2, máx. 100 caracteres)
 *   type: payable | receivable
 *   status: draft | pending_approval | approved | ... | paid | rejected
 *   startDate, endDate, allDates: filtros de data (mesma semântica do endpoint principal)
 *   costCenterId, costCenterIds, costCenterCodes: filtros de centro de custo
 *   limit: máximo de resultados (1–20, default: 10)
 */
import type { NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import { logger } from "@/lib/logger";
import type { CostCenter } from "@/lib/types";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";

/** Máximo de documentos escaneados em memória para evitar sobrecarga */
const MAX_SCAN_DOCS = 5_000;

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

/** Campos retornados para cada resultado de busca (payload mínimo) */
interface TransactionSearchResult {
  id: string;
  description: string;
  amount: number;
  type: string;
  status: string;
  dueDate: string;
  supplier?: string;
  costCenter?: { id: string; name: string; code: string } | null;
}

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

  const qParam = searchParams.get("q");
  const typeParam = searchParams.get("type");
  const statusParam = searchParams.get("status");
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const allDatesParam = searchParams.get("allDates");
  const allDates = allDatesParam === "true";
  const costCenterIdParam = searchParams.get("costCenterId");
  const costCenterIdsParam = searchParams.get("costCenterIds");
  const costCenterCodesParam = searchParams.get("costCenterCodes");
  const limitRaw = parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 10 : Math.min(limitRaw, 20);

  // ── Validações ───────────────────────────────────────────────────────────
  if (!qParam || qParam.trim().length === 0) {
    return ApiErrors.badRequest("Parameter 'q' is required for search.");
  }
  if (qParam.trim().length < 2) {
    return ApiErrors.badRequest(
      "Parameter 'q' must be at least 2 characters long.",
    );
  }
  if (qParam.trim().length > 100) {
    return ApiErrors.badRequest(
      "Parameter 'q' must be at most 100 characters long.",
    );
  }
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

  // Resolve centros de custo
  const costCenterCodes: string[] = costCenterCodesParam
    ? costCenterCodesParam
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
    : [];

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

  // ── Intervalo de datas ───────────────────────────────────────────────────
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

  const searchTerm = qParam.trim().toLowerCase();

  try {
    // ── Resolver costCenterCodes → IDs ─────────────────────────────────────
    let costCenterIds: string[] = costCenterIdsDirect;

    if (costCenterCodes.length > 0) {
      const ccSnap = await adminDb
        .collection(COST_CENTERS_COLLECTION)
        .where("companyId", "==", companyId)
        .where("code", "in", costCenterCodes)
        .get();

      costCenterIds = ccSnap.docs.map((doc) => doc.id);

      if (costCenterIds.length === 0) {
        return apiSuccess([], {
          companyId,
          requestId,
          extra: {
            totalResults: 0,
            scannedDocuments: 0,
            costCenterCodesNotFound: costCenterCodes,
          },
        });
      }
    }

    // ── Construir query base ───────────────────────────────────────────────
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

    // ── Buscar com cap de segurança ──────────────────────────────────────
    // Limita documentos escaneados para evitar sobrecarga de memória/custo.
    // Ordena por data de vencimento (mais recentes primeiro) para priorizar
    // transações relevantes quando o cap é atingido.
    const [docsSnap, costCentersSnap] = await Promise.all([
      baseQuery.orderBy("dueDate", "desc").limit(MAX_SCAN_DOCS).get(),
      adminDb
        .collection(COST_CENTERS_COLLECTION)
        .where("companyId", "==", companyId)
        .get(),
    ]);

    // Mapa de centros de custo para enriquecer resultados
    const costCenterMap = new Map<string, CostCenter>();
    costCentersSnap.docs.forEach((doc) => {
      const data = doc.data() as CostCenter;
      costCenterMap.set(doc.id, { ...data, id: doc.id });
    });

    const scannedDocuments = docsSnap.docs.length;

    // ── Filtrar e montar resultados leves ────────────────────────────────
    const results: TransactionSearchResult[] = [];

    for (const doc of docsSnap.docs) {
      if (results.length >= limit) break;

      const data = doc.data();
      const description: string = data.description ?? "";
      const details: string = data.details ?? "";
      const notes: string = data.notes ?? "";
      const supplierOrClient: string = data.supplierOrClient ?? "";

      // Busca case-insensitive por substring
      const matchesSearch =
        description.toLowerCase().includes(searchTerm) ||
        details.toLowerCase().includes(searchTerm) ||
        notes.toLowerCase().includes(searchTerm) ||
        supplierOrClient.toLowerCase().includes(searchTerm);

      if (!matchesSearch) continue;

      // Resolve centro de custo principal (payload mínimo)
      let costCenter: TransactionSearchResult["costCenter"] = null;
      if (data.costCenterId && costCenterMap.has(data.costCenterId)) {
        const cc = costCenterMap.get(data.costCenterId)!;
        costCenter = { id: cc.id, name: cc.name, code: cc.code };
      }

      const dueDate = (data.dueDate as Timestamp)?.toDate() ?? new Date();

      results.push({
        id: doc.id,
        description,
        amount: data.amount,
        type: data.type,
        status: data.status,
        dueDate: dueDate.toISOString(),
        ...(supplierOrClient ? { supplier: supplierOrClient } : {}),
        ...(costCenter ? { costCenter } : {}),
      });
    }

    // ── Audit log ─────────────────────────────────────────────────────────
    await writeApiAuditLog(context, {
      endpoint: "/api/v1/transactions/search",
      method: "GET",
      queryParams: extractQueryParams(request.url),
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    // ── Resposta ─────────────────────────────────────────────────────────
    return apiSuccess(results, {
      companyId,
      requestId,
      extra: {
        totalResults: results.length,
        scannedDocuments,
        scanCapped: scannedDocuments >= MAX_SCAN_DOCS,
      },
    });
  } catch (error) {
    logger.error("GET /api/v1/transactions/search failed", {
      error,
      companyId,
      requestId,
    });
    return ApiErrors.internalError(requestId);
  }
}
