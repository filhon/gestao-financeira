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
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { logger } from "@/lib/logger";
import { buildAnalytics, monthsOf, type MonthRange } from "@/lib/analytics";
import type {
  ChartAccount,
  CostCenter,
  Entity,
  Transaction,
  UserRole,
} from "@/lib/types";

const ALLOWED: UserRole[] = ["admin", "financial_manager"];
const MAX_DOCS = 20_000;
const MAX_MONTHS = 36;
const CACHE_TTL_MS = 60_000;

/**
 * As contas de mês e dia usam o relógio do processo, que no servidor é UTC:
 * uma baixa às 22h de 31/03 em Brasília cairia em abril. Cada data vira o
 * mesmo horário de parede de São Paulo, no fuso do processo.
 */
const BRT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function wallClock(d: Date) {
  const p = Object.fromEntries(
    BRT.formatToParts(d).map((x) => [x.type, Number(x.value)]),
  );
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
const toWall = (v: unknown) =>
  v instanceof Timestamp ? wallClock(v.toDate()) : undefined;

interface CompanyData {
  transactions: Transaction[];
  accounts: ChartAccount[];
  costCenters: CostCenter[];
  entities: Pick<Entity, "id" | "name">[];
  anchorEntityId: string | null;
  capped: boolean;
}

async function load(companyId: string): Promise<CompanyData> {
  const byCompany = (name: string) =>
    adminDb.collection(name).where("companyId", "==", companyId);
  const [txSnap, accSnap, ccSnap, entSnap, companySnap] = await Promise.all([
    byCompany("transactions").limit(MAX_DOCS).get(),
    byCompany("chart_of_accounts").get(),
    byCompany("cost_centers").get(),
    byCompany("entities").select("name").get(),
    adminDb.collection("companies").doc(companyId).get(),
  ]);

  const transactions = txSnap.docs.flatMap((d) => {
    const data = d.data();
    const dueDate = toWall(data.dueDate);
    // Sem vencimento não há mês onde pôr o lançamento.
    if (!dueDate) return [];
    return [
      {
        ...data,
        id: d.id,
        dueDate,
        paymentDate: toWall(data.paymentDate),
        createdAt: toWall(data.createdAt),
        updatedAt: toWall(data.updatedAt),
      } as Transaction,
    ];
  });

  return {
    transactions,
    accounts: accSnap.docs.map(
      (d) => ({ ...d.data(), id: d.id }) as ChartAccount,
    ),
    costCenters: ccSnap.docs.map(
      (d) => ({ ...d.data(), id: d.id }) as CostCenter,
    ),
    entities: entSnap.docs.map((d) => ({ id: d.id, name: d.get("name") })),
    anchorEntityId: companySnap.get("analyticsAnchorEntityId") ?? null,
    capped: txSnap.size >= MAX_DOCS,
  };
}

// ponytail: cache por instância do servidor, só para trocar período e regime
// sem reler a empresa; `fresh=1` (botão Atualizar) passa por cima.
const cache = new Map<string, { at: number; data: Promise<CompanyData> }>();
function getData(companyId: string, fresh: boolean) {
  const hit = cache.get(companyId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = load(companyId);
  cache.set(companyId, { at: Date.now(), data });
  data.catch(() => cache.delete(companyId));
  return data;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId") ?? "";
  const access = await authorizeCompany(companyId);
  if (!access.ok) return access.response;
  if (!ALLOWED.includes(access.role)) {
    return NextResponse.json(
      {
        error: "A Análise é restrita a administradores e gestores financeiros.",
      },
      { status: 403 },
    );
  }

  const range: MonthRange = {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const compare = params.get("compare") ?? "none";
  const regime = params.get("regime") ?? "cash";
  if (
    !MONTH_RE.test(range.from) ||
    !MONTH_RE.test(range.to) ||
    range.from > range.to ||
    monthsOf(range).length > MAX_MONTHS ||
    !["none", "previous", "year"].includes(compare) ||
    !["cash", "competence"].includes(regime)
  ) {
    return NextResponse.json(
      { error: "Período, comparação ou regime inválido." },
      { status: 400 },
    );
  }

  try {
    const data = await getData(companyId, params.get("fresh") === "1");
    const report = buildAnalytics(data, {
      range,
      compare: compare as "none" | "previous" | "year",
      regime: regime as "cash" | "competence",
      today: wallClock(new Date()),
      anchorEntityId: data.anchorEntityId,
    });
    return NextResponse.json({
      report,
      meta: {
        transactionCount: data.transactions.length,
        capped: data.capped,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("Analytics error", { err, companyId });
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
