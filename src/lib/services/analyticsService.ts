import { db } from "@/lib/firebase/client";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { auditService } from "@/lib/services/auditService";
import type { AnalyticsReport, MonthRange } from "@/lib/analytics";
import type { DreRegime } from "@/lib/chartOfAccounts";

export interface AnalyticsParams {
  range: MonthRange;
  compare: "none" | "previous" | "year";
  regime: DreRegime;
}

export interface AnalyticsResponse {
  report: AnalyticsReport;
  meta: { transactionCount: number; capped: boolean; generatedAt: string };
}

type Actor = { uid: string; email: string };

export const analyticsService = {
  async getReport(
    companyId: string,
    p: AnalyticsParams,
    opts: { fresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<AnalyticsResponse> {
    const params = new URLSearchParams({
      companyId,
      from: p.range.from,
      to: p.range.to,
      compare: p.compare,
      regime: p.regime,
    });
    if (opts.fresh) params.set("fresh", "1");
    const res = await fetch(`/api/internal/analytics?${params}`, {
      credentials: "include",
      signal: opts.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(json.error ?? `A análise falhou (${res.status}).`);
    return json as AnalyticsResponse;
  },

  /** Entidade contra a qual a concentração da receita é medida. */
  async setAnchor(companyId: string, entityId: string | null, actor: Actor) {
    await updateDoc(doc(db, "companies", companyId), {
      analyticsAnchorEntityId: entityId ?? deleteField(),
    });
    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "update",
      entity: "company",
      entityId: companyId,
      details: { analyticsAnchorEntityId: entityId ?? "nenhuma" },
    });
  },
};
