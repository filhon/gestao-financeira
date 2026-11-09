"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import currency from "currency.js";
import { Button } from "@/components/ui/button";
import {
  analysisBrief,
  ruleSummary,
  type AnalyticsReport,
} from "@/lib/analytics";
import {
  analyticsService,
  type AnalyticsParams,
} from "@/lib/services/analyticsService";
import type { BudgetProgressData } from "@/lib/services/dashboardService";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAccountPositions } from "@/hooks/useAnalytics";
import { useBankBalance, useCashReserve } from "@/hooks/useDashboardData";
import { attentionAiQuery } from "./AttentionSection";

type Stage = "idle" | "writing" | "building";
const STAGE_TEXT: Record<Stage, string> = {
  idle: "Baixar PDF",
  writing: "Redigindo o resumo…",
  building: "Montando o PDF…",
};

let fontsReady = false;

/**
 * Relatório de conselho em PDF, montado no navegador com os mesmos dados da
 * tela. Dois estágios reais: a IA redige resumo e destaques (com a
 * conferência no servidor; se falhar, entra o texto por regra) e o
 * @react-pdf monta o arquivo, carregado só no clique.
 */
export function PdfExportButton({
  report,
  meta,
  params,
  cash,
  budget,
}: {
  report: AnalyticsReport;
  meta: { transactionCount: number };
  params: AnalyticsParams;
  cash: number | null;
  /** Envelopes do exercício; null enquanto não lidos ou se falharam. */
  budget: BudgetProgressData[] | null;
}) {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const accounts = useAccountPositions();
  const reserve = useCashReserve();
  const bank = useBankBalance();
  const [stage, setStage] = useState<Stage>("idle");

  async function run() {
    if (!selectedCompany) return;
    const companyId = selectedCompany.id;
    const brief = analysisBrief(report, { cash, envelopes: budget });
    try {
      setStage("writing");
      const [summary, attention] = await Promise.all([
        analyticsService
          .ai<{
            sentences: string[];
            source: "ai" | "rules";
          }>(companyId, params, { kind: "summary", cash, envelopes: budget })
          .catch(() => ({
            sentences: ruleSummary(brief),
            source: "rules" as const,
          })),
        brief.attention.length
          ? queryClient
              .fetchQuery(
                attentionAiQuery({
                  companyId,
                  params,
                  items: brief.attention,
                  cash,
                  envelopes: budget,
                }),
              )
              .then((r) =>
                brief.attention.map((item) => {
                  const ai = r.items.find((w) => w.id === item.id && w.ai);
                  return ai ? { ...item, text: ai.text, ai: true } : item;
                }),
              )
              .catch(() => brief.attention)
          : Promise.resolve(brief.attention),
      ]);

      setStage("building");
      const [{ pdf }, { registerPdfFonts, renderAnalyticsPdf }] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("./AnalyticsPdf"),
        ]);
      if (!fontsReady) {
        registerPdfFonts("/fonts/pdf");
        fontsReady = true;
      }
      const blob = await renderAnalyticsPdf(
        {
          report,
          brief,
          companyName: selectedCompany.name,
          generatedAt: new Date(),
          transactionCount: meta.transactionCount,
          summary,
          attention,
          budget,
          accounts: accounts.data ?? null,
          liquidReserve: (reserve.data ?? []).reduce(
            (s, r) => s.add(r.position.net),
            currency(0),
          ).value,
          bankBalance: bank.data?.balance ?? null,
        },
        (doc) => pdf(doc).toBlob(),
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analise-${params.range.from}-a-${params.range.to}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (summary.source === "rules")
        toast.info(
          "PDF pronto. A IA não respondeu; o resumo saiu pelas regras da Análise.",
        );
    } catch (err) {
      console.error("PDF da Análise falhou", err);
      toast.error("Não foi possível montar o PDF. Tente de novo.");
    } finally {
      setStage("idle");
    }
  }

  const busy = stage !== "idle";
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      onClick={run}
      disabled={busy || accounts.isLoading}
      aria-live="polite"
    >
      {busy ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <FileDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      )}
      {STAGE_TEXT[stage]}
    </Button>
  );
}
