/**
 * GET /api/internal/cdi?companyId=…&from=yyyy-MM-dd → { cdi: { "yyyy-MM-dd": % a.d. } }
 *
 * CDI diário (SGS 12 do Banco Central) para a curva das aplicações. Passa pelo
 * servidor para ficar em cache: a série só muda uma vez por dia útil.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { format, subYears } from "date-fns";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { logger } from "@/lib/logger";
import { parseSgs } from "@/lib/investment";

const SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const access = await authorizeCompany(params.get("companyId") ?? "");
  if (!access.ok) return access.response;

  const from = params.get("from") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json(
      { error: "Data inicial inválida." },
      { status: 400 },
    );
  }
  // A SGS recusa janelas de mais de 10 anos em série diária.
  const floor = format(subYears(new Date(), 10), "yyyy-MM-dd");
  const [y, m, d] = (from < floor ? floor : from).split("-");

  try {
    const res = await fetch(
      `${SGS}?formato=json&dataInicial=${d}/${m}/${y}&dataFinal=${format(new Date(), "dd/MM/yyyy")}`,
      { next: { revalidate: 6 * 3600 } },
    );
    if (!res.ok) throw new Error(`SGS ${res.status}`);
    return NextResponse.json({ cdi: parseSgs(await res.json()) });
  } catch (error) {
    logger.error("GET /api/internal/cdi failed", { error });
    return NextResponse.json(
      { error: "Banco Central indisponível para o CDI." },
      { status: 502 },
    );
  }
}
