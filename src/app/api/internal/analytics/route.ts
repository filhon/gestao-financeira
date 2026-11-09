/**
 * GET /api/internal/analytics?companyId=&from=yyyy-MM&to=yyyy-MM
 *     &compare=none|previous|year&regime=cash|competence[&fresh=1]
 *
 * Relatório da Análise (src/lib/analytics.ts). Os lançamentos da empresa são
 * lidos no servidor e só os agregados vão ao navegador. Mesmo público da
 * página: admin e gestor financeiro, que já veem a empresa inteira.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  authorizeAnalytics,
  getAnalyticsReport,
  parseReportParams,
} from "@/lib/analyticsServer";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId") ?? "";
  const access = await authorizeAnalytics(companyId);
  if (!access.ok) return access.response;

  const p = parseReportParams(Object.fromEntries(params));
  if (!p) {
    return NextResponse.json(
      { error: "Período, comparação ou regime inválido." },
      { status: 400 },
    );
  }

  try {
    const { report, meta } = await getAnalyticsReport(
      companyId,
      p,
      params.get("fresh") === "1",
    );
    return NextResponse.json({ report, meta });
  } catch (err) {
    logger.error("Analytics error", { err, companyId });
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
