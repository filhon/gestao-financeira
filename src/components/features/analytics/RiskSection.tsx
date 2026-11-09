"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AnalyticsReport, Concentration } from "@/lib/analytics";
import { analyticsService } from "@/lib/services/analyticsService";
import { entityService } from "@/lib/services/entityService";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fullMoney,
  money,
  pct,
  RankedBars,
  rankShade,
  Section,
  ThinSplitBar,
  VIZ,
  type RankedItem,
} from "./primitives";

const NONE = "__none__";

function concentrationItems(c: Concentration, color: string): RankedItem[] {
  return [
    ...c.top.map((p, i) => ({
      key: p.key,
      label: p.name,
      value: p.value,
      swatch: i < 5 ? rankShade(color, i) : VIZ.context,
      aside: c.total ? pct(p.value / c.total) : "—",
    })),
    ...(c.rest > 0
      ? [
          {
            key: "rest",
            label: `Demais ${c.restCount}`,
            value: c.rest,
            muted: true,
            swatch: VIZ.context,
            aside: pct(c.rest / c.total),
          },
        ]
      : []),
  ];
}

const days = (v: number) => {
  const n = Math.round(Math.abs(v));
  return `${n} ${n === 1 ? "dia" : "dias"}`;
};

function timingText(avg: number | null, verb: string) {
  if (avg === null) return "Nenhuma baixa no período.";
  if (Math.abs(avg) < 0.5) return `Em média, ${verb} no vencimento.`;
  return avg > 0
    ? `Em média, ${verb} ${days(avg)} depois do vencimento.`
    : `Em média, ${verb} ${days(avg)} antes do vencimento.`;
}

export function RiskSection({
  report,
  onAnchorChange,
}: {
  report: AnalyticsReport;
  onAnchorChange: () => void;
}) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const companyId = selectedCompany?.id;

  // Mesma chave das listas de contas: costuma já estar em cache.
  const entities = useQuery({
    queryKey: ["entities-all", companyId],
    queryFn: () => entityService.getAll(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });
  const payers = (entities.data ?? [])
    .filter((e) => e.category !== "supplier")
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const income = report.concentration.receivable;
  const spend = report.concentration.payable;
  const anchor = income.anchor;
  const anchorName =
    anchor?.name ??
    entities.data?.find((e) => e.id === report.anchorEntityId)?.name;
  const aging = report.aging.receivable;
  const overdue = aging.filter((b) => b.key !== "due");
  const overdueTotal = overdue.reduce((s, b) => s + b.value, 0);
  const overdueCount = overdue.reduce((s, b) => s + b.count, 0);
  const payableOverdue = report.aging.payable
    .filter((b) => b.key !== "due")
    .reduce(
      (s, b) => ({ value: s.value + b.value, count: s.count + b.count }),
      { value: 0, count: 0 },
    );

  async function changeAnchor(value: string) {
    if (!companyId || !user) return;
    setSaving(true);
    try {
      await analyticsService.setAnchor(
        companyId,
        value === NONE ? null : value,
        { uid: user.uid, email: user.email },
      );
      onAnchorChange();
      toast.success(
        value === NONE
          ? "Referência removida."
          : "Referência salva para toda a empresa.",
      );
    } catch {
      toast.error("Não foi possível salvar a referência.");
    } finally {
      setSaving(false);
    }
  }

  const top = income.top[0];
  const title = anchor
    ? `${anchor.name} responde por ${pct(anchor.share)} da receita do período`
    : top && income.total
      ? `Maior fonte de receita: ${top.name}, com ${pct(top.value / income.total)}`
      : "Sem receita no período";

  return (
    <Section
      id="riscos"
      kicker="Riscos"
      title={title}
      description={
        overdueTotal > 0
          ? `${money(overdueTotal)} a receber estão vencidos (${overdueCount} ${overdueCount === 1 ? "lançamento" : "lançamentos"}).`
          : "Nenhuma conta a receber vencida."
      }
    >
      <div className="grid gap-x-10 gap-y-8 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">De onde vem a receita</p>
            <Select
              value={report.anchorEntityId ?? NONE}
              onValueChange={changeAnchor}
              disabled={saving || entities.isLoading}
            >
              <SelectTrigger
                className="h-8 w-60 text-xs"
                aria-label="Entidade de referência da receita"
              >
                <SelectValue placeholder="Referência…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sem referência</SelectItem>
                {payers.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {anchor && income.total > 0 && (
            <div className="mb-3">
              <ThinSplitBar
                label="Participação da referência na receita"
                parts={[
                  {
                    key: "anchor",
                    name: anchor.name,
                    value: anchor.value,
                    color: VIZ.in,
                  },
                  {
                    key: "others",
                    name: "Demais",
                    value: income.total - anchor.value,
                    color: VIZ.context,
                  },
                ]}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {anchor.name}: {fullMoney(anchor.value)} de{" "}
                {fullMoney(income.total)}.
              </p>
            </div>
          )}
          {!anchor && report.anchorEntityId && (
            <p className="mb-3 text-xs text-muted-foreground">
              {anchorName ?? "A referência"} não teve receita no período.
            </p>
          )}
          {income.total ? (
            <RankedBars
              items={concentrationItems(income, VIZ.in)}
              color={VIZ.in}
            />
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Sem receita no período.
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-3 text-sm font-medium">Para onde vai a despesa</p>
          {spend.total ? (
            <RankedBars
              items={concentrationItems(spend, VIZ.out)}
              color={VIZ.out}
            />
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Sem despesa no período.
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium">
            Contas a receber em aberto, por atraso
          </p>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
            Situação de hoje, independente do período escolhido.
          </p>
          <ThinSplitBar
            label="Contas a receber em aberto por atraso"
            parts={aging.map((b, i) => ({
              key: b.key,
              name: b.label,
              value: b.value,
              color: b.key === "due" ? VIZ.context : rankShade(VIZ.in, 4 - i),
            }))}
          />
          <RankedBars
            color={VIZ.in}
            items={aging.map((b, i) => ({
              key: b.key,
              label: b.label,
              value: b.value,
              muted: b.key === "due",
              swatch: b.key === "due" ? VIZ.context : rankShade(VIZ.in, 4 - i),
              aside: `${b.count} ${b.count === 1 ? "lançamento" : "lançamentos"}`,
            }))}
          />
          {payableOverdue.value > 0 && (
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              Do outro lado, {money(payableOverdue.value)} em contas a pagar
              vencidas ({payableOverdue.count}).
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-3 text-sm font-medium">Pontualidade no período</p>
          <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            {(
              [
                ["Recebimentos", report.timing.receivable, "recebemos"],
                ["Pagamentos", report.timing.payable, "pagamos"],
              ] as const
            ).map(([label, t, verb]) => (
              <div key={label} className="bg-card px-4 py-3.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-pretty">
                  {timingText(t.avgDays, verb)}
                </dd>
                {t.lateShare !== null && (
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {pct(t.lateShare)} de {t.count} baixas depois do vencimento.
                  </dd>
                )}
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Média de dias entre vencimento e baixa, ponderada pelo valor.
          </p>
        </div>
      </div>
    </Section>
  );
}
