"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, format } from "date-fns";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS } from "@/components/layout/Header";
import { connectionAwareError } from "@/lib/errors";
import {
  compareQueue,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_LABEL,
  feedbackStatusLabel,
  inQueueTab,
  isOverdue,
  LEGACY_FEATURE_LABEL,
  waitsForTeam,
  type QueueTab,
} from "@/lib/feedback";
import { feedbackService } from "@/lib/services/feedbackService";
import type { Feedback, FeedbackStatus, FeedbackType } from "@/lib/types";
import { cn, normalizeText } from "@/lib/utils";
import { FeedbackStatusBadge, FeedbackTimeline } from "./FeedbackTimeline";

const TABS: { value: QueueTab; label: string }[] = [
  { value: "open", label: "Com a equipe" },
  { value: "waiting", label: "Aguardando usuário" },
  { value: "closed", label: "Encerrados" },
  { value: "all", label: "Todos" },
];

function DueLabel({ feedback, now }: { feedback: Feedback; now: Date }) {
  if (!feedback.dueAt || !waitsForTeam(feedback.status)) {
    return <span className="text-muted-foreground">Sem prazo</span>;
  }
  const overdue = isOverdue(feedback, now);
  const days = differenceInCalendarDays(now, feedback.dueAt);
  return (
    <span className={cn(overdue && "font-medium text-destructive")}>
      {format(feedback.dueAt, "dd/MM/yyyy")}
      {overdue && (
        <span className="block text-xs">
          {days > 0
            ? `Atrasado ${days} ${days === 1 ? "dia" : "dias"}`
            : "Vence hoje"}
        </span>
      )}
    </span>
  );
}

function AdminFeedbackDetail({
  feedback,
  mergeTargets,
  onClose,
  onUpdate,
}: {
  feedback: Feedback | null;
  mergeTargets: Feedback[];
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<FeedbackStatus | "">("");
  const [inRelease, setInRelease] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = feedback?.id;
  const unread = feedback ? !feedback.read : false;
  useEffect(() => {
    setText("");
    setStatus("");
    setInRelease(false);
    setTargetId("");
    setError(null);
  }, [id]);
  useEffect(() => {
    // Falhar aqui só mantém o selo de não lido.
    if (id && unread) feedbackService.markSeen(id).then(onUpdate, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, unread]);

  const save = async () => {
    if (!feedback) return;
    setBusy(true);
    setError(null);
    try {
      await feedbackService.teamUpdate(feedback.id, {
        ...(text.trim() && { text: text.trim() }),
        ...(status && { status }),
        inRelease,
      });
      setText("");
      setStatus("");
      setInRelease(false);
      onUpdate();
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

  const merge = async () => {
    if (!feedback || !targetId) return;
    try {
      await feedbackService.merge(feedback.id, targetId);
      onUpdate();
      onClose();
    } catch (err) {
      setError(
        connectionAwareError(
          err,
          err instanceof Error ? err.message : "Não foi possível unir.",
        ),
      );
    }
  };

  const effectiveStatus = status || feedback?.status;
  const errors = feedback?.context?.errors ?? [];

  return (
    <Sheet open={!!feedback} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {feedback && (
          <>
            <SheetHeader className="border-b px-5 py-4 pr-12">
              <SheetTitle className="wrap-break-word text-lg tracking-tight">
                {feedback.title}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  {feedback.protocol && (
                    <span className="font-mono tabular-nums">
                      {feedback.protocol}
                    </span>
                  )}
                  <span>{FEEDBACK_TYPE_LABEL[feedback.type]}</span>
                  <FeedbackStatusBadge status={feedback.status} viewer="team" />
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-5 py-5">
              {feedback.blocksPayment && (
                <p className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm font-medium text-destructive">
                  <AlertTriangle className="size-4 shrink-0" />O usuário disse
                  que isso pode atrasar um pagamento hoje.
                </p>
              )}

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Quem</dt>
                <dd className="wrap-break-word">
                  {feedback.userName} ({feedback.userEmail})
                  {feedback.context?.role &&
                    `, ${ROLE_LABELS[feedback.context.role] ?? feedback.context.role}`}
                </dd>
                <dt className="text-muted-foreground">Empresa</dt>
                <dd>{feedback.companyName || "Não informada"}</dd>
                {feedback.context && (
                  <>
                    <dt className="text-muted-foreground">Tela</dt>
                    <dd className="break-all">
                      {feedback.context.url.startsWith("/") ? (
                        <Link
                          href={feedback.context.url}
                          className="underline underline-offset-4"
                        >
                          {feedback.context.screen}
                        </Link>
                      ) : (
                        feedback.context.screen
                      )}
                    </dd>
                    <dt className="text-muted-foreground">Navegador</dt>
                    <dd>
                      {feedback.context.browser}, janela{" "}
                      {feedback.context.viewport}
                    </dd>
                  </>
                )}
                {feedback.relatedFeatures?.length ? (
                  <>
                    <dt className="text-muted-foreground">Funções</dt>
                    <dd>
                      {feedback.relatedFeatures
                        .map((f) => LEGACY_FEATURE_LABEL[f])
                        .join(", ")}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Prazo</dt>
                <dd>
                  <DueLabel feedback={feedback} now={new Date()} />
                </dd>
                {feedback.solved != null && (
                  <>
                    <dt className="text-muted-foreground">Resolveu?</dt>
                    <dd>{feedback.solved ? "Sim" : "Não"}</dd>
                  </>
                )}
              </dl>

              {(errors.length > 0 || feedback.errorContext) && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="mb-1 text-sm font-medium">Erros na sessão</p>
                  <ul className="space-y-1 font-mono text-xs">
                    {errors.map((e) => (
                      <li
                        key={`${e.at}-${e.message}`}
                        className="wrap-break-word"
                      >
                        {e.message}
                      </li>
                    ))}
                    {feedback.errorContext && (
                      <li className="wrap-break-word">
                        {feedback.errorContext.message}
                      </li>
                    )}
                  </ul>
                </div>
              )}

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

              <FeedbackTimeline feedback={feedback} viewer="team" />

              {feedback.mergedInto ? (
                <p className="rounded-md bg-muted/50 p-3 text-sm">
                  Unido a {feedback.mergedIntoProtocol ?? "outro chamado"}.
                  Responda por lá.
                </p>
              ) : (
                <div className="space-y-3 border-t pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="feedback-team-reply">
                      Resposta ao usuário
                    </Label>
                    <Textarea
                      id="feedback-team-reply"
                      rows={4}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="feedback-team-status">Situação</Label>
                    <Select
                      value={effectiveStatus}
                      onValueChange={(v) => setStatus(v as FeedbackStatus)}
                    >
                      <SelectTrigger
                        id="feedback-team-status"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FEEDBACK_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {feedbackStatusLabel(s, "team")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {effectiveStatus === "resolved" && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="feedback-in-release"
                        checked={inRelease}
                        onCheckedChange={(v) => setInRelease(v === true)}
                      />
                      <Label
                        htmlFor="feedback-in-release"
                        className="font-normal"
                      >
                        A correção já está em Novidades
                      </Label>
                    </div>
                  )}
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <Button
                    disabled={
                      busy ||
                      (!text.trim() &&
                        (!status || status === feedback.status) &&
                        !inRelease)
                    }
                    onClick={save}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Salvar e avisar o usuário
                  </Button>

                  {mergeTargets.length > 0 && (
                    <div className="space-y-2 border-t pt-4">
                      <Label htmlFor="feedback-merge">
                        É repetido de outro chamado?
                      </Label>
                      <div className="flex gap-2">
                        <Select value={targetId} onValueChange={setTargetId}>
                          <SelectTrigger
                            id="feedback-merge"
                            className="min-w-0 flex-1"
                          >
                            <SelectValue placeholder="Escolha o chamado" />
                          </SelectTrigger>
                          <SelectContent>
                            {mergeTargets.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.protocol ?? "Sem protocolo"}: {t.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          disabled={!targetId}
                          onClick={() => setConfirmMerge(true)}
                        >
                          Unir
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
      <ConfirmDialog
        open={confirmMerge}
        onOpenChange={setConfirmMerge}
        title="Unir chamados?"
        description="Este chamado passa a seguir a situação do outro, e quem o abriu é avisado. O texto das respostas não é compartilhado entre os dois."
        confirmText="Unir"
        onConfirm={merge}
      />
    </Sheet>
  );
}

export function AdminFeedbackTable({
  feedbacks,
  onUpdate,
  selectedId,
  onSelect,
}: {
  feedbacks: Feedback[];
  onUpdate: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [tab, setTab] = useState<QueueTab>("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Fixo durante a tela aberta: o prazo não precisa de precisão de segundos.
  const [now] = useState(() => new Date());

  const companies = useMemo(
    () =>
      [
        ...new Set(feedbacks.map((f) => f.companyName).filter(Boolean)),
      ].sort() as string[],
    [feedbacks],
  );

  const needle = normalizeText(search.trim());
  const filtered = feedbacks.filter(
    (f) =>
      (typeFilter === "all" || f.type === typeFilter) &&
      (companyFilter === "all" || f.companyName === companyFilter) &&
      (!needle ||
        normalizeText(
          `${f.protocol ?? ""} ${f.title} ${f.description} ${f.userName} ${f.userEmail} ${f.companyName ?? ""}`,
        ).includes(needle)),
  );
  const count = (t: QueueTab) =>
    filtered.filter((f) => inQueueTab(f, t)).length;
  const rows = filtered.filter((f) => inQueueTab(f, tab)).sort(compareQueue);
  const overdue = filtered.filter(
    (f) => inQueueTab(f, "open") && isOverdue(f, now),
  ).length;

  const selected = feedbacks.find((f) => f.id === selectedId) ?? null;
  const mergeTargets = feedbacks.filter(
    (f) => f.id !== selectedId && !f.mergedInto && f.status !== "wont_fix",
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as QueueTab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label} ({count(t.value)})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {overdue > 0 && (
          <p className="text-sm font-medium text-destructive">
            {overdue}{" "}
            {overdue === 1 ? "chamado atrasado" : "chamados atrasados"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por protocolo, texto, pessoa ou empresa"
            aria-label="Buscar chamados"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="md:w-40" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {(Object.keys(FEEDBACK_TYPE_LABEL) as FeedbackType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {FEEDBACK_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="md:w-56" aria-label="Filtrar por empresa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as empresas</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Protocolo</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Quem</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <p className="text-sm font-medium">Nada aqui</p>
                  <p className="text-xs text-muted-foreground">
                    {feedbacks.length
                      ? "Troque a aba ou limpe os filtros."
                      : "Os chamados abertos pelos usuários aparecem nesta fila."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((f) => (
                <TableRow
                  key={f.id}
                  className="cursor-pointer"
                  onClick={() => onSelect(f.id)}
                >
                  <TableCell className="font-mono text-sm tabular-nums">
                    <button
                      type="button"
                      className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(f.id);
                      }}
                    >
                      {f.protocol ?? "Sem protocolo"}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <p className={cn("truncate", !f.read && "font-semibold")}>
                      {f.title}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      {FEEDBACK_TYPE_LABEL[f.type]}
                      {!f.read && <span>· Não lido</span>}
                      {f.mergedInto && <span>· Unido a outro</span>}
                      {f.blocksPayment && (
                        <span className="flex items-center gap-1 font-medium text-destructive">
                          <AlertTriangle className="size-3" />
                          Pagamento em risco
                        </span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>{f.companyName || "Não informada"}</TableCell>
                  <TableCell>
                    <p>{f.userName}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(f.createdAt, "dd/MM/yyyy HH:mm")}
                    </p>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <DueLabel feedback={f} now={now} />
                  </TableCell>
                  <TableCell>
                    <FeedbackStatusBadge status={f.status} viewer="team" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AdminFeedbackDetail
        feedback={selected}
        mergeTargets={mergeTargets}
        onClose={() => onSelect(null)}
        onUpdate={onUpdate}
      />
    </div>
  );
}
