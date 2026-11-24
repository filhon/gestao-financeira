"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import currency from "currency.js";
import { addDays, format } from "date-fns";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  Lock,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatCurrency } from "@/lib/utils";
import { periodName, proofNote, type ProofState } from "@/lib/cashSynthesis";
import {
  closingDiff,
  closingLines,
  closingSnapshot,
  hasChanges,
  LINK_DAYS,
  linkState,
  MAX_LINES,
  MAX_RECIPIENTS,
  MIN_REASON,
  parseEmails,
  type CashClosing,
  type ClosingChange,
  type ClosingDiff,
  type ClosingFile,
  type ClosingLink,
} from "@/lib/cashClosing";
import type { CashFlowReport } from "@/lib/reports";
import { cashClosingService } from "@/lib/services/cashClosingService";
import {
  buildCashFlowPackage,
  receiptUrl,
  synthesisOf,
  type CashFlowContext,
} from "@/lib/services/reportService";
import { TD, TH, tone } from "@/components/features/reports/ReportTables";

const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Não foi possível concluir. Tente de novo.";

const size = (bytes: number) =>
  bytes < 1e6
    ? `${Math.max(1, Math.round(bytes / 1e3))} KB`
    : `${(bytes / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "Outubro de 2026" no meio da frase. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Panel = "close" | "send" | "diff" | null;

/**
 * Situação do fechamento do mês em tela: o que foi congelado, o que mudou
 * depois e quem recebeu. Fechar, enviar e revogar são só de gestor e admin.
 */
export function ClosingPanel({
  report,
  context,
  canClose,
  bankProof,
}: {
  /** O mês inteiro, sem recorte, com o saldo inicial calculado. */
  report: CashFlowReport;
  context: Omit<CashFlowContext, "proof"> & { companyId: string };
  canClose: boolean;
  bankProof: (closing: number) => Promise<ProofState>;
}) {
  const { companyId, start, end } = context;
  const period = format(start, "yyyy-MM");
  const name = periodName(start, end);
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);

  const key = ["cash-closings", companyId, period];
  const closings = useQuery({
    queryKey: key,
    queryFn: () => cashClosingService.getByPeriod(companyId, period),
    staleTime: 60_000,
  });
  const active = closings.data?.find((c) => c.status === "active");

  const lines = useMemo(
    () =>
      closingLines(report, {
        entities: context.entities ?? [],
        hasReceipt: (t) => !!receiptUrl(t),
      }),
    [report, context.entities],
  );
  const diff = useMemo(
    () =>
      active
        ? closingDiff(active, {
            lines,
            opening: report.opening,
            closing: report.closing,
          })
        : null,
    [active, lines, report.opening, report.closing],
  );
  const changed = !!diff && hasChanges(diff);

  const download = async (file: ClosingFile) => {
    if (!active) return;
    try {
      window.location.assign(
        await cashClosingService.downloadUrl(companyId, active.id, file),
      );
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  if (closings.isLoading) return <Skeleton className="h-12 w-full" />;
  if (closings.error) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4" />
        Não foi possível ler o fechamento deste mês.
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => closings.refetch()}
        >
          Tentar de novo
        </Button>
      </div>
    );
  }
  if (!active && !canClose) return null;

  return (
    <section
      aria-label="Fechamento do mês"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 text-sm",
        changed &&
          "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
      )}
    >
      <div className="min-w-0 flex-1">
        {!active ? (
          <p>{name} ainda não foi fechado.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-2 font-medium">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {name} fechado com{" "}
              <span className="font-financial">
                {formatCurrency(active.closing)}
              </span>
            </p>
            <p
              className={cn(
                "text-xs",
                changed
                  ? "text-amber-900 dark:text-amber-200"
                  : "text-muted-foreground",
              )}
            >
              Versão {active.version}, em{" "}
              {format(active.closedAt, "dd/MM/yyyy 'às' HH:mm")}, por{" "}
              {active.closedBy.name}.{" "}
              {!diff
                ? null
                : !changed
                  ? "Nada mudou desde então."
                  : `${[
                      diff.changes.length > 0
                        ? `${plural(diff.changes.length, "lançamento mudou", "lançamentos mudaram")} depois${diff.financial > 0 ? ` (${diff.financial} em valor ou data)` : " (só no cadastro)"}`
                        : null,
                      diff.openingBefore !== diff.openingAfter
                        ? "o saldo inicial mudou"
                        : null,
                      diff.balance !== 0
                        ? `saldo final ${diff.balance > 0 ? "subiu" : "caiu"} ${formatCurrency(Math.abs(diff.balance))}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("; ")}.`}
            </p>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {changed && (
          <Button size="sm" variant="outline" onClick={() => setPanel("diff")}>
            Ver o que mudou
          </Button>
        )}
        {active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Download className="h-4 w-4" />
                Versão {active.version}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void download("package")}>
                Pacote completo ({size(active.files.package.size)})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void download("summary")}>
                Só a síntese em PDF ({size(active.files.summary.size)})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canClose && (!active || changed) && (
          <Button
            size="sm"
            variant={active ? "outline" : "default"}
            onClick={() => setPanel("close")}
          >
            {active ? `Fechar versão ${active.version + 1}` : "Fechar o mês"}
          </Button>
        )}
        {canClose && active && (
          <Button size="sm" onClick={() => setPanel("send")}>
            <Send className="h-4 w-4" />
            Enviar e acessos
          </Button>
        )}
      </div>

      <Sheet open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"
          // Fechar no meio perderia o que já foi baixado e enviado.
          onInteractOutside={(e) => panel === "close" && e.preventDefault()}
        >
          {panel === "close" && (
            <CloseForm
              report={report}
              context={context}
              lines={lines}
              name={name}
              period={period}
              next={(closings.data?.[0]?.version ?? 0) + 1}
              bankProof={bankProof}
              onDone={async () => {
                await queryClient.invalidateQueries({ queryKey: key });
                setPanel("send");
              }}
            />
          )}
          {panel === "send" && active && (
            <SendPanel
              closing={active}
              versions={closings.data ?? []}
              name={name}
              changed={changed}
              onCloseAgain={() => setPanel("close")}
            />
          )}
          {panel === "diff" && diff && active && (
            <DiffList diff={diff} closing={active} name={name} />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

// ─── Fechar ───────────────────────────────────────────────────────────────────

type Step =
  | { kind: "idle" }
  | { kind: "documents"; done: number; total: number }
  | { kind: "missing"; failed: string[] }
  | { kind: "upload"; percent: number }
  | { kind: "saving" }
  | { kind: "error"; message: string };

function CloseForm({
  report,
  context,
  lines,
  name,
  period,
  next,
  bankProof,
  onDone,
}: {
  report: CashFlowReport;
  context: Omit<CashFlowContext, "proof"> & { companyId: string };
  lines: ReturnType<typeof closingLines>;
  name: string;
  period: string;
  next: number;
  bankProof: (closing: number) => Promise<ProofState>;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  /** Pacote montado: a repetição depois de uma falha não baixa tudo de novo. */
  const built = useRef<Awaited<ReturnType<typeof buildCashFlowPackage>> | null>(
    null,
  );
  const uploadKey = useRef(crypto.randomUUID());
  const uploaded = useRef(false);

  const proof = useQuery({
    queryKey: ["closing-proof", context.companyId, period, report.closing],
    queryFn: () => bankProof(report.closing),
    staleTime: 0,
  });
  const full: CashFlowContext | null = proof.data
    ? { ...context, proof: proof.data }
    : null;
  const synthesis = useMemo(
    () => (full ? synthesisOf(report, full) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, proof.data],
  );

  const matches = proof.data?.status === "match";
  const reasonOk = matches || reason.trim().length >= MIN_REASON;
  const busy =
    step.kind === "documents" ||
    step.kind === "upload" ||
    step.kind === "saving";
  const tooBig = lines.length > MAX_LINES;

  const save = async () => {
    if (!full || !synthesis || !built.current) return;
    const { zip, pdf, failed } = built.current;
    try {
      setStep({ kind: "upload", percent: 0 });
      await cashClosingService.close(
        {
          companyId: context.companyId,
          period,
          snapshot: closingSnapshot(report, synthesis, lines, failed.length),
          reason: matches ? undefined : reason,
          files: { package: zip, summary: pdf },
          uploadKey: uploadKey.current,
          uploaded: uploaded.current,
        },
        {
          upload: (percent) => setStep({ kind: "upload", percent }),
          saving: () => {
            uploaded.current = true;
            setStep({ kind: "saving" });
          },
        },
      );
      toast.success(`${name} fechado na versão ${next}.`);
      await onDone();
    } catch (e) {
      console.error(e);
      // O que subiu pela metade não se troca: a nova tentativa usa outra pasta.
      if (!uploaded.current) uploadKey.current = crypto.randomUUID();
      setStep({ kind: "error", message: messageOf(e) });
    }
  };

  const run = async () => {
    if (!full) return;
    try {
      if (!built.current) {
        setStep({ kind: "documents", done: 0, total: 0 });
        const result = await buildCashFlowPackage(report, full, (done, total) =>
          setStep({ kind: "documents", done, total }),
        );
        built.current = result;
        if (result.failed.length > 0) {
          setStep({ kind: "missing", failed: result.failed });
          return;
        }
      }
      await save();
    } catch (e) {
      console.error(e);
      setStep({ kind: "error", message: messageOf(e) });
    }
  };

  return (
    <>
      <div className="border-b px-5 py-4">
        <SheetTitle className="text-base">
          Fechar {lower(name)}, versão {next}
        </SheetTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Guarda a síntese, a planilha, as notas e os comprovantes como estão
          agora. O sistema continua editável; o que mudar depois aparece aqui.
        </p>
      </div>
      <div className="space-y-5 px-5 py-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {[
            ["Saldo inicial", report.opening],
            ["Entradas", report.inflow],
            ["Saídas", report.outflow],
            ["Saldo final", report.closing],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd
                className={cn(
                  "font-financial font-semibold",
                  tone(value as number),
                )}
              >
                {formatCurrency(value as number)}
              </dd>
            </div>
          ))}
        </dl>

        <section className="space-y-1.5">
          <h3 className="font-semibold">Conferência com o banco</h3>
          {proof.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : matches ? (
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              Confere ao centavo com o saldo das contas.
            </p>
          ) : (
            <>
              <p className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                {proof.data?.status === "mismatch" &&
                "total" in proof.data &&
                proof.data.total !== null
                  ? `O banco mostra ${formatCurrency(proof.data.total)}: diferença de ${formatCurrency(Math.abs(proof.data.difference ?? 0))}.`
                  : proof.data
                    ? proofNote(proof.data)
                    : "Não foi possível conferir agora."}
              </p>
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="closing-reason">
                  Por que fechar assim mesmo
                </Label>
                <Textarea
                  id="closing-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  disabled={busy}
                  placeholder="Ex.: extrato da aplicação só sai na semana que vem."
                  aria-describedby="closing-reason-hint"
                />
                <p
                  id="closing-reason-hint"
                  className="text-xs text-muted-foreground"
                >
                  Vai para a contabilidade junto com o fechamento. Mínimo de{" "}
                  {MIN_REASON} letras.
                </p>
              </div>
            </>
          )}
        </section>

        <section className="space-y-1.5">
          <h3 className="font-semibold">O que falta</h3>
          {!synthesis ? (
            <Skeleton className="h-10 w-full" />
          ) : synthesis.gaps.length === 0 ? (
            <p className="text-muted-foreground">Nada pendente.</p>
          ) : (
            <ul className="space-y-1">
              {synthesis.gaps.map((g) => (
                <li key={g.label} className="flex justify-between gap-4">
                  <span>
                    {g.label}{" "}
                    <span className="text-muted-foreground">
                      ({g.lines.length})
                    </span>
                  </span>
                  <span className="font-financial">
                    {formatCurrency(g.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            As pendências vão listadas no PDF e na planilha. Não impedem o
            fechamento.
          </p>
        </section>

        {step.kind === "missing" && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p className="font-medium">
              {plural(
                step.failed.length,
                "documento não foi baixado",
                "documentos não foram baixados",
              )}
              . Nada foi fechado ainda.
            </p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
              {step.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  built.current = null;
                  void run();
                }}
              >
                Baixar de novo
              </Button>
              <Button size="sm" variant="outline" onClick={() => void save()}>
                Fechar sem eles
              </Button>
            </div>
          </div>
        )}
        {step.kind === "error" && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {step.message}
          </p>
        )}
        {tooBig && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            Este mês tem {lines.length} lançamentos; o fechamento guarda até{" "}
            {MAX_LINES}. Fale com o administrador do sistema.
          </p>
        )}
      </div>
      <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t bg-background px-5 py-3">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {step.kind === "documents" &&
            (step.total > 0
              ? `Baixando documentos: ${step.done} de ${step.total}`
              : "Preparando o pacote…")}
          {step.kind === "upload" && `Enviando o pacote: ${step.percent}%`}
          {step.kind === "saving" && "Conferindo e gravando o fechamento…"}
        </p>
        <Button
          onClick={() => void run()}
          loading={busy}
          disabled={
            busy || !full || !reasonOk || tooBig || step.kind === "missing"
          }
        >
          {step.kind === "error" ? "Tentar de novo" : "Fechar o mês"}
        </Button>
      </div>
    </>
  );
}

// ─── Enviar e acessos ─────────────────────────────────────────────────────────

const STATE_LABEL = {
  active: "Ativo",
  expired: "Vencido",
  revoked: "Cancelado",
  failed: "E-mail não saiu",
} as const;

function SendPanel({
  closing,
  versions,
  name,
  changed,
  onCloseAgain,
}: {
  closing: CashClosing;
  versions: CashClosing[];
  name: string;
  changed: boolean;
  onCloseAgain: () => void;
}) {
  const queryClient = useQueryClient();
  const linksKey = ["cash-closing-links", closing.companyId];
  const links = useQuery({
    queryKey: linksKey,
    queryFn: () => cashClosingService.getLinks(closing.companyId),
    staleTime: 15_000,
  });
  const ids = new Set(versions.map((v) => v.id));
  const ofPeriod = (links.data ?? []).filter((l) => ids.has(l.closingId));

  /** Quem recebeu o último envio da empresa, já preenchido. */
  const suggested = useMemo(() => {
    const last = links.data?.[0];
    if (!last) return "";
    return [
      ...new Set(
        links
          .data!.filter((l) => l.closingId === last.closingId && !l.revokedAt)
          .map((l) => l.email),
      ),
    ].join(", ");
  }, [links.data]);
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? suggested;
  const { emails, invalid } = parseEmails(value);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [failures, setFailures] = useState<{ email: string; error: string }[]>(
    [],
  );
  const [revoking, setRevoking] = useState<ClosingLink | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const now = new Date();
  const tooMany = emails.length > MAX_RECIPIENTS;

  const send = async () => {
    setSending(true);
    setFailures([]);
    try {
      const { results } = await cashClosingService.send({
        companyId: closing.companyId,
        closingId: closing.id,
        emails,
        message,
      });
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      if (ok.length > 0)
        toast.success(
          `Enviado para ${plural(ok.length, "pessoa", "pessoas")}.`,
        );
      setFailures(bad.map((r) => ({ email: r.email, error: r.error ?? "" })));
      // Sobra no campo só quem não recebeu, para tentar de novo.
      setTyped(bad.map((r) => r.email).join(", "));
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setSending(false);
      await queryClient.invalidateQueries({ queryKey: linksKey });
    }
  };

  return (
    <>
      <div className="border-b px-5 py-4">
        <SheetTitle className="text-base">
          {name}, versão {closing.version}
        </SheetTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cada pessoa recebe um link próprio, que vale {LINK_DAYS} dias e
          registra os acessos.
        </p>
      </div>
      <div className="space-y-6 px-5 py-4 text-sm">
        {changed && (
          <div
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p>
              Houve mudanças depois do fechamento. O link entrega a versão{" "}
              {closing.version}, como foi congelada.{" "}
              <button
                type="button"
                onClick={onCloseAgain}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                Fechar a versão {closing.version + 1} antes
              </button>
            </p>
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="closing-emails">E-mails da contabilidade</Label>
            <Textarea
              id="closing-emails"
              rows={2}
              value={value}
              disabled={sending || links.isLoading}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="contador@escritorio.com.br, fiscal@escritorio.com.br"
              aria-invalid={invalid.length > 0 || tooMany}
              aria-describedby="closing-emails-hint"
            />
            <p
              id="closing-emails-hint"
              className={cn(
                "text-xs",
                invalid.length > 0 || tooMany
                  ? "text-red-700 dark:text-red-400"
                  : "text-muted-foreground",
              )}
            >
              {invalid.length > 0
                ? `Confira: ${invalid.join(", ")}`
                : tooMany
                  ? `Até ${MAX_RECIPIENTS} pessoas por envio.`
                  : "Separe por vírgula ou linha."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="closing-message">Mensagem (opcional)</Label>
            <Textarea
              id="closing-message"
              rows={3}
              value={message}
              maxLength={600}
              disabled={sending}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          {failures.length > 0 && (
            <ul role="alert" className="text-red-700 dark:text-red-400">
              {failures.map((f) => (
                <li key={f.email}>
                  {f.email}: não saiu. {f.error}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              O link vale até {format(addDays(now, LINK_DAYS), "dd/MM/yyyy")}.
              As respostas vão para o seu e-mail.
            </p>
            <Button
              type="submit"
              loading={sending}
              disabled={
                sending || emails.length === 0 || invalid.length > 0 || tooMany
              }
            >
              {emails.length > 0
                ? `Enviar para ${plural(emails.length, "pessoa", "pessoas")}`
                : "Enviar"}
            </Button>
          </div>
        </form>

        <section className="space-y-2">
          <h3 className="font-semibold">Links e acessos</h3>
          {links.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : links.error ? (
            <p className="text-muted-foreground">
              Não foi possível ler os links.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => links.refetch()}
              >
                Tentar de novo
              </button>
            </p>
          ) : ofPeriod.length === 0 ? (
            <p className="text-muted-foreground">
              Ninguém recebeu este fechamento ainda.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {ofPeriod.map((l) => {
                const state = linkState(l, now);
                return (
                  <li key={l.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {l.email}
                      </span>
                      <span
                        className={cn(
                          "text-xs",
                          state === "failed"
                            ? "text-red-700 dark:text-red-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {STATE_LABEL[state]}
                      </span>
                      {state === "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setRevoking(l)}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Versão {l.version}, enviado em{" "}
                      {format(l.createdAt, "dd/MM/yyyy HH:mm")}, vale até{" "}
                      {format(l.expiresAt, "dd/MM/yyyy")}.{" "}
                      {l.views + l.downloads === 0 ? (
                        "Ainda não abriu."
                      ) : (
                        <button
                          type="button"
                          aria-expanded={open === l.id}
                          onClick={() => setOpen(open === l.id ? null : l.id)}
                          className="underline underline-offset-2 hover:no-underline"
                        >
                          Abriu {plural(l.views, "vez", "vezes")}, baixou{" "}
                          {plural(l.downloads, "vez", "vezes")}
                        </button>
                      )}
                    </p>
                    {open === l.id && <Accesses linkId={l.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Cancelar este link?"
        description={`${revoking?.email ?? ""} não vai mais conseguir abrir o fechamento. O que já foi baixado continua com a pessoa.`}
        confirmText="Cancelar o link"
        cancelText="Voltar"
        variant="destructive"
        onConfirm={async () => {
          const link = revoking!;
          try {
            await cashClosingService.revoke(closing.companyId, link.id);
            await queryClient.invalidateQueries({ queryKey: linksKey });
            toast.success("Link cancelado.");
          } catch (e) {
            toast.error(messageOf(e));
          }
          setRevoking(null);
        }}
      />
    </>
  );
}

const ACCESS_LABEL = {
  view: "Abriu a página",
  package: "Baixou o pacote",
  summary: "Baixou a síntese",
} as const;

function Accesses({ linkId }: { linkId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cash-closing-accesses", linkId],
    queryFn: () => cashClosingService.getAccesses(linkId),
    staleTime: 15_000,
  });
  if (isLoading) return <Skeleton className="mt-2 h-8 w-full" />;
  if (error)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Não foi possível ler os acessos.
      </p>
    );
  return (
    <ul className="mt-2 space-y-0.5 text-xs">
      {data?.map((a) => (
        <li key={a.id} className="flex flex-wrap gap-x-3">
          <span className="font-financial">
            {format(a.at, "dd/MM/yyyy HH:mm")}
          </span>
          <span>{ACCESS_LABEL[a.kind]}</span>
          <span className="text-muted-foreground">IP {a.ip}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── O que mudou ──────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ClosingChange["kind"], string> = {
  added: "Novo",
  removed: "Saiu",
  changed: "Mudou",
};

const day = (iso: string) => iso.split("-").reverse().join("/");

function DiffList({
  diff,
  closing,
  name,
}: {
  diff: ClosingDiff;
  closing: CashClosing;
  name: string;
}) {
  const amount = (c: ClosingChange) => {
    const { before, after } = c;
    if (before && after && before.amount !== after.amount)
      return `${formatCurrency(before.amount)} → ${formatCurrency(after.amount)}`;
    return formatCurrency((after ?? before)!.amount);
  };
  const what = (c: ClosingChange) => {
    if (c.kind === "added") return `baixa em ${day(c.after!.date)}`;
    if (c.kind === "removed")
      return `baixa era ${day(c.before!.date)}; não está mais no mês`;
    return c.fields
      .map((f) =>
        f === "data da baixa"
          ? `data da baixa: ${day(c.before!.date)} → ${day(c.after!.date)}`
          : f === "nota fiscal"
            ? c.after!.note
              ? "nota incluída"
              : "nota retirada"
            : f === "comprovante"
              ? c.after!.receipt
                ? "comprovante incluído"
                : "comprovante retirado"
              : f,
      )
      .join(", ");
  };
  return (
    <>
      <div className="border-b px-5 py-4">
        <SheetTitle className="text-base">
          O que mudou em {lower(name)} depois da versão {closing.version}
        </SheetTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {diff.openingBefore !== diff.openingAfter &&
            `Saldo inicial: ${formatCurrency(diff.openingBefore)} → ${formatCurrency(diff.openingAfter)}. `}
          {diff.balance === 0
            ? "O saldo final é o mesmo."
            : `Saldo final: ${formatCurrency(closing.closing)} → ${formatCurrency(currency(closing.closing).add(diff.balance).value)}.`}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b text-left">
            <th className={TH}>Situação</th>
            <th className={cn(TH, "w-full")}>Lançamento</th>
            <th className={cn(TH, "text-right")}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {diff.changes.map((c) => (
            <tr
              key={c.id}
              className="border-b border-border/60 align-top last:border-0"
            >
              <td className={cn(TD, c.financial && "font-medium")}>
                {KIND_LABEL[c.kind]}
              </td>
              <td className="w-full max-w-0 px-3 py-1.5">
                <span className="block truncate">{c.description}</span>
                <span className="block text-xs text-muted-foreground">
                  {[c.party, what(c)].filter(Boolean).join(" · ")}
                </span>
              </td>
              <td className={cn(TD, "text-right font-financial")}>
                {c.type === "payable" ? "−" : "+"}
                {amount(c)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
