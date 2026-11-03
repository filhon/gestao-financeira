"use client";

import { useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  ChevronRight,
  FileUp,
  Loader2,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { transactionService } from "@/lib/services/transactionService";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { Transaction } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  useReceiptUploadStore,
  runPool,
  failureLabel,
  type UploadedReceipt,
} from "@/lib/store/useReceiptUploadStore";
import { txCandidatesKey } from "./MatchReviewPanel";
import { InsightLine } from "./InsightLine";
import {
  amountDifference,
  distantPaymentDate,
  isSafeToBulkConfirm,
  linkedTransactionIds,
  readNameDiffers,
  receiptInsight,
  titlesTotal,
} from "./receiptInsight";
import { cn, formatCurrency } from "@/lib/utils";

const ACCEPTED_TYPES =
  "application/pdf,image/jpeg,image/png,image/webp,image/gif";

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

interface Props {
  onSuccess: () => void;
  /** Abre a fila só com este envio; com `comprovanteId`, já no painel dele. */
  onReview: (batchId: string, comprovanteId?: string) => void;
}

export function UploadComprovanteDialog({ onSuccess, onReview }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const upload = useReceiptUploadStore();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ctx =
    user && selectedCompany
      ? {
          companyId: selectedCompany.id,
          uid: user.uid,
          onOpenResult: () => router.push("/financeiro/comprovantes"),
        }
      : null;

  const startFiles = (files: File[]) => {
    if (ctx && files.length) upload.start(files, ctx);
  };

  const fileSummary =
    upload.fileNames.length === 1
      ? upload.fileNames[0]
      : plural(upload.fileNames.length, "arquivo", "arquivos");

  return (
    <ResponsiveModal
      open={upload.dialogOpen}
      onOpenChange={upload.setDialogOpen}
    >
      <ResponsiveModalContent className="grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:max-w-[880px] max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader className="px-6 pt-6 pb-4">
          <ResponsiveModalTitle>
            {upload.status === "idle"
              ? "Enviar comprovantes"
              : upload.status === "processing"
                ? "Lendo comprovantes"
                : "Resultado do envio"}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="truncate">
            {upload.status === "idle"
              ? "Cada página de PDF vira um comprovante. Os que batem com valor exato e CNPJ, Pix ou código de barras são associados na hora; o resto vai para a fila."
              : `${fileSummary} · ${plural(upload.total, "página", "páginas")}`}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {upload.status === "idle" && (
          <div className="px-6 pb-6">
            <button
              type="button"
              className={cn(
                "flex w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                startFiles(Array.from(e.dataTransfer.files));
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <FileUp className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Arraste os arquivos ou clique para selecionar
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Vários de uma vez · PDF, JPG, PNG ou WebP
                </p>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => {
                startFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
        )}

        {upload.status === "processing" && (
          <ProcessingView onBackground={() => upload.setDialogOpen(false)} />
        )}

        {upload.status === "done" && ctx && (
          <ResultView
            ctx={ctx}
            onSuccess={onSuccess}
            onReview={(id) => {
              const batchId = upload.batchId!;
              upload.setDialogOpen(false);
              onReview(batchId, id);
            }}
            onClose={() => upload.setDialogOpen(false)}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

// ── Leitura em andamento ─────────────────────────────────────────────────────

function ProcessingView({ onBackground }: { onBackground: () => void }) {
  const { phase, total, processed, results } = useReceiptUploadStore();
  const auto = results.filter((r) => r.autoConfirmed).length;
  const pct = total ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="space-y-4 px-6 pb-6">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {phase}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {processed} de {total}
        </span>
      </div>
      <Progress value={pct} className="h-2" aria-label="Progresso da leitura" />
      {results.length > 0 && (
        <p className="text-sm text-muted-foreground tabular-nums">
          Até agora: {plural(auto, "associado", "associados")} automaticamente,{" "}
          {results.length - auto} para a fila.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Pode fechar esta janela: a leitura continua e você é avisado ao
          terminar. Só não feche a aba do navegador.
        </p>
        <Button variant="outline" onClick={onBackground}>
          Continuar em segundo plano
        </Button>
      </div>
    </div>
  );
}

// ── Resultado ────────────────────────────────────────────────────────────────

type Ctx = { companyId: string; uid: string };

function ResultView({
  ctx,
  onSuccess,
  onReview,
  onClose,
}: {
  ctx: Ctx;
  onSuccess: () => void;
  onReview: (comprovanteId?: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const upload = useReceiptUploadStore();
  const [confirming, setConfirming] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: txCandidatesKey(ctx.companyId),
    queryFn: () =>
      transactionService.getAll({
        companyId: ctx.companyId,
        type: "payable",
        statuses: ["paid", "authorized"],
      }),
    staleTime: 5 * 60 * 1000,
  });
  const byId = useMemo(
    () => new Map(candidates.map((t) => [t.id, t])),
    [candidates],
  );
  const txsFor = (r: UploadedReceipt) =>
    linkedTransactionIds(r)
      .map((id) => byId.get(id))
      .filter((t): t is Transaction => !!t);

  const multiFile = upload.fileNames.length > 1;
  const byPage = (a: UploadedReceipt, b: UploadedReceipt) =>
    a.fileName.localeCompare(b.fileName) || a.pageNumber - b.pageNumber;

  const done = upload.results.filter((r) => r.matchStatus === "matched");
  const safe = upload.results.filter((r) => isSafeToBulkConfirm(r, txsFor(r)));
  const safeIds = new Set(safe.map((r) => r.id));
  // Com sugestão primeiro (decisão rápida), depois sem título e ilegíveis.
  const attention = upload.results
    .filter((r) => r.matchStatus !== "matched" && !safeIds.has(r.id))
    .sort(
      (a, b) =>
        Number(a.matchStatus !== "pending_review") -
          Number(b.matchStatus !== "pending_review") || byPage(a, b),
    );
  const autoCount = done.filter((r) => r.autoConfirmed).length;

  const confirmSafe = async () => {
    if (!user) return;
    setConfirming(true);
    // Dois comprovantes apontando para o mesmo título não passam em lote.
    const used = new Set<string>();
    const batch = safe.filter((r) => {
      const ids = linkedTransactionIds(r);
      if (ids.some((id) => used.has(id))) return false;
      ids.forEach((id) => used.add(id));
      return true;
    });
    const confirmed: UploadedReceipt[] = [];
    const actor = { companyId: ctx.companyId, userEmail: user.email ?? "" };

    await runPool(batch, 4, async (r) => {
      try {
        await comprovanteService.confirmMatch(
          r.id,
          linkedTransactionIds(r),
          txsFor(r),
          user.uid,
          r.storagePath,
          actor,
        );
        confirmed.push(r);
      } catch (err) {
        console.error("[confirm-safe]", err);
      }
    });

    const now = new Date();
    upload.patchResults(
      Object.fromEntries(
        confirmed.map((r) => {
          const ids = linkedTransactionIds(r);
          return [
            r.id,
            {
              matchStatus: "matched" as const,
              transactionId: ids[0],
              transactionIds: ids,
              reviewedAt: now,
            },
          ];
        }),
      ),
    );
    setConfirming(false);
    onSuccess();

    const left = safe.length - confirmed.length;
    toast.success(
      `${plural(confirmed.length, "associação confirmada", "associações confirmadas")}` +
        (left ? `. ${left} ficaram para revisão individual.` : "."),
      {
        action: {
          label: "Desfazer",
          onClick: async () => {
            await runPool(confirmed, 4, (r) =>
              comprovanteService.removeMatch(
                r.id,
                linkedTransactionIds(r),
                user.uid,
                actor,
                "pending_review",
              ),
            );
            upload.patchResults(
              Object.fromEntries(
                confirmed.map((r) => [
                  r.id,
                  {
                    matchStatus: "pending_review" as const,
                    transactionId: undefined,
                    transactionIds: undefined,
                    reviewedAt: undefined,
                  },
                ]),
              ),
            );
            onSuccess();
          },
        },
      },
    );
  };

  const nothingNew =
    upload.results.length === 0 && upload.failures.length === 0;

  return (
    <>
      <div className="space-y-6 px-6 pb-6">
        <p className="text-sm tabular-nums">
          {nothingNew ? (
            `Todas as ${upload.duplicates} páginas já tinham sido enviadas antes. Nada novo para ler.`
          ) : (
            <>
              <span className="font-medium">
                {plural(
                  upload.results.length,
                  "comprovante lido",
                  "comprovantes lidos",
                )}
              </span>
              <span className="text-muted-foreground">
                {": "}
                {plural(done.length, "associado", "associados")}
                {autoCount > 0 && ` (${autoCount} automaticamente)`},{" "}
                {safe.length} pronto{safe.length !== 1 && "s"} para confirmar,{" "}
                {attention.length} precisa{attention.length !== 1 && "m"} de
                você.
                {upload.duplicates > 0 &&
                  ` ${plural(upload.duplicates, "página repetida foi ignorada", "páginas repetidas foram ignoradas")}.`}
              </span>
            </>
          )}
        </p>

        {upload.failures.length > 0 && (
          <div
            role="alert"
            className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium text-destructive">
                {plural(
                  upload.failures.length,
                  "página falhou",
                  "páginas falharam",
                )}{" "}
                e não foi gravada
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {upload.failures.map(failureLabel).join("; ")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => upload.retryFailures(ctx)}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Tentar de novo
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando os títulos…
          </div>
        ) : (
          <>
            {attention.length > 0 && (
              <Section
                title="Precisam de você"
                count={attention.length}
                hint="Abra cada um para ver o comprovante ao lado e escolher o título."
              >
                {attention.map((r) => (
                  <ReceiptRow
                    key={r.id}
                    r={r}
                    txs={txsFor(r)}
                    multiFile={multiFile}
                    onReview={() => onReview(r.id)}
                  />
                ))}
              </Section>
            )}

            {safe.length > 0 && (
              <Section
                title="Prontos para confirmar"
                count={safe.length}
                hint="Evidência forte, valor e data conferem, sem empate nem duplicado."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={confirmSafe}
                    disabled={confirming}
                  >
                    {confirming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    )}
                    Confirmar {safe.length === 1 ? "este" : `os ${safe.length}`}
                  </Button>
                }
              >
                {[...safe].sort(byPage).map((r) => (
                  <ReceiptRow
                    key={r.id}
                    r={r}
                    txs={txsFor(r)}
                    multiFile={multiFile}
                    onReview={() => onReview(r.id)}
                  />
                ))}
              </Section>
            )}

            {done.length > 0 && (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  Associados
                  <span className="font-normal tabular-nums text-muted-foreground">
                    {done.length}
                  </span>
                </summary>
                <ul className="mt-2 divide-y rounded-lg border">
                  {[...done].sort(byPage).map((r) => (
                    <ReceiptRow
                      key={r.id}
                      r={r}
                      txs={txsFor(r)}
                      multiFile={multiFile}
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-6 py-3">
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        {attention.length > 0 && (
          <Button onClick={() => onReview()} className="gap-1.5">
            Revisar{" "}
            {attention.length === 1 ? "o pendente" : `os ${attention.length}`}{" "}
            na fila
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );
}

function Section({
  title,
  count,
  hint,
  action,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {title}{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      <ul className="divide-y rounded-lg border">{children}</ul>
    </section>
  );
}

// ── Linha: o que foi lido × o título sugerido ────────────────────────────────

const WARN = "font-medium text-amber-700 dark:text-amber-400";

function ReceiptRow({
  r,
  txs,
  multiFile,
  onReview,
}: {
  r: UploadedReceipt;
  txs: Transaction[];
  multiFile: boolean;
  onReview?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const insight = receiptInsight(r, txs);
  const amountOff = amountDifference(r, txs) !== null;
  const dateOff = distantPaymentDate(r, txs) !== null;
  const nameOff = readNameDiffers(r.matchedEntity, txs[0]?.supplierOrClient);
  const paidOn = txs.find((t) => t.paymentDate)?.paymentDate;
  const titleAmount = txs.length ? titlesTotal(txs) : null;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5">
      <span
        className={cn(
          "pt-0.5 text-xs tabular-nums text-muted-foreground",
          multiFile ? "w-24" : "w-10",
        )}
        title={`${r.fileName}, página ${r.pageNumber} de ${r.totalPages}`}
      >
        {multiFile && <span className="block truncate">{r.fileName}</span>}
        p. {r.pageNumber}
      </span>

      <div className="min-w-0 space-y-0.5 text-sm">
        {r.matchStatus === "needs_manual" ? (
          <p className="text-muted-foreground">
            Não foi possível ler o arquivo.
          </p>
        ) : (
          <Line label="Lido">
            <span className={cn(nameOff && WARN)}>
              {r.matchedEntity ?? "Beneficiário não lido"}
            </span>
            {r.matchedAmount != null && (
              <>
                {" · "}
                <span className={cn("font-financial", amountOff && WARN)}>
                  {formatCurrency(r.matchedAmount)}
                </span>
              </>
            )}
            {r.matchedDate && (
              <>
                {" · "}
                <span className={cn(dateOff && WARN)}>
                  {format(r.matchedDate, "dd/MM/yyyy")}
                </span>
              </>
            )}
          </Line>
        )}

        {txs.length > 0 ? (
          <Line label="Título">
            <span className="font-medium">{txs[0].description}</span>
            {txs.length > 1 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="ml-1 rounded text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                e mais {txs.length - 1}
              </button>
            )}
            {txs[0].supplierOrClient && ` · ${txs[0].supplierOrClient}`}
            {titleAmount != null && (
              <>
                {" · "}
                <span className="font-financial">
                  {formatCurrency(titleAmount)}
                </span>
              </>
            )}
            {paidOn && ` · pago em ${format(paidOn, "dd/MM/yyyy")}`}
          </Line>
        ) : (
          r.matchStatus !== "needs_manual" && (
            <Line label="Título">
              <span className="text-muted-foreground">
                Nenhum título compatível
              </span>
            </Line>
          )
        )}

        {expanded && (
          <ul className="my-1 ml-13 space-y-0.5 border-l pl-3 text-xs text-muted-foreground">
            {txs.map((t) => (
              <li key={t.id} className="flex justify-between gap-3">
                <span className="truncate">{t.description}</span>
                <span className="shrink-0 font-financial">
                  {formatCurrency(t.finalAmount ?? t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <InsightLine insight={insight} className="max-w-full" />
      </div>

      {onReview ? (
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={onReview}
        >
          Revisar
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <span />
      )}
    </li>
  );
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="flex min-w-0 gap-2">
      <span className="w-11 shrink-0 pt-px text-xs text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}
