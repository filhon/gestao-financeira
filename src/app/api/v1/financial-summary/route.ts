/**
 * GET /api/v1/financial-summary
 *
 * Retorna o resumo financeiro mensal da empresa vinculada à API Key.
 * Os dados são mantidos pela Cloud Function `updateFinancialSummary`.
 *
 * Query params:
 *   - year (number, padrão: ano corrente): ano a consultar
 *   - startMonth (YYYY-MM, opcional): mês inicial do intervalo
 *   - endMonth   (YYYY-MM, opcional): mês final do intervalo
 */
import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { authenticateApiRequest } from "@/lib/api/apiAuth";
import { writeApiAuditLog, extractQueryParams } from "@/lib/api/apiAudit";
import { apiSuccess, ApiErrors } from "@/lib/api/apiResponse";
import { logger } from "@/lib/logger";

const FINANCIAL_SUMMARIES_COLLECTION = "financial_summaries";

interface MonthlySummary {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  balance: number;
}

export async function GET(request: NextRequest) {
  // ── Autenticação ──────────────────────────────────────────────────────────
  const auth = await authenticateApiRequest(request, "financialSummary");
  if (!auth.success) return auth.response;
  const { context } = auth;
  const { companyId, requestId } = context;

  // ── Query params ─────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const currentYear = new Date().getFullYear();
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : currentYear;

  if (isNaN(year) || year < 2000 || year > currentYear + 5) {
    return ApiErrors.badRequest(
      "Parâmetro 'year' inválido. Use um ano entre 2000 e " +
        (currentYear + 5) +
        ".",
    );
  }

  // Intervalo mensal: padrão = ano completo (jan–dez)
  const defaultStart = `${year}-01`;
  const defaultEnd = `${year}-12`;
  const startMonth = searchParams.get("startMonth") ?? defaultStart;
  const endMonth = searchParams.get("endMonth") ?? defaultEnd;

  // Validação básica de formato YYYY-MM
  const monthRegex = /^\d{4}-\d{2}$/;
  if (!monthRegex.test(startMonth) || !monthRegex.test(endMonth)) {
    return ApiErrors.badRequest(
      "Parâmetros 'startMonth' e 'endMonth' devem estar no formato YYYY-MM.",
    );
  }

  if (startMonth > endMonth) {
    return ApiErrors.badRequest(
      "'startMonth' não pode ser maior que 'endMonth'.",
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";

  try {
    // ── Buscar resumos no intervalo ───────────────────────────────────────
    // Os documentos são identificados por `{companyId}_{YYYY-MM}`
    // Firestore não suporta range query em campo composto diretamente,
    // por isso filtramos por companyId e pelo campo `month` (string YYYY-MM).
    const snapshot = await adminDb
      .collection(FINANCIAL_SUMMARIES_COLLECTION)
      .where("companyId", "==", companyId)
      .where("month", ">=", startMonth)
      .where("month", "<=", endMonth)
      .orderBy("month", "asc")
      .get();

    const monthly: MonthlySummary[] = snapshot.docs.map((doc) => {
      const d = doc.data();
      const income = (d.income as number) ?? 0;
      const expense = (d.expense as number) ?? 0;
      return {
        month: d.month as string,
        income,
        expense,
        balance: income - expense,
      };
    });

    // ── Totalizadores ─────────────────────────────────────────────────────
    const totalIncome = monthly.reduce((sum, m) => sum + m.income, 0);
    const totalExpense = monthly.reduce((sum, m) => sum + m.expense, 0);

    // ── Auditoria ─────────────────────────────────────────────────────────
    await writeApiAuditLog(context, {
      endpoint: "/api/v1/financial-summary",
      method: "GET",
      queryParams: extractQueryParams(request.url),
      statusCode: 200,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    return apiSuccess(
      {
        year,
        period: { startMonth, endMonth },
        totals: {
          income: totalIncome,
          expense: totalExpense,
          balance: totalIncome - totalExpense,
          currency: "BRL",
        },
        monthly,
      },
      {
        requestId,
        companyId,
        cacheControl: "no-store",
      },
    );
  } catch (error) {
    logger.error("API financial-summary error", {
      requestId,
      companyId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      error,
    });
    return ApiErrors.internalError(requestId);
  }
}
