/**
 * GET /api/v1/cost-centers
 *
 * Retorna a lista de centros de custo da empresa vinculada à API Key.
 *
 * Query params:
 *   - parentId (string, opcional): filtrar filhos de um centro específico (usar "root" para raiz)
 *   - includeHierarchy (boolean): retornar em estrutura hierárquica (padrão: false)
 *   - includeBudget (boolean): incluir dados de orçamento e saldo disponível (padrão: false)
 */
import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import {
  sanitizeCostCenter,
  type SanitizedCostCenter,
} from "@/lib/api/apiSanitizer";
import type { CostCenter } from "@/lib/types";
import { logger } from "@/lib/logger";

const COST_CENTERS_COLLECTION = "cost_centers";
const BUDGETS_COLLECTION = "budgets";
const COST_CENTER_USAGE_COLLECTION = "cost_center_usage";

interface RawCostCenter {
  id: string;
  name: string;
  code?: string;
  description?: string;
  parentId?: string | null;
  companyId: string;
  active?: boolean;
  allowedUserIds?: string[];
  approverEmail?: string;
  releaserEmail?: string;
  [key: string]: unknown;
}

/** Monta estrutura em árvore a partir de lista plana */
function buildHierarchy(items: SanitizedCostCenter[]): SanitizedCostCenter[] {
  const map = new Map<string, SanitizedCostCenter>();
  const roots: SanitizedCostCenter[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of map.values()) {
    if (item.parentId) {
      const parent = map.get(item.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(item);
        continue;
      }
    }
    roots.push(item);
  }

  return roots;
}

export async function GET(request: NextRequest) {
  // ── Autenticação ──────────────────────────────────────────────────────────
  const auth = await authenticateApiRequest(request, "costCenters");
  if (!auth.success) return auth.response;
  const { context } = auth;
  const { companyId, requestId } = context;

  // ── Query params ─────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const parentIdParam = searchParams.get("parentId"); // "root" → sem parentId
  const includeHierarchy =
    searchParams.get("includeHierarchy") === "true" ||
    searchParams.get("includeHierarchy") === "1";
  const includeBudget =
    searchParams.get("includeBudget") === "true" ||
    searchParams.get("includeBudget") === "1";

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";

  try {
    // ── Buscar centros de custo ───────────────────────────────────────────
    let query = adminDb
      .collection(COST_CENTERS_COLLECTION)
      .where("companyId", "==", companyId)
      .where("active", "==", true);

    if (parentIdParam === "root") {
      query = query.where("parentId", "==", null) as typeof query;
    } else if (parentIdParam) {
      query = query.where("parentId", "==", parentIdParam) as typeof query;
    }

    const snapshot = await query.orderBy("name").get();
    const rawCostCenters: RawCostCenter[] = snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as RawCostCenter,
    );

    // ── Orçamento e uso (opcional) ────────────────────────────────────────
    const budgetMap = new Map<string, { amount: number; year: number }>();
    const usageMap = new Map<string, number>();

    if (includeBudget && rawCostCenters.length > 0) {
      const currentYear = new Date().getFullYear();
      const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

      // Orçamentos do ano corrente
      const ccIds = rawCostCenters.map((cc) => cc.id);
      const chunkSize = 30;
      const budgetPromises: Promise<void>[] = [];

      for (let i = 0; i < ccIds.length; i += chunkSize) {
        const chunk = ccIds.slice(i, i + chunkSize);
        budgetPromises.push(
          adminDb
            .collection(BUDGETS_COLLECTION)
            .where("companyId", "==", companyId)
            .where("year", "==", currentYear)
            .where("costCenterId", "in", chunk)
            .get()
            .then((snap) => {
              snap.docs.forEach((doc) => {
                const d = doc.data();
                budgetMap.set(d.costCenterId as string, {
                  amount: (d.amount as number) ?? 0,
                  year: currentYear,
                });
              });
            }),
        );
      }

      // Uso do mês corrente
      const usagePromises: Promise<void>[] = [];
      for (let i = 0; i < ccIds.length; i += chunkSize) {
        const chunk = ccIds.slice(i, i + chunkSize);
        usagePromises.push(
          adminDb
            .collection(COST_CENTER_USAGE_COLLECTION)
            .where("companyId", "==", companyId)
            .where("month", "==", currentMonth)
            .where("costCenterId", "in", chunk)
            .get()
            .then((snap) => {
              snap.docs.forEach((doc) => {
                const d = doc.data();
                usageMap.set(
                  d.costCenterId as string,
                  (d.totalSpent as number) ?? 0,
                );
              });
            }),
        );
      }

      await Promise.all([...budgetPromises, ...usagePromises]);
    }

    // ── Sanitizar ─────────────────────────────────────────────────────────
    const sanitized: SanitizedCostCenter[] = rawCostCenters.map((cc) => {
      const budgetInfo = budgetMap.get(cc.id);
      const spent = usageMap.get(cc.id) ?? 0;

      // Enriquece o objeto com dados de orçamento antes de sanitizar
      const enriched = {
        ...cc,
        ...(budgetInfo && {
          budget: budgetInfo.amount,
          budgetYear: budgetInfo.year,
          availableBalance: budgetInfo.amount - spent,
        }),
      };

      return sanitizeCostCenter(enriched as CostCenter);
    });

    // ── Hierarquia (opcional) ─────────────────────────────────────────────
    const result = includeHierarchy ? buildHierarchy(sanitized) : sanitized;

    // ── Auditoria ─────────────────────────────────────────────────────────
    await writeApiAuditLog(context, {
      endpoint: "/api/v1/cost-centers",
      method: "GET",
      queryParams: extractQueryParams(request.url),
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    return apiSuccess(result, {
      requestId,
      companyId,
      extra: {
        total: sanitized.length,
        hierarchy: includeHierarchy,
        budgetIncluded: includeBudget,
      },
      cacheControl: "no-store",
    });
  } catch (error) {
    logger.error("API cost-centers error", { requestId, companyId, error });
    return ApiErrors.internalError(requestId);
  }
}
