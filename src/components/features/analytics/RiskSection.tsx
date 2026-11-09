"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  riskTitle,
  type AnalyticsReport,
  type Concentration,
} from "@/lib/analytics";
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

/** Atraso em rampa de alerta: em dia neutro, depois âmbar até vermelho. */
const AMBER = "oklch(0.8 0.17 80)";
const AGING_COLOR = [
  VIZ.context,
  `color-mix(in oklch, ${AMBER} 55%, var(--card))`,
  AMBER,
  `color-mix(in oklch, ${AMBER} 45%, var(--destructive))`,
  "var(--destructive)",
];

/** A parte atrasada vem primeiro: a média ponderada a esconde. */
function timingText(
  t: { avgDays: number | null; lateShare: number | null; count: number },
  noun: string,
) {
  if (t.avgDays === null)
    return { main: "Nenhuma baixa no período.", sub: null };
  const avg = t.avgDays;
  const sub =
    Math.abs(avg) < 0.5
      ? "Na média ponderada pelo valor, no vencimento."
      : `Na média ponderada pelo valor, ${days(avg)} ${avg > 0 ? "depois do" : "antes do"} vencimento.`;
  return {
    main:
      t.lateShare === null
        ? sub
        : `${pct(t.lateShare)} dos ${t.count.toLocaleString("pt-BR")} ${noun} depois do vencimento.`,
    sub: t.lateShare === null ? null : sub,
  };
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

  const title = riskTitle(income);

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
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <p className="text-sm font-medium">De onde vem a receita</p>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="analise-mantenedora"
                className="text-xs text-muted-foreground"
              >
                Mantenedora (vale para toda a empresa)
              </label>
              <Select
                value={report.anchorEntityId ?? NONE}
                onValueChange={changeAnchor}
                disabled={saving || entities.isLoading}
              >
                <SelectTrigger
                  id="analise-mantenedora"
                  className="h-8 w-72 text-xs"
                >
                  <SelectValue placeholder="Escolher…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhuma</SelectItem>
                  {payers.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.tradeName?.trim() || e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              color: AGING_COLOR[i] ?? VIZ.context,
            }))}
          />
          <RankedBars
            color={VIZ.context}
            items={aging.map((b, i) => ({
              key: b.key,
              label: b.label,
              value: b.value,
              swatch: AGING_COLOR[i] ?? VIZ.context,
              barColor: AGING_COLOR[i] ?? VIZ.context,
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
          <dl className="divide-y border-t">
            {(
              [
                ["Recebimentos", report.timing.receivable, "recebimentos"],
                ["Pagamentos", report.timing.payable, "pagamentos"],
              ] as const
            ).map(([label, t, noun]) => {
              const text = timingText(t, noun);
              return (
                <div
                  key={label}
                  className="grid gap-x-4 gap-y-0.5 px-2 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)]"
                >
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-sm text-pretty">
                    {text.main}
                    {text.sub && (
                      <span className="block text-xs text-muted-foreground">
                        {text.sub}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </Section>
  );
}
