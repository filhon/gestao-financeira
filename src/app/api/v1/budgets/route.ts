/**
 * GET /api/v1/budgets
 *
 * Retorna os orçamentos dos centros de custo da empresa por ano,
 * incluindo quanto foi consumido e o detalhamento mensal.
 *
 * Fontes:
 *   - cost_centers        → lista de centros de custo
 *   - cost_center_ledger  → envelope anual e consumo por centro de custo
 *   - transactions        → detalhamento mensal do gasto
 *
 * O formato da resposta é o mesmo de antes, mas os números passaram a sair do
 * razão de envelope. Duas mudanças de significado que valem para quem consome:
 *
 *   • `budgetAmount` é o envelope do exercício — o que o centro recebeu do pai
 *     (ou, na raiz, as receitas do ano) mais a sobra consolidada do anterior.
 *     Antes vinha da coleção `budgets`, preenchida à mão e sem relação com o
 *     que de fato havia sido distribuído.
 *
 *   • `consumed` inclui o que o centro distribuiu aos filhos, não só o gasto
 *     direto. No modelo de envelope, distribuir esvazia o bolso de quem
 *     distribuiu. Para centros folha — que são os que têm despesa — nada muda.
 *
 * Query params:
 *   - year (número, default: ano atual)
 *   - costCenterId (string, opcional)
 */
import type { NextRequest } from "next/server";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import {
  readCostCenters,
  readLedgerBalances,
  readMonthlySpend,
} from "@/lib/api/costCenterLedgerAdmin";
import { logger } from "@/lib/logger";

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
    const paddedYear = String(year);

    // A árvore inteira é necessária para o razão — a raiz define o carry-over —
    // mesmo quando a resposta é filtrada por um centro só.
    const allCostCenters = await readCostCenters(companyId);

    let balances;
    try {
      balances = await readLedgerBalances(companyId, allCostCenters, year);
    } catch (error) {
      logger.error("GET /api/v1/budgets: invalid cost center hierarchy", {
        error,
        companyId,
        requestId,
      });
      return ApiErrors.internalError(requestId);
    }

    const monthlySpend = await readMonthlySpend(companyId, year);

    const visible = costCenterIdFilter
      ? allCostCenters.filter((cc) => cc.id === costCenterIdFilter)
      : allCostCenters;

    const result = visible.map((cc) => {
      const balance = balances[cc.id];
      const envelope = balance ? balance.received + balance.carryIn : 0;
      // Envelope zero significa "sem orçamento definido", como o `undefined`
      // da coleção antiga: mantém `budgetAmount: null` e status `no_budget`.
      const budgetAmount = envelope > 0 ? envelope : undefined;

      const consumed = balance
        ? balance.allocatedToChildren + balance.spentDirect
        : 0;

      // Detalhamento mensal (apenas meses com gasto)
      const monthlyMap = monthlySpend.get(cc.id) ?? new Map<string, number>();
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
          id: cc.id,
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
    });

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
