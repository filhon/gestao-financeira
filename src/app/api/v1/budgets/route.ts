/**
 * GET /api/v1/budgets
 *
 * Retorna os orçamentos dos centros de custo da empresa por ano,
 * incluindo quanto foi consumido e o detalhamento mensal.
 *
 * Fontes:
 *   - cost_centers         → lista de centros de custo
 *   - budgets              → orçamento anual por centro de custo
 *   - cost_center_usage    → gasto real por centro de custo / mês
 *
 * Query params:
 *   - year (número, default: ano atual)
 *   - costCenterId (string, opcional)
 */
import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import { logger } from "@/lib/logger";

const COST_CENTERS_COLLECTION = "cost_centers";
const BUDGETS_COLLECTION = "budgets";
const USAGE_COLLECTION = "cost_center_usage";

type BudgetStatus =
  | "on_track"
  | "warning"
  | "critical"
  | "over_budget"
  | "no_budget";

function calculateStatus(
  consumed: number,
  budgetAmount: number | undefined,
  year: number,
): BudgetStatus {
  if (!budgetAmount || budgetAmount <= 0) return "no_budget";

  const consumedPct = (consumed / budgetAmount) * 100;

  if (consumedPct > 100) return "over_budget";

  // Calcula percentual proporcional ao período (mês atual dentro do ano)
  const today = new Date();
  const currentMonth = today.getFullYear() === year ? today.getMonth() + 1 : 12;
  const proportionalBudget = (budgetAmount * currentMonth) / 12;
  const proportionalPct =
    proportionalBudget > 0 ? (consumed / proportionalBudget) * 100 : 0;

  if (proportionalPct > 90) return "critical";
  if (proportionalPct > 75) return "warning";
  return "on_track";
}

export async function GET(request: NextRequest) {
  // ── Autenticação ──────────────────────────────────────────────────────────
  const auth = await authenticateApiRequest(request, "budgets");
  if (!auth.success) return auth.response;
  const { context } = auth;
  const { companyId, requestId } = context;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";

  // ── Query params ─────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const yearRaw = parseInt(
    searchParams.get("year") ?? String(new Date().getFullYear()),
    10,
  );
  const year = isNaN(yearRaw) ? new Date().getFullYear() : yearRaw;
  const costCenterIdFilter = searchParams.get("costCenterId");

  if (year < 2000 || year > 2100) {
    return ApiErrors.badRequest(
      "Invalid 'year'. Must be between 2000 and 2100.",
    );
  }

  try {
    // Meses do ano: "2026-01" até "2026-12"
    const paddedYear = String(year);
    const monthStart = `${paddedYear}-01`;
    const monthEnd = `${paddedYear}-12`;

    // Paralelo: centros de custo + orçamentos + uso
    const [ccSnap, budgetsSnap, usageSnap] = await Promise.all([
      costCenterIdFilter
        ? adminDb
            .collection(COST_CENTERS_COLLECTION)
            .doc(costCenterIdFilter)
            .get()
            .then((d) => ({ docs: d.exists ? [d] : [] }))
        : adminDb
            .collection(COST_CENTERS_COLLECTION)
            .where("companyId", "==", companyId)
            .get(),

      adminDb
        .collection(BUDGETS_COLLECTION)
        .where("companyId", "==", companyId)
        .where("year", "==", year)
        .get(),

      adminDb
        .collection(USAGE_COLLECTION)
        .where("companyId", "==", companyId)
        .where("monthKey", ">=", monthStart)
        .where("monthKey", "<=", monthEnd)
        .get(),
    ]);

    // Mapas para lookup
    const budgetByCostCenter = new Map<string, number>();
    budgetsSnap.docs.forEach((doc) => {
      const data = doc.data();
      budgetByCostCenter.set(data.costCenterId, Number(data.amount) || 0);
    });

    // usage: costCenterId → { monthKey → amount }
    const usageByCostCenter = new Map<string, Map<string, number>>();
    usageSnap.docs.forEach((doc) => {
      const data = doc.data();
      const ccId: string = data.costCenterId;
      const monthKey: string = data.monthKey;
      const amount: number = Number(data.amount) || 0;

      if (!usageByCostCenter.has(ccId)) {
        usageByCostCenter.set(ccId, new Map());
      }
      usageByCostCenter.get(ccId)!.set(monthKey, amount);
    });

    // ── Montar resultado ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (ccSnap as any).docs.map(
      (ccDoc: import("firebase-admin/firestore").DocumentSnapshot) => {
        const cc = ccDoc.data()!;
        const ccId = ccDoc.id;

        const budgetAmount = budgetByCostCenter.get(ccId);
        const monthlyMap =
          usageByCostCenter.get(ccId) ?? new Map<string, number>();

        // Total consumido no ano
        let consumed = 0;
        for (const amount of monthlyMap.values()) {
          consumed += amount;
        }

        // Detalhamento mensal (apenas meses com gasto)
        const monthlyBreakdown: Array<{ month: string; consumed: number }> = [];
        for (let m = 1; m <= 12; m++) {
          const monthKey = `${paddedYear}-${String(m).padStart(2, "0")}`;
          const monthConsumed = monthlyMap.get(monthKey) ?? 0;
          if (monthConsumed > 0) {
            monthlyBreakdown.push({ month: monthKey, consumed: monthConsumed });
          }
        }

        const remaining =
          budgetAmount !== undefined ? budgetAmount - consumed : undefined;

        const consumedPercentage =
          budgetAmount && budgetAmount > 0
            ? Math.round((consumed / budgetAmount) * 1000) / 10
            : null;

        const status = calculateStatus(consumed, budgetAmount, year);

        return {
          costCenter: {
            id: ccId,
            name: cc.name,
            code: cc.code,
          },
          year,
          budgetAmount: budgetAmount ?? null,
          consumed,
          remaining: remaining ?? null,
          consumedPercentage,
          monthlyBreakdown,
          status,
        };
      },
    );

    // ── Audit log ─────────────────────────────────────────────────────────
    await writeApiAuditLog(context, {
      endpoint: "/api/v1/budgets",
      method: "GET",
      queryParams: extractQueryParams(request.url),
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    // ── Resposta ─────────────────────────────────────────────────────────
    return apiSuccess(result, { companyId, requestId, extra: { year } });
  } catch (error) {
    logger.error("GET /api/v1/budgets failed", { error, companyId, requestId });
    return ApiErrors.internalError(requestId);
  }
}
