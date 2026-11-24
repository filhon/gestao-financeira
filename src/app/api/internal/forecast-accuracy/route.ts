/**
 * GET /api/internal/forecast-accuracy?companyId=[&fresh=1]
 *
 * Índice de acerto da previsão (src/lib/forecastAccuracy.ts). Lê os lançamentos
 * e a auditoria de edições no servidor e devolve só os agregados e as maiores
 * diferenças. Mesmo público dos Relatórios.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { getCompanyData, wallClock } from "@/lib/analyticsServer";
import { authorizeCompany } from "@/lib/api/companyAccess";
import {
  buildAccuracy,
  historyOf,
  type AccuracyReport,
} from "@/lib/forecastAccuracy";

const READERS = [
  "admin",
  "financial_manager",
  "approver",
  "releaser",
  "auditor",
];

// ponytail: cache por instância; a medição muda uma vez por semana e relê
// milhares de logs, então meia hora é folga.
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; data: Promise<AccuracyReport> }>();

/** Datas na auditoria: Timestamp do Admin ou o objeto serializado. */
function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return wallClock(v.toDate());
  const s =
    (v as { seconds?: number; _seconds?: number } | null)?.seconds ??
    (v as { _seconds?: number } | null)?._seconds;
  if (typeof s === "number") return wallClock(new Date(s * 1000));
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : wallClock(d);
  }
  return null;
}

async function measure(companyId: string, fresh: boolean) {
  const [company, logs] = await Promise.all([
    getCompanyData(companyId, fresh),
    adminDb
      .collection("audit_logs")
      .where("companyId", "==", companyId)
      .where("entity", "==", "transaction")
      .where("action", "==", "update")
      .select("entityId", "createdAt", "details")
      .get(),
  ]);
  const names = new Map(company.entities.map((e) => [e.id, e.name]));
  return buildAccuracy(
    company.transactions,
    historyOf(
      logs.docs.map((d) => ({
        entityId: d.get("entityId"),
        createdAt: toDate(d.get("createdAt")) ?? undefined,
        details: d.get("details"),
      })),
      toDate,
    ),
    wallClock(new Date()),
    (t) => names.get(t.entityId ?? "") || t.supplierOrClient || "",
  );
}

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId") ?? "";
  const access = await authorizeCompany(companyId);
  if (!access.ok) return access.response;
  if (!READERS.includes(access.role))
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const hit = cache.get(companyId);
  if (fresh || !hit || Date.now() - hit.at > TTL_MS) {
    const data = measure(companyId, fresh);
    cache.set(companyId, { at: Date.now(), data });
    data.catch(() => cache.delete(companyId));
  }
  try {
    return NextResponse.json(await cache.get(companyId)!.data);
  } catch (err) {
    logger.error("Forecast accuracy error", { err, companyId });
    return NextResponse.json(
      { error: "Não foi possível medir a previsão." },
      { status: 500 },
    );
  }
}
