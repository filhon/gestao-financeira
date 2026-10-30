"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  AlertTriangle,
  Pencil,
  PauseCircle,
  PlayCircle,
  SkipForward,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  recurrenceService,
  upcomingDates,
} from "@/lib/services/recurrenceService";
import { RecurringTransactionTemplate, TransactionStatus } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const STATUS_LABEL: Record<TransactionStatus, string> = {
  draft: "Rascunho",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovada",
  pending_authorization: "Aguardando liberação",
  authorized: "Liberada",
  paid: "Paga",
  received: "Recebida",
  rejected: "Rejeitada",
};

const ADJUSTMENT_LABEL = { IPCA: "IPCA", IGPM: "IGP-M", FIXED: "% fixo" };

export function frequencyLabel(freq: string, interval: number) {
  const n = interval > 1 ? `A cada ${interval} ` : "";
  const names: Record<string, [string, string]> = {
    daily: ["Diário", "dias"],
    weekly: ["Semanal", "semanas"],
    monthly: ["Mensal", "meses"],
    yearly: ["Anual", "anos"],
  };
  const [one, many] = names[freq] ?? [freq, freq];
  return interval > 1 ? `${n}${many}` : one;
}

interface Props {
  template: RecurringTransactionTemplate | null;
  onClose: () => void;
  canManage: boolean;
  costCenterName?: string;
  accountLabel?: string;
  onEdit: () => void;
  onToggleActive: () => void;
  onChanged: () => void;
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export function RecurrenceDetailSheet({
  template: t,
  onClose,
  canManage,
  costCenterName,
  accountLabel,
  onEdit,
  onToggleActive,
  onChanged,
}: Props) {
  const [confirm, setConfirm] = useState<"skip" | "end" | null>(null);

  const generated = useQuery({
    queryKey: ["recurrence-generated", t?.companyId, t?.id],
    queryFn: () => recurrenceService.getGenerated(t!.companyId, t!.id),
    enabled: !!t,
  });

  const rule = t?.adjustmentRule;
  const dates = t ? upcomingDates(t, 6) : [];
  const adjustsOn = (d: Date) =>
    !!rule &&
    rule.monthToApply === d.getMonth() + 1 &&
    t?.lastAdjustment?.year !== d.getFullYear();

  return (
    <>
      <Sheet open={!!t} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {t && (
            <>
              <SheetHeader>
                <SheetTitle>{t.description}</SheetTitle>
                <SheetDescription>
                  {t.type === "payable" ? "Despesa" : "Receita"} ·{" "}
                  {frequencyLabel(t.frequency, t.interval)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 px-4 pb-6">
                {t.lastError && (
                  <div
                    role="alert"
                    className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">A última geração falhou</p>
                      <p className="text-xs">{t.lastError.message}</p>
                    </div>
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Fact label="Valor">
                    <span className="font-financial font-medium">
                      {formatCurrency(t.amount)}
                    </span>
                    {t.amountIsEstimate && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (estimado)
                      </span>
                    )}
                  </Fact>
                  <Fact label="Próximo vencimento">
                    <span className="tabular-nums">
                      {format(t.nextDueDate, "dd/MM/yyyy")}
                    </span>
                  </Fact>
                  <Fact label="Fornecedor / cliente">
                    {t.baseTransactionData?.supplierOrClient || "Não informado"}
                  </Fact>
                  <Fact label="Centro de custo">
                    {costCenterName || "Não informado"}
                  </Fact>
                  <Fact label="Conta do plano">
                    {accountLabel || "Não informado"}
                  </Fact>
                  <Fact label="Criado com antecedência">
                    {t.advanceDays ?? (t.type === "payable" ? 7 : 0)} dias
                  </Fact>
                  <Fact label="Reajuste">
                    {rule
                      ? `${ADJUSTMENT_LABEL[rule.type]}${
                          rule.percentage ? ` ${rule.percentage}%` : ""
                        } em ${format(new Date(2000, rule.monthToApply - 1, 1), "MMMM", { locale: ptBR })}`
                      : "Sem reajuste"}
                  </Fact>
                  <Fact label="Data final">
                    {t.endDate ? (
                      <span className="tabular-nums">
                        {format(t.endDate, "dd/MM/yyyy")}
                      </span>
                    ) : (
                      "Sem data final"
                    )}
                  </Fact>
                </dl>

                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    Próximas ocorrências
                  </h3>
                  <ul className="divide-y rounded-md border text-sm">
                    {dates.map((d, i) => (
                      <li
                        key={d.toISOString()}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <span className="tabular-nums">
                          {format(d, "dd/MM/yyyy")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {adjustsOn(d) && "com reajuste · "}
                          {i === 0 && !t.active ? "pausada" : ""}
                        </span>
                        <span className="font-financial">
                          {formatCurrency(t.amount)}
                        </span>
                      </li>
                    ))}
                    {dates.length === 0 && (
                      <li className="px-3 py-2 text-muted-foreground">
                        Nenhuma ocorrência restante.
                      </li>
                    )}
                  </ul>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    Lançamentos gerados
                  </h3>
                  {generated.isLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : generated.data && generated.data.length > 0 ? (
                    <ul className="divide-y rounded-md border text-sm">
                      {generated.data.slice(0, 12).map((g) => (
                        <li
                          key={g.id}
                          className="flex items-center justify-between gap-2 px-3 py-2"
                        >
                          <span className="tabular-nums">
                            {format(g.dueDate, "dd/MM/yyyy")}
                          </span>
                          <span className="flex-1 truncate text-xs text-muted-foreground">
                            {STATUS_LABEL[g.status]}
                          </span>
                          <span className="font-financial">
                            {formatCurrency(g.finalAmount ?? g.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nada gerado ainda. Os lançamentos criados daqui para
                      frente ficam ligados a esta recorrência.
                    </p>
                  )}
                </section>

                {canManage && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={onEdit}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </Button>
                    {!t.endedAt && (
                      <Button variant="outline" onClick={onToggleActive}>
                        {t.active ? (
                          <PauseCircle className="mr-2 h-4 w-4" />
                        ) : (
                          <PlayCircle className="mr-2 h-4 w-4" />
                        )}
                        {t.active ? "Pausar" : "Retomar"}
                      </Button>
                    )}
                    {t.active && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => setConfirm("skip")}
                        >
                          <SkipForward className="mr-2 h-4 w-4" /> Pular próxima
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setConfirm("end")}
                        >
                          <Square className="mr-2 h-4 w-4" /> Encerrar
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm === "skip"
            ? "Pular a próxima ocorrência?"
            : "Encerrar recorrência?"
        }
        description={
          confirm === "skip"
            ? `A ocorrência de ${t ? format(t.nextDueDate, "dd/MM/yyyy") : ""} não será gerada. A seguinte continua normal.`
            : "Ela para de gerar lançamentos e sai do compromisso mensal. O histórico continua aqui."
        }
        confirmText={confirm === "skip" ? "Pular" : "Encerrar"}
        variant={confirm === "end" ? "destructive" : "default"}
        onConfirm={async () => {
          if (!t) return;
          try {
            await (confirm === "skip"
              ? recurrenceService.skipNext(t)
              : recurrenceService.end(t));
            toast.success(
              confirm === "skip"
                ? "Ocorrência pulada."
                : "Recorrência encerrada.",
            );
            onChanged();
            if (confirm === "end") onClose();
          } catch (e) {
            console.error(e);
            toast.error("Não foi possível concluir. Tente novamente.");
            throw e;
          }
        }}
      />
    </>
  );
}
