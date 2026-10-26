"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import currency from "currency.js";
import { cn, formatCurrency, plural } from "@/lib/utils";
import {
  EnvelopeLine,
  type EnvelopeSnapshot,
} from "@/components/features/finance/EnvelopeLine";
import { format, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Paperclip,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type Alert =
  | "budget_exceeded"
  | "first_payment"
  | "above_history"
  | "entity_changed"
  | "bank_changed"
  | "no_payment_data";

interface BatchInfo {
  id: string;
  name: string;
  companyName: string | null;
  createdByName: string | null;
  sentAt: Date | null;
  expiresAt: Date | null;
  tooLarge: boolean;
  codeSentTo: string | null;
}

interface BatchAttachment {
  name: string;
  url: string;
  type: string | null;
}

interface BatchTransaction {
  id: string;
  description: string;
  details: string | null;
  documentNumber: string | null;
  amount: number;
  dueDate: Date | null;
  costCenterId: string | null;
  supplier: string | null;
  supplierDocument: string | null;
  payTo: string | null;
  attachments: BatchAttachment[];
  historyAverage: number | null;
  entityUpdatedAt: Date | null;
  alerts: Alert[];
}

interface BatchCostCenter {
  id: string;
  name: string;
  parentId?: string | null;
}

/** Decisões ficam em rascunho até aprovar: nada é gravado antes. */
type Decision =
  | { kind: "reject"; reason: string }
  | { kind: "reduce"; to: number; reason: string };

interface Draft {
  id: string;
  kind: Decision["kind"];
  value: string;
  reason: string;
  /** Erro mostrado junto do campo, não num toast longe dele. */
  error?: { field: "value" | "reason"; message: string };
}

/** Mesmas colunas no cabeçalho e nas linhas, a partir do md. */
const ROW_GRID =
  "md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,15rem)_9rem_10rem] md:items-start";

const isImage = (a: BatchAttachment) =>
  a.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.name);

interface CostCenterGroup {
  costCenterId: string;
  breadcrumb: string[];
  transactions: BatchTransaction[];
  totalAmount: number;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | {
      kind: "error";
      code: string;
      message: string;
      batchName?: string;
      at?: Date | null;
      by?: string | null;
    }
  | {
      kind: "approved";
      approvedCount: number;
      rejectedCount: number;
      totalAmount: number;
    }
  | { kind: "returned" };

type PostError = Error & { codeError?: boolean };

/**
 * Confirmação por código: quem abre um link encaminhado não recebe o e-mail
 * com o código, que vai sempre para o aprovador designado.
 */
function CodeStep({
  sentTo,
  maskedEmail,
  code,
  onCode,
  error,
  sending,
  cooldown,
  onSend,
}: {
  sentTo: string | null;
  maskedEmail: string | null;
  code: string;
  onCode: (code: string) => void;
  error: string | null;
  sending: boolean;
  cooldown: number;
  onSend: () => void;
}) {
  // O código sai sozinho ao abrir o diálogo; aqui só o andamento ou a falha
  if (!sentTo) {
    return (
      <div className="space-y-2 rounded-md border p-3" aria-live="polite">
        {error ? (
          <>
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSend}
              disabled={sending}
            >
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tentar de novo
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Enviando um código de 6 dígitos para{" "}
            {maskedEmail ?? "o e-mail do aprovador"}…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <Label htmlFor="approval-code">Código enviado para {sentTo}</Label>
      <Input
        id="approval-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-40 text-center font-mono text-lg tracking-[0.4em]"
        aria-invalid={!!error}
        aria-describedby="approval-code-msg"
        autoFocus
      />
      <p
        id="approval-code-msg"
        aria-live="polite"
        className={cn(
          "text-xs",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ?? "Vale por 10 minutos. Confira também o spam."}
      </p>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0"
        onClick={onSend}
        disabled={sending || cooldown > 0}
      >
        {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
      </Button>
    </div>
  );
}

const toDate = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const dateTime = (d: Date) => format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
const parseBRL = (v: string) =>
  currency(v, { decimal: ",", separator: "." }).value;

export default function BatchApprovalPage() {
  const params = useParams();
  const router = useRouter();
  const rawToken = params.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : (rawToken ?? "");

  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [transactions, setTransactions] = useState<BatchTransaction[]>([]);
  const [costCenters, setCostCenters] = useState<BatchCostCenter[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comment, setComment] = useState("");

  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [envelopes, setEnvelopes] = useState<
    Record<string, EnvelopeSnapshot[]>
  >({});
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [preview, setPreview] = useState<BatchAttachment | null>(null);

  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Decisões sobrevivem a um recarregamento até aprovar ou devolver
  const storageKey = `approve-batch:${token}`;
  const forgetDraft = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  };

  useEffect(() => {
    if (status.kind !== "ready") return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ decisions: [...decisions], comment }),
      );
    } catch {}
  }, [decisions, comment, status.kind, storageKey]);

  useEffect(() => {
    if (!token) return;

    const loadData = async () => {
      try {
        const res = await fetch(
          `/api/internal/batch-approval?token=${encodeURIComponent(token)}`,
        );
        const payload = await res.json();

        if (!res.ok) {
          setStatus({
            kind: "error",
            code: payload.code ?? "invalid",
            message: payload.error || "Erro ao carregar o lote.",
            batchName: payload.batchName,
            at: toDate(payload.at),
            by: payload.by,
          });
          return;
        }

        const b = payload.batch;
        setBatch({
          id: b.id,
          name: b.name,
          companyName: b.companyName,
          createdByName: b.createdByName,
          sentAt: toDate(b.sentAt),
          expiresAt: toDate(b.expiresAt),
          tooLarge: b.tooLarge,
          codeSentTo: b.codeSentTo,
        });
        setEnvelopes(payload.envelopes ?? {});
        const txs: BatchTransaction[] = payload.transactions.map(
          (
            t: Omit<BatchTransaction, "dueDate" | "entityUpdatedAt"> & {
              dueDate: string | null;
              entityUpdatedAt: string | null;
            },
          ) => ({
            ...t,
            dueDate: toDate(t.dueDate),
            entityUpdatedAt: toDate(t.entityUpdatedAt),
          }),
        );
        setTransactions(txs);
        setCostCenters(payload.costCenters);

        try {
          const saved = JSON.parse(
            sessionStorage.getItem(`approve-batch:${token}`) ?? "null",
          ) as { decisions: [string, Decision][]; comment: string } | null;
          if (saved) {
            const amounts = new Map(txs.map((t) => [t.id, t.amount]));
            // Só o que ainda vale: transação no lote e redução abaixo do valor
            setDecisions(
              new Map(
                saved.decisions.filter(
                  ([id, d]) =>
                    amounts.has(id) &&
                    (d.kind === "reject" || d.to < amounts.get(id)!),
                ),
              ),
            );
            setComment(saved.comment ?? "");
          }
        } catch {}

        setStatus({ kind: "ready" });
      } catch (error) {
        console.error("Error loading batch:", error);
        setStatus({
          kind: "error",
          code: "network",
          message:
            "Não foi possível carregar o lote. Verifique a conexão e recarregue a página.",
        });
      }
    };

    loadData();
  }, [token]);

  const costCenterMap = useMemo(
    () => new Map(costCenters.map((cc) => [cc.id, cc])),
    [costCenters],
  );

  const buildBreadcrumb = useCallback(
    (costCenterId: string): string[] => {
      const result: string[] = [];
      let currentId: string | undefined | null = costCenterId;

      while (currentId) {
        const cc = costCenterMap.get(currentId);
        if (cc) {
          result.unshift(cc.name);
          currentId = cc.parentId;
        } else {
          break;
        }
      }

      // A raiz é única e se repetiria em todo grupo
      return result.length > 1 ? result.slice(1) : result;
    },
    [costCenterMap],
  );

  const amountOf = useCallback(
    (t: BatchTransaction) => {
      const d = decisions.get(t.id);
      if (d?.kind === "reject") return 0;
      return d?.kind === "reduce" ? d.to : t.amount;
    },
    [decisions],
  );

  const groupedTransactions = useMemo((): CostCenterGroup[] => {
    const byCc = new Map<string, BatchTransaction[]>();
    transactions.forEach((t) => {
      const ccId = t.costCenterId || "uncategorized";
      byCc.set(ccId, [...(byCc.get(ccId) ?? []), t]);
    });

    return [...byCc]
      .map(([ccId, txs]) => ({
        costCenterId: ccId,
        breadcrumb:
          ccId === "uncategorized"
            ? ["Sem centro de custo"]
            : buildBreadcrumb(ccId),
        // Vencimento primeiro: é o que define a urgência
        transactions: [...txs].sort(
          (a, b) =>
            (a.dueDate?.getTime() ?? Infinity) -
              (b.dueDate?.getTime() ?? Infinity) || b.amount - a.amount,
        ),
        totalAmount: txs.reduce(
          (sum, t) => currency(sum).add(amountOf(t)).value,
          0,
        ),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [transactions, buildBreadcrumb, amountOf]);

  const today = useMemo(() => new Date(), []);
  const overdueDays = (t: BatchTransaction) =>
    t.dueDate ? differenceInCalendarDays(today, t.dueDate) : 0;

  const totalAmount = useMemo(
    () =>
      transactions.reduce((sum, t) => currency(sum).add(amountOf(t)).value, 0),
    [transactions, amountOf],
  );
  const rejectedCount = [...decisions.values()].filter(
    (d) => d.kind === "reject",
  ).length;
  const reducedCount = decisions.size - rejectedCount;
  const approvingCount = transactions.length - rejectedCount;
  const firstDue = transactions
    .map((t) => t.dueDate)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const active = transactions.filter(
    (t) => decisions.get(t.id)?.kind !== "reject",
  );
  // Atraso é do lote, não alerta de cada linha: conta à parte
  const overdue = active.filter((t) => overdueDays(t) > 0);
  const allOverdue = overdue.length > 0 && overdue.length === active.length;
  const oldestLate = Math.max(0, ...overdue.map(overdueDays));
  const alertCount = active.filter((t) => t.alerts.length > 0).length;
  const showOnlyAlerts = onlyAlerts && alertCount > 0;

  const startDraft = (t: BatchTransaction, kind: Decision["kind"]) =>
    setDraft({
      id: t.id,
      kind,
      value: t.amount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      reason: "",
    });

  const saveDraft = () => {
    if (!draft) return;
    const t = transactions.find((tx) => tx.id === draft.id);
    if (!t) return;
    const reason = draft.reason.trim();
    const to = parseBRL(draft.value);
    if (draft.kind === "reduce" && (isNaN(to) || to <= 0 || to >= t.amount)) {
      setDraft({
        ...draft,
        error: {
          field: "value",
          message: `Informe um valor menor que ${formatCurrency(t.amount)}.`,
        },
      });
      return;
    }
    if (!reason) {
      setDraft({
        ...draft,
        error: {
          field: "reason",
          message:
            draft.kind === "reject"
              ? "Informe o motivo da rejeição."
              : "Informe o motivo da redução.",
        },
      });
      return;
    }

    const next = new Map(decisions);
    next.set(
      t.id,
      draft.kind === "reject"
        ? { kind: "reject", reason }
        : { kind: "reduce", to, reason },
    );
    setDecisions(next);
    setDraft(null);
  };

  const undoDecision = (id: string) => {
    const next = new Map(decisions);
    next.delete(id);
    setDecisions(next);
  };

  const post = async (body: object) => {
    const res = await fetch("/api/internal/batch-approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    });
    const payload = await res.json();
    if (!res.ok) {
      const err: PostError = new Error(
        payload.error || "Erro ao processar o lote",
      );
      err.codeError = payload.codeError;
      throw err;
    }
    return payload;
  };

  const sendCode = async () => {
    setSendingCode(true);
    setCodeError(null);
    try {
      const payload = await post({ action: "send-code" });
      setCodeSentTo(payload.sentTo);
      setCode("");
      setCooldown(60);
    } catch (error) {
      setCodeError(
        error instanceof Error ? error.message : "Erro ao enviar o código",
      );
    } finally {
      setSendingCode(false);
    }
  };

  /** Abre o diálogo e já pede o código: o aprovador não precisa de um clique a mais. */
  const openDecision = (show: (open: boolean) => void) => {
    show(true);
    if (!codeSentTo && !sendingCode) sendCode();
  };

  /** Erro de código fica no diálogo, junto do campo; o resto vira toast. */
  const failDecision = (error: unknown, fallback: string) => {
    console.error(fallback, error);
    if ((error as PostError).codeError) {
      setCodeError((error as Error).message);
      setCode("");
    } else {
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  const handleReturnToManager = async () => {
    if (!returnReason.trim()) {
      toast.error("Informe o motivo da devolução");
      return;
    }

    setIsSubmitting(true);
    setCodeError(null);
    try {
      await post({ action: "return", reason: returnReason, code });
      forgetDraft();
      setStatus({ kind: "returned" });
    } catch (error) {
      failDecision(error, "Erro ao devolver lote");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    setCodeError(null);
    try {
      const entries = [...decisions];
      const payload = await post({
        action: "approve",
        code,
        comment: comment || undefined,
        adjustments: entries
          .filter(([, d]) => d.kind === "reduce")
          .map(([id, d]) => ({
            id,
            adjustedAmount: (d as Extract<Decision, { kind: "reduce" }>).to,
            reason: d.reason,
          })),
        rejections: entries
          .filter(([, d]) => d.kind === "reject")
          .map(([id, d]) => ({ id, reason: d.reason })),
      });
      forgetDraft();
      setStatus({
        kind: "approved",
        approvedCount: payload.approvedCount,
        rejectedCount: payload.rejectedCount,
        totalAmount: payload.totalAmount,
      });
    } catch (error) {
      failDecision(error, "Erro ao aprovar lote");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status.kind === "loading") {
    return (
      <div
        className="min-h-screen bg-muted/40"
        aria-busy="true"
        aria-label="Carregando lote"
      >
        <div className="border-b bg-background px-4 py-4 sm:px-6 lg:px-8 space-y-2">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-6 w-80 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (status.kind !== "ready") {
    const endView = () => {
      if (status.kind === "approved") {
        return {
          icon: (
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
          ),
          title: "Lote aprovado",
          body: `${plural(status.approvedCount, "transação aprovada", "transações aprovadas")}, total de ${formatCurrency(status.totalAmount)}.${
            status.rejectedCount
              ? ` ${plural(status.rejectedCount, "transação rejeitada voltou", "transações rejeitadas voltaram")} ao gestor financeiro com o seu motivo.`
              : ""
          } O próximo passo é o gestor enviar o lote para autorização de pagamento.`,
        };
      }
      if (status.kind === "returned") {
        return {
          icon: <Undo2 className="h-10 w-10 text-muted-foreground" />,
          title: "Lote devolvido ao gestor",
          body: "O gestor financeiro recebeu o seu motivo e vai ajustar o lote. Se ele reenviar, você recebe um novo e-mail com outro link.",
        };
      }
      const when = status.at ? dateTime(status.at) : null;
      const who = status.by ? ` por ${status.by}` : "";
      return status.code === "approved"
        ? {
            icon: <CheckCircle2 className="h-10 w-10 text-muted-foreground" />,
            title: "Este lote já foi aprovado",
            body: `${status.batchName ? `${status.batchName}: aprovado` : "Aprovado"}${who}${when ? ` em ${when}` : ""}. Não há mais nada a fazer por este link.`,
          }
        : status.code === "returned"
          ? {
              icon: <Undo2 className="h-10 w-10 text-muted-foreground" />,
              title: "Este lote foi devolvido",
              body: `${status.batchName ? `${status.batchName}: devolvido` : "Devolvido"} ao gestor financeiro${who}${when ? ` em ${when}` : ""}. Se ele reenviar, chega um novo link.`,
            }
          : status.code === "expired"
            ? {
                icon: <Clock className="h-10 w-10 text-muted-foreground" />,
                title: "Link expirado",
                body: `${when ? `Este link venceu em ${when}. ` : ""}Peça ao gestor financeiro para reenviar o lote.`,
              }
            : {
                icon: <XCircle className="h-10 w-10 text-destructive" />,
                title:
                  status.code === "network"
                    ? "Falha ao carregar"
                    : "Link inválido",
                body: status.message,
              };
    };
    const view = endView();

    return (
      <div className="flex items-center justify-center min-h-screen bg-muted/40 p-4">
        <div className="w-full max-w-md text-center space-y-3" role="status">
          <div className="flex justify-center">{view.icon}</div>
          <h1 className="text-lg font-semibold">{view.title}</h1>
          <p className="text-sm text-muted-foreground">{view.body}</p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => router.push("/login")}
          >
            Abrir o sistema
          </Button>
        </div>
      </div>
    );
  }

  const alertLabel = (t: BatchTransaction, a: Alert) =>
    ({
      budget_exceeded: "Criada sem saldo no centro de custo",
      first_payment: "Primeiro pagamento a este fornecedor",
      above_history: `Acima do histórico (média ${formatCurrency(t.historyAverage ?? 0)})`,
      entity_changed: `Cadastro do fornecedor alterado em ${t.entityUpdatedAt ? format(t.entityUpdatedAt, "dd/MM") : "data recente"}`,
      bank_changed: `Dados bancários trocados em ${t.entityUpdatedAt ? format(t.entityUpdatedAt, "dd/MM") : "data recente"}: confirme com o fornecedor por um contato já conhecido`,
      no_payment_data: "Sem dados de pagamento",
    })[a];

  const codeStep = (
    <CodeStep
      sentTo={codeSentTo}
      maskedEmail={batch?.codeSentTo ?? null}
      code={code}
      onCode={setCode}
      error={codeError}
      sending={sendingCode}
      cooldown={cooldown}
      onSend={sendCode}
    />
  );

  const approveDisabled =
    isSubmitting || approvingCount === 0 || !!batch?.tooLarge || !!draft;

  // O filtro só esconde linhas: totais e envelopes seguem o grupo inteiro
  const visibleGroups = groupedTransactions
    .map((g) => ({
      ...g,
      visible: showOnlyAlerts
        ? g.transactions.filter((t) => t.alerts.length > 0)
        : g.transactions,
    }))
    .filter((g) => g.visible.length > 0);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="bg-background border-b">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-xs text-muted-foreground">
            {batch?.companyName ?? "FinControl"} · Aprovação de lote de
            pagamentos
          </p>
          <h1 className="text-lg sm:text-xl font-semibold mt-0.5">
            {batch?.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {[
              batch?.createdByName && `Montado por ${batch.createdByName}`,
              batch?.sentAt && `enviado em ${dateTime(batch.sentAt)}`,
              batch?.expiresAt &&
                `link válido até ${dateTime(batch.expiresAt)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      {/* pb-36 sm:pb-24 libera o rodapé fixo */}
      <main className="px-4 py-5 sm:px-6 lg:px-8 space-y-6 pb-36 sm:pb-24">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 rounded-lg border bg-background px-4 py-3">
          <div>
            <dt className="text-xs text-muted-foreground">A aprovar</dt>
            <dd className="text-lg font-semibold font-financial tabular-nums">
              {formatCurrency(totalAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Transações</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {approvingCount}
              {rejectedCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  de {transactions.length}
                </span>
              )}
            </dd>
          </div>
          {overdue.length > 0 ? (
            <div>
              <dt className="text-xs text-muted-foreground">Vencidas</dt>
              <dd className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                {allOverdue ? "Todas" : `${overdue.length} de ${active.length}`}
                <span className="block text-xs font-normal text-muted-foreground">
                  a mais antiga há {plural(oldestLate, "dia", "dias")}
                </span>
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs text-muted-foreground">
                Primeiro vencimento
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {firstDue ? format(firstDue, "dd/MM/yyyy") : "—"}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">Com alerta</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {alertCount ? (
                <>
                  <span className="text-amber-700 dark:text-amber-400">
                    {plural(alertCount, "transação", "transações")}
                  </span>
                  <button
                    type="button"
                    aria-pressed={showOnlyAlerts}
                    onClick={() => setOnlyAlerts((v) => !v)}
                    className="block text-xs font-normal text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring rounded-sm"
                  >
                    {showOnlyAlerts ? "Mostrar todas" : "Mostrar só estas"}
                  </button>
                </>
              ) : (
                "Nenhuma"
              )}
            </dd>
          </div>
        </dl>

        {batch?.tooLarge && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Este lote tem mais transações do que o link de aprovação comporta.
            Aprove dentro do sistema ou peça ao gestor para dividi-lo.
          </p>
        )}

        <div
          aria-hidden
          className="hidden md:block sticky top-0 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 border-b bg-background"
        >
          <div
            className={cn(
              "grid gap-x-6 px-[17px] py-2 text-xs text-muted-foreground",
              ROW_GRID,
            )}
          >
            <span>Fornecedor e documento</span>
            <span>Vencimento</span>
            <span>Pagamento</span>
            <span className="text-right">Valor</span>
            <span />
          </div>
        </div>

        {visibleGroups.map((ccGroup) => (
          <section
            key={ccGroup.costCenterId}
            aria-labelledby={`cc-${ccGroup.costCenterId}`}
          >
            <div className="flex items-baseline justify-between gap-3 pb-2">
              <h2
                id={`cc-${ccGroup.costCenterId}`}
                className="flex flex-wrap items-center gap-x-1 text-sm min-w-0"
              >
                {ccGroup.breadcrumb.map((name, idx) => {
                  const last = idx === ccGroup.breadcrumb.length - 1;
                  return (
                    <span key={idx} className="flex items-center gap-1">
                      {idx > 0 && (
                        <ChevronRight
                          className="h-3 w-3 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      <span
                        className={
                          last ? "font-semibold" : "text-muted-foreground"
                        }
                      >
                        {name}
                      </span>
                    </span>
                  );
                })}
              </h2>
              <span className="text-sm font-financial tabular-nums text-muted-foreground shrink-0">
                {formatCurrency(ccGroup.totalAmount)}
              </span>
            </div>
            {envelopes[ccGroup.costCenterId]?.map((s) => {
              // O envelope já desconta o lote inteiro; reduções e rejeições devolvem
              const ofYear = ccGroup.transactions.filter(
                (t) => t.dueDate?.getFullYear() === s.year,
              );
              const original = ofYear.reduce(
                (sum, t) => sum.add(t.amount),
                currency(0),
              );
              const current = ofYear.reduce(
                (sum, t) => sum.add(amountOf(t)),
                currency(0),
              );
              return (
                <p key={s.year} className="-mt-1 pb-2 text-xs">
                  <EnvelopeLine
                    snapshot={{
                      ...s,
                      available: currency(s.available)
                        .add(original)
                        .subtract(current).value,
                    }}
                    batchAmount={current.value}
                  />
                </p>
              );
            })}

            <ul className="divide-y rounded-lg border bg-background">
              {ccGroup.visible.map((t) => {
                const decision = decisions.get(t.id);
                const rejected = decision?.kind === "reject";
                const editing = draft?.id === t.id ? draft : null;
                const late = rejected ? 0 : overdueDays(t);
                // Com tudo vencido o resumo já avisa; a linha só diz quanto
                const lateLabel =
                  late > 0 &&
                  (allOverdue
                    ? `há ${plural(late, "dia", "dias")}`
                    : `vencida há ${plural(late, "dia", "dias")}`);
                const lateClass = allOverdue
                  ? "text-muted-foreground"
                  : "text-amber-700 dark:text-amber-400";
                const amountBlock = (
                  <>
                    {decision?.kind === "reduce" && (
                      <p className="text-xs text-muted-foreground line-through">
                        {formatCurrency(t.amount)}
                      </p>
                    )}
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        rejected && "line-through text-muted-foreground",
                      )}
                    >
                      {formatCurrency(
                        decision?.kind === "reduce" ? decision.to : t.amount,
                      )}
                    </p>
                  </>
                );

                return (
                  <li key={t.id} className="px-4 py-3">
                    <div className={cn("grid gap-x-6 gap-y-2", ROW_GRID)}>
                      {/* Fornecedor, descrição, alertas, anexos */}
                      <div
                        className={cn(
                          "min-w-0 space-y-1",
                          rejected && "opacity-60",
                        )}
                      >
                        {/* No celular o valor sobe para a linha do fornecedor */}
                        <div className="flex items-start justify-between gap-3">
                          <p
                            className={cn(
                              "font-medium text-sm min-w-0",
                              rejected && "line-through",
                            )}
                          >
                            {t.supplier ?? "Sem fornecedor"}
                            {t.supplierDocument && (
                              <span className="ml-2 font-normal text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                {t.supplierDocument}
                              </span>
                            )}
                          </p>
                          <div className="md:hidden shrink-0 text-right font-financial tabular-nums">
                            {amountBlock}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t.description}
                          {t.documentNumber && ` · Doc. ${t.documentNumber}`}
                        </p>
                        {t.details && (
                          <p className="text-xs text-muted-foreground">
                            {t.details}
                          </p>
                        )}
                        {t.alerts.length > 0 && !rejected && (
                          <ul className="flex flex-wrap gap-1.5 pt-0.5">
                            {t.alerts.map((a) => (
                              <li
                                key={a}
                                className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                              >
                                <AlertTriangle
                                  className="h-3 w-3 shrink-0"
                                  aria-hidden
                                />
                                {alertLabel(t, a)}
                              </li>
                            ))}
                          </ul>
                        )}
                        {t.attachments.length > 0 && (
                          <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                            {t.attachments.map((a, i) => (
                              <li key={i}>
                                <a
                                  href={a.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => {
                                    // Desktop: painel ao lado da lista; celular: aba nova
                                    if (
                                      window.matchMedia("(min-width: 768px)")
                                        .matches
                                    ) {
                                      e.preventDefault();
                                      setPreview(a);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-sm text-xs text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring"
                                >
                                  <Paperclip
                                    className="h-3 w-3 shrink-0"
                                    aria-hidden
                                  />
                                  <span className="truncate max-w-[16rem]">
                                    {a.name}
                                  </span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {decision && (
                          <p className="text-xs text-foreground">
                            <span className="font-medium">
                              {rejected ? "Rejeitada" : "Reduzida"}:
                            </span>{" "}
                            {decision.reason}
                          </p>
                        )}
                        {/* Celular: vencimento e pagamento numa linha só */}
                        <p className="md:hidden text-xs text-muted-foreground tabular-nums wrap-break-word">
                          {t.dueDate
                            ? `Venc. ${format(t.dueDate, "dd/MM")}`
                            : "Sem vencimento"}
                          {lateLabel && (
                            <span className={lateClass}> · {lateLabel}</span>
                          )}
                          {t.payTo && ` · ${t.payTo}`}
                        </p>
                      </div>

                      {/* Vencimento */}
                      <div className="hidden md:block text-sm tabular-nums">
                        {t.dueDate ? format(t.dueDate, "dd/MM/yyyy") : "—"}
                        {lateLabel && (
                          <p className={cn("text-xs", lateClass)}>
                            {lateLabel}
                          </p>
                        )}
                      </div>

                      {/* Para onde vai o dinheiro */}
                      <div className="hidden md:block text-sm min-w-0 wrap-break-word">
                        {t.payTo ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>

                      {/* Valor */}
                      <div className="hidden md:block text-right font-financial tabular-nums">
                        {amountBlock}
                      </div>

                      {/* Ações */}
                      <div className="flex gap-1 justify-end">
                        {decision ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 md:h-8"
                            onClick={() => undoDecision(t.id)}
                          >
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                            Desfazer
                          </Button>
                        ) : (
                          !editing && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-9 md:h-8"
                                onClick={() => startDraft(t, "reduce")}
                              >
                                Reduzir
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-9 md:h-8 hover:text-destructive hover:bg-destructive/10"
                                onClick={() => startDraft(t, "reject")}
                              >
                                Rejeitar
                              </Button>
                            </>
                          )
                        )}
                      </div>
                    </div>

                    {editing && (
                      <form
                        className="mt-3 space-y-1.5 rounded-md bg-muted/60 p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveDraft();
                        }}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                          {editing.kind === "reduce" && (
                            <div className="space-y-1 sm:w-40">
                              <Label htmlFor={`value-${t.id}`}>
                                Novo valor
                              </Label>
                              <Input
                                id={`value-${t.id}`}
                                inputMode="decimal"
                                value={editing.value}
                                onChange={(e) =>
                                  setDraft({
                                    ...editing,
                                    value: e.target.value,
                                    error: undefined,
                                  })
                                }
                                className="bg-background tabular-nums"
                                aria-invalid={editing.error?.field === "value"}
                                aria-describedby={`draft-error-${t.id}`}
                                autoFocus
                              />
                            </div>
                          )}
                          <div className="flex-1 space-y-1">
                            <Label htmlFor={`reason-${t.id}`}>
                              {editing.kind === "reject"
                                ? "Motivo da rejeição"
                                : "Motivo da redução"}
                            </Label>
                            <Input
                              id={`reason-${t.id}`}
                              value={editing.reason}
                              onChange={(e) =>
                                setDraft({
                                  ...editing,
                                  reason: e.target.value,
                                  error: undefined,
                                })
                              }
                              placeholder={
                                editing.kind === "reject"
                                  ? "Ex.: nota fiscal não confere"
                                  : "Ex.: pagar só a 1ª parcela"
                              }
                              className="bg-background"
                              aria-invalid={editing.error?.field === "reason"}
                              aria-describedby={`draft-error-${t.id}`}
                              autoFocus={editing.kind === "reject"}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setDraft(null)}
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="submit"
                              variant={
                                editing.kind === "reject"
                                  ? "destructive"
                                  : "default"
                              }
                            >
                              {editing.kind === "reject"
                                ? "Rejeitar"
                                : "Reduzir"}
                            </Button>
                          </div>
                        </div>
                        <p
                          id={`draft-error-${t.id}`}
                          role="alert"
                          className="text-xs text-destructive empty:hidden"
                        >
                          {editing.error?.message}
                        </p>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {showOnlyAlerts && (
          <p className="text-sm text-muted-foreground">
            Mostrando {alertCount} de {transactions.length}.{" "}
            <button
              type="button"
              onClick={() => setOnlyAlerts(false)}
              className="rounded-sm text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Mostrar todas
            </button>
          </p>
        )}

        <div className="space-y-1.5 max-w-3xl">
          <Label htmlFor="batch-comment">
            Comentário para o gestor (opcional)
          </Label>
          <Textarea
            id="batch-comment"
            placeholder="Fica registrado junto com a aprovação"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="bg-background"
          />
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-20 bg-background border-t">
        <div className="px-4 sm:px-6 lg:px-8 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => openDecision(setShowReturnDialog)}
            disabled={isSubmitting}
          >
            <Undo2 className="mr-2 h-4 w-4" />
            Devolver ao gestor
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
            {draft ? (
              <p className="text-xs text-foreground text-center sm:text-right">
                Conclua ou cancele a{" "}
                {draft.kind === "reject" ? "rejeição" : "redução"} aberta para
                aprovar.
              </p>
            ) : (
              (rejectedCount > 0 || reducedCount > 0) && (
                <p className="text-xs text-muted-foreground text-center sm:text-right">
                  {[
                    rejectedCount &&
                      plural(
                        rejectedCount,
                        "rejeitada volta",
                        "rejeitadas voltam",
                      ) + " ao gestor",
                    reducedCount &&
                      plural(reducedCount, "reduzida", "reduzidas"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )
            )}
            {/* emerald-700: com texto branco passa do AA (o 600 dava 3,8:1) */}
            <Button
              onClick={() => openDecision(setShowApproveDialog)}
              disabled={approveDisabled}
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {approvingCount === 0
                ? "Todas rejeitadas: devolva ao gestor"
                : `Aprovar ${plural(approvingCount, "transação", "transações")} · ${formatCurrency(totalAmount)}`}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar o lote?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Você aprova{" "}
                  <strong>
                    {plural(approvingCount, "transação", "transações")}
                  </strong>{" "}
                  no total de{" "}
                  <strong className="font-financial">
                    {formatCurrency(totalAmount)}
                  </strong>
                  .
                </p>
                {(rejectedCount > 0 || reducedCount > 0) && (
                  <p>
                    {[
                      rejectedCount &&
                        `${plural(rejectedCount, "rejeitada volta", "rejeitadas voltam")} ao gestor com o seu motivo`,
                      reducedCount &&
                        `${plural(reducedCount, "terá", "terão")} o valor reduzido`,
                    ]
                      .filter(Boolean)
                      .join("; ")}
                    .
                  </p>
                )}
                <p>
                  Depois de aprovado, o lote não pode ser alterado por este
                  link.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {codeStep}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              Voltar à revisão
            </AlertDialogCancel>
            {/* Button, não AlertDialogAction: o diálogo só fecha se der certo */}
            <Button
              onClick={handleApprove}
              disabled={isSubmitting || code.length !== 6}
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Aprovar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Devolver o lote ao gestor?</AlertDialogTitle>
            <AlertDialogDescription>
              Nada é aprovado. O gestor financeiro recebe o lote de volta com o
              seu motivo para ajustar e reenviar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-1.5">
            <Label htmlFor="return-reason">Motivo da devolução</Label>
            <Textarea
              id="return-reason"
              aria-describedby="return-reason-hint"
              placeholder="O que precisa ser ajustado?"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              rows={3}
            />
            {!returnReason.trim() && (
              <p
                id="return-reason-hint"
                className="text-xs text-muted-foreground"
              >
                Obrigatório para devolver.
              </p>
            )}
          </div>
          {codeStep}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              Voltar à revisão
            </AlertDialogCancel>
            <Button
              onClick={handleReturnToManager}
              disabled={
                isSubmitting || !returnReason.trim() || code.length !== 6
              }
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Devolver
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sem modal: a lista segue rolável ao lado; outro anexo troca o painel */}
      <Sheet
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        modal={false}
      >
        <SheetContent className="w-[min(52rem,55vw)] gap-0 sm:max-w-none">
          <SheetHeader className="border-b pr-12">
            <SheetTitle className="truncate text-base">
              {preview?.name}
            </SheetTitle>
            <SheetDescription asChild>
              <a
                href={preview?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs underline underline-offset-2"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Abrir em nova aba
              </a>
            </SheetDescription>
          </SheetHeader>
          {preview &&
            (isImage(preview) ? (
              <div className="flex-1 overflow-auto bg-muted/40 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.url}
                  alt={preview.name}
                  className="mx-auto max-w-full"
                />
              </div>
            ) : (
              <iframe
                key={preview.url}
                src={preview.url}
                title={preview.name}
                className="w-full flex-1 border-0 bg-muted/40"
              />
            ))}
        </SheetContent>
      </Sheet>
    </div>
  );
}
