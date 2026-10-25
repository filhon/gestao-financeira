import currency from "currency.js";
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { BatchActor, canActOnBatch } from "@/lib/services/paymentBatchService";
import { PaymentBatch } from "@/lib/types";
import { cn, plural } from "@/lib/utils";

// ── Próximo passo de cada lote ─────────────────────────────────────────────

export type ActionKind =
  | "send_approval"
  | "approve"
  | "send_authorization"
  | "authorize"
  | "confirm_payment";

export interface NextStep {
  /** Quem precisa agir agora. */
  who: string;
  /** O que precisa ser feito. */
  what: string;
  mine: boolean;
  since?: Date;
  expired?: boolean;
  action?: { kind: ActionKind; label: string };
}

export interface StepContext {
  actor: BatchActor | null;
  canManage: boolean;
  canApprove: boolean;
  canPay: boolean;
}

export function nextStep(b: PaymentBatch, ctx: StepContext): NextStep | null {
  const manager = "Gestor financeiro";
  const expired =
    !!b.approvalTokenExpiresAt && b.approvalTokenExpiresAt < new Date();
  const designated = !!ctx.actor && canActOnBatch(b, ctx.actor);

  switch (b.status) {
    case "open":
      return {
        who: manager,
        what: "Enviar para aprovação",
        mine: ctx.canManage,
        since: b.returnedAt ?? b.revertedAt ?? b.createdAt,
        action:
          ctx.canManage && b.transactionIds.length > 0
            ? { kind: "send_approval", label: "Enviar para aprovação" }
            : undefined,
      };
    case "pending_approval": {
      const mine = ctx.canApprove && designated;
      return {
        who: b.approverName || b.approverEmail || "Aprovador",
        what: "Aprovar",
        mine,
        since: b.sentForApprovalAt,
        expired,
        action: mine
          ? { kind: "approve", label: "Aprovar" }
          : expired && ctx.canManage
            ? { kind: "send_approval", label: "Reenviar link" }
            : undefined,
      };
    }
    case "approved":
      return {
        who: manager,
        what: "Enviar para autorização",
        mine: ctx.canManage,
        since: b.approvedAt,
        action: ctx.canManage
          ? { kind: "send_authorization", label: "Enviar para autorização" }
          : undefined,
      };
    case "pending_authorization": {
      const mine = ctx.canPay && designated;
      return {
        who: b.authorizerName || b.authorizerEmail || "Autorizador",
        what: "Autorizar no banco",
        mine,
        since: b.sentForAuthorizationAt,
        expired,
        action: mine
          ? { kind: "authorize", label: "Autorizar" }
          : expired && ctx.canManage
            ? { kind: "send_authorization", label: "Reenviar link" }
            : undefined,
      };
    }
    case "authorized":
      return {
        who: manager,
        what: "Confirmar pagamento",
        mine: ctx.canManage,
        since: b.authorizedAt,
        action: ctx.canManage
          ? { kind: "confirm_payment", label: "Confirmar pagamento" }
          : undefined,
      };
    default:
      return null;
  }
}

/** É a vez de quem está vendo: precisa agir ou tem uma ação disponível. */
export const isMyTurn = (step: NextStep | null) =>
  !!step && (step.mine || !!step.action);

// ── Vencimento ─────────────────────────────────────────────────────────────

export function periodLabel(b: PaymentBatch) {
  if (!b.startDate || !b.endDate) return null;
  const sameYear = b.startDate.getFullYear() === b.endDate.getFullYear();
  return `${format(b.startDate, sameYear ? "dd/MM" : "dd/MM/yyyy")} a ${format(b.endDate, "dd/MM/yyyy")}`;
}

type Tone = "late" | "soon" | "calm";

export const TONE: Record<Tone, string> = {
  late: "font-medium text-red-700 dark:text-red-400",
  soon: "text-amber-700 dark:text-amber-400",
  calm: "text-muted-foreground",
};

/**
 * Urgência pelo primeiro vencimento do lote: é o que gera multa e juros.
 * O texto carrega o sentido; a cor só reforça.
 */
export function dueUrgency(
  b: PaymentBatch,
): { label: string; tone: Tone } | null {
  if (!b.startDate || b.status === "paid" || b.status === "rejected")
    return null;
  const days = differenceInCalendarDays(b.startDate, new Date());
  if (days < 0)
    return { label: `Venceu há ${plural(-days, "dia", "dias")}`, tone: "late" };
  if (days === 0) return { label: "Vence hoje", tone: "soon" };
  return {
    label: `Vence em ${plural(days, "dia", "dias")}`,
    tone: days <= 3 ? "soon" : "calm",
  };
}

/** Mais urgente primeiro; lotes sem período no fim. */
export const byDue = (a: PaymentBatch, b: PaymentBatch) =>
  (a.startDate?.getTime() ?? Infinity) - (b.startDate?.getTime() ?? Infinity) ||
  (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);

export const sumOf = (list: PaymentBatch[]) => ({
  count: list.length,
  total: list.reduce((acc, b) => acc.add(b.totalAmount), currency(0)).value,
});

/** Erro do serviço já vem em português; o do Firestore, não. */
export function errorMessage(error: unknown, fallback: string) {
  if ((error as { code?: string })?.code === "permission-denied")
    return "Você não tem permissão para esta ação.";
  return error instanceof Error && error.message ? error.message : fallback;
}

// ── Células ────────────────────────────────────────────────────────────────

export function DueCell({ batch }: { batch: PaymentBatch }) {
  const period = periodLabel(batch);
  if (!period)
    return <span className="text-sm text-muted-foreground">Sem período</span>;
  const urgency = dueUrgency(batch);
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span className="text-sm tabular-nums">{period}</span>
      {urgency && (
        <span className={cn("text-xs tabular-nums", TONE[urgency.tone])}>
          {urgency.label}
        </span>
      )}
    </div>
  );
}

export function StepCell({
  step,
  batch,
}: {
  step: NextStep | null;
  batch: PaymentBatch;
}) {
  if (!step) {
    return (
      <span className="text-sm text-muted-foreground">
        {batch.status === "paid" && batch.paidAt
          ? `Pago em ${format(batch.paidAt, "dd/MM/yyyy")}`
          : "Sem pendência"}
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={cn("truncate text-sm", step.mine && "font-medium")}
        title={step.who}
      >
        {step.mine ? "Você" : step.who}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {step.what}
        {step.expired ? (
          <span className="text-red-700 dark:text-red-400">
            , link expirado
          </span>
        ) : (
          step.since && (
            <span
              className="tabular-nums"
              title={format(step.since, "dd/MM/yyyy HH:mm")}
            >
              {" · "}
              {formatDistanceToNowStrict(step.since, {
                locale: ptBR,
                addSuffix: true,
              })}
            </span>
          )
        )}
      </span>
    </div>
  );
}
