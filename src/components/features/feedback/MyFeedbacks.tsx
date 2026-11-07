"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, MessageSquare, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/providers/AuthProvider";
import { connectionAwareError } from "@/lib/errors";
import {
  FEEDBACK_TEXT_MIN,
  FEEDBACK_TYPE_LABEL,
  isClosed,
} from "@/lib/feedback";
import { feedbackService } from "@/lib/services/feedbackService";
import { useFeedbackPanelStore } from "@/lib/store/useFeedbackPanelStore";
import { useGlobalStore } from "@/lib/store/useGlobalStore";
import type { Feedback } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FeedbackStatusBadge, FeedbackTimeline } from "./FeedbackTimeline";

const ticketName = (f: Feedback) => f.protocol ?? "Sem protocolo";

/** O que pede a pessoa vem primeiro; o resto, do mais recente ao mais antigo. */
const needsYou = (f: Feedback) =>
  f.status === "waiting_user" ||
  (f.status === "resolved" && f.solved == null && !!f.protocol);

function FeedbackDetail({
  feedback,
  onClose,
  onChanged,
}: {
  feedback: Feedback | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const setNovidadesOpen = useGlobalStore((s) => s.setNovidadesOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedbackId = feedback?.id;
  const unseen = !!feedback?.userUnread;

  useEffect(() => {
    if (feedbackId && unseen) {
      // Falhar aqui só mantém o aviso de novidade na lista.
      feedbackService.markSeen(feedbackId).then(onChanged, () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackId, unseen]);

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      onChanged();
    } catch (err) {
      setError(
        connectionAwareError(
          err,
          err instanceof Error ? err.message : "Não foi possível salvar.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const closed = feedback ? isClosed(feedback.status) : false;
  const tooShort = text.trim().length < FEEDBACK_TEXT_MIN;

  return (
    <Sheet open={!!feedback} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {feedback && (
          <>
            <SheetHeader className="border-b px-5 py-4 pr-12">
              <SheetTitle className="break-words text-lg tracking-tight">
                {feedback.title}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono tabular-nums">
                    {ticketName(feedback)}
                  </span>
                  <span>{FEEDBACK_TYPE_LABEL[feedback.type]}</span>
                  <FeedbackStatusBadge status={feedback.status} viewer="user" />
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-5 py-5">
              {feedback.dueAt &&
                !closed &&
                feedback.status !== "waiting_user" && (
                  <p className="text-sm">
                    Resposta prevista até{" "}
                    <strong className="font-medium">
                      {format(feedback.dueAt, "dd/MM/yyyy")}
                    </strong>
                  </p>
                )}

              {feedback.mergedInto && (
                <p className="rounded-md bg-muted/50 p-3 text-sm">
                  Unido ao chamado {feedback.mergedIntoProtocol ?? "principal"},
                  que trata do mesmo assunto. Você recebe os avisos da situação
                  por aqui.
                </p>
              )}

              {feedback.fixedAt && (
                <p className="rounded-md bg-muted/50 p-3 text-sm">
                  Corrigido em {format(feedback.fixedAt, "dd/MM/yyyy")}.{" "}
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => {
                      onClose();
                      setNovidadesOpen(true);
                    }}
                  >
                    Ver em Novidades
                  </button>
                </p>
              )}

              <FeedbackTimeline feedback={feedback} viewer="user" />

              {feedback.screenshotUrl && (
                <a
                  href={feedback.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm underline underline-offset-4"
                >
                  Ver imagem anexada
                </a>
              )}

              {feedback.status === "resolved" && feedback.solved == null && (
                <div className="rounded-md border p-3">
                  <p className="mb-2 text-sm font-medium">Isso resolveu?</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(() => feedbackService.rate(feedback.id, true))
                      }
                    >
                      Sim
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(() => feedbackService.rate(feedback.id, false))
                      }
                    >
                      Não, reabrir
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="feedback-reply">
                  {closed ? "Ainda precisa de ajuda?" : "Responder"}
                </Label>
                <Textarea
                  id="feedback-reply"
                  rows={4}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                {closed && (
                  <p className="text-xs text-muted-foreground">
                    Responder reabre o chamado.
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button
                  disabled={busy || tooShort}
                  onClick={() =>
                    run(
                      () => feedbackService.reply(feedback.id, text),
                      () => setText(""),
                    )
                  }
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Enviar resposta
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function MyFeedbacks() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const openPanel = useFeedbackPanelStore((s) => s.openPanel);
  const queryKey = ["feedbacks", user?.uid];
  const {
    data: feedbacks,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => feedbackService.getByUser(user!.uid),
    enabled: !!user,
  });

  const openId = searchParams.get("chamado");
  const selected = feedbacks?.find((f) => f.id === openId) ?? null;
  const select = (id: string | null) =>
    router.replace(id ? `/feedback?chamado=${id}` : "/feedback", {
      scroll: false,
    });

  const rows = [...(feedbacks ?? [])].sort(
    (a, b) =>
      Number(needsYou(b)) - Number(needsYou(a)) ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Meus chamados
          </h1>
          <p className="text-muted-foreground">
            O que você abriu com a equipe e em que pé está.
          </p>
        </div>
        <Button onClick={() => openPanel()}>
          <Plus className="size-4" />
          Novo chamado
        </Button>
      </div>

      {isLoading ? (
        <div
          className="space-y-2"
          role="status"
          aria-label="Carregando chamados"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-md border p-6 text-center" role="alert">
          <p className="font-medium">
            Não foi possível carregar seus chamados.
          </p>
          <p className="mb-3 text-sm text-muted-foreground">
            Eles continuam guardados. Verifique a conexão e tente de novo.
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Nenhum chamado por enquanto"
          description="Se algo travar ou surgir uma dúvida, abra um chamado: a equipe recebe a tela em que você está."
          action={{ label: "Novo chamado", onClick: () => openPanel() }}
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => select(f.id)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[9rem_1fr_auto_7rem]"
              >
                <span className="hidden font-mono text-sm tabular-nums text-muted-foreground md:block">
                  {ticketName(f)}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      f.userUnread && "font-semibold",
                    )}
                  >
                    {f.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {FEEDBACK_TYPE_LABEL[f.type]}
                    {f.userUnread && " · Nova atualização"}
                  </span>
                </span>
                <FeedbackStatusBadge status={f.status} viewer="user" />
                <span className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">
                  {format(f.updatedAt, "dd/MM/yyyy")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <FeedbackDetail
        feedback={selected}
        onClose={() => select(null)}
        onChanged={() => queryClient.invalidateQueries({ queryKey })}
      />
    </div>
  );
}
