"use client";

import { useState, useCallback, useRef } from "react";
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
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { ref, uploadBytes, deleteObject } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { splitPdfPages } from "@/lib/pdfUtils";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { Transaction, ComprovanteMatchStatus } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { InsightLine } from "./InsightLine";
import type { Insight } from "./receiptInsight";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES =
  "application/pdf,image/jpeg,image/png,image/webp,image/gif";

type PageResult = {
  pageNumber: number;
  totalPages: number;
  blob: Blob;
  mimeType: string;
  storageUrl?: string; // não usado na UI — só storagePath é relevante
  storagePath: string;
  fileSize: number;
  comprovanteId: string;
  matchStatus: ComprovanteMatchStatus;
  // best match metadata from server
  bestMatchTransactionId?: string;
  bestMatchTransactionIds?: string[];
  matchConfidence?: number;
  matchConfidenceLevel?: "HIGH" | "MEDIUM" | "LOW";
  matchedAmount?: number;
  matchedDate?: Date;
  matchedEntity?: string;
  isConsolidated?: boolean;
  matchReasons?: string[];
  matchIsAmbiguous?: boolean;
  autoConfirmed?: boolean;
  autoConfirmReason?: string;
  possibleDuplicateOf?: string;
  fileName: string;
  // Só "confirmar" existe: o que não for confirmado já está na fila.
  decision: "confirm" | null;
};

function pageInsight(page: PageResult): Insight | null {
  if (page.autoConfirmed) {
    return {
      tone: "ok",
      text: `Confirmado automaticamente: ${page.autoConfirmReason ?? "regra estrita"}`,
    };
  }
  if (page.possibleDuplicateOf) {
    return {
      tone: "warn",
      text: "Possível duplicado de comprovante já enviado",
    };
  }
  if (page.matchIsAmbiguous) {
    return {
      tone: "warn",
      text: "Outro título é igualmente compatível. Revise antes de confirmar",
    };
  }
  const conflict = page.matchReasons?.find((r) => r.startsWith("⚠"));
  if (conflict) return { tone: "warn", text: conflict.replace(/^⚠\s*/, "") };
  if (page.matchConfidenceLevel === "LOW") {
    return { tone: "warn", text: "Pouca evidência" };
  }
  return page.matchReasons?.[0]
    ? { tone: "ok", text: page.matchReasons[0] }
    : null;
}

const isSafe = (p: PageResult) =>
  !p.autoConfirmed &&
  p.matchConfidenceLevel === "HIGH" &&
  !p.matchIsAmbiguous &&
  !p.possibleDuplicateOf;

type Step = "idle" | "processing" | "review" | "saving" | "done";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function UploadComprovanteDialog({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();

  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [pages, setPages] = useState<PageResult[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("idle");
    setProgress(0);
    setProgressLabel("");
    setPages([]);
    setTransactions([]);
  };

  const handleClose = () => {
    if (step === "processing" || step === "saving") return;
    reset();
    onClose();
  };

  // ── Compute SHA-256 hash of a Blob ────────────────────────────────────────────

  const computeHash = async (blob: Blob): Promise<string> => {
    const buf = await blob.arrayBuffer();
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  // ── Process a single page/image via server-side API route ────────────────────

  const processPage = useCallback(
    async (
      blob: Blob,
      mimeType: string,
      pageNumber: number,
      totalPages: number,
      fileHash: string,
      uploadBatchId: string,
      storageRef: ReturnType<typeof ref>,
    ): Promise<Omit<PageResult, "decision" | "fileName"> | null> => {
      if (!user || !selectedCompany) return null;

      // Upload to Storage first
      await uploadBytes(storageRef, blob, { contentType: mimeType });
      const storagePath = storageRef.fullPath;

      // Call server-side pipeline
      let resp: Response;
      try {
        resp = await fetch("/api/internal/comprovantes/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath,
            companyId: selectedCompany.id,
            pageNumber,
            totalPages,
            fileHash,
            uploadBatchId,
            uploadedBy: user.uid,
            mimeType,
          }),
        });
      } catch {
        throw new Error("network_error");
      }

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "server_error");
      }

      const data = (await resp.json()) as {
        comprovanteId: string;
        matchStatus: ComprovanteMatchStatus;
        suggestedTransactionId?: string;
        suggestedTransactionIds?: string[];
        isConsolidated?: boolean;
        matchConfidence?: number;
        matchConfidenceLevel?: "HIGH" | "MEDIUM" | "LOW";
        matchedAmount?: number;
        matchedDate?: string;
        matchedEntity?: string;
        matchReasons?: string[];
        matchIsAmbiguous?: boolean;
        autoConfirmed?: boolean;
        autoConfirmReason?: string;
        possibleDuplicateOf?: string;
        duplicate?: boolean;
      };

      return {
        pageNumber,
        totalPages,
        blob,
        mimeType,
        storagePath,
        fileSize: blob.size,
        comprovanteId: data.comprovanteId,
        matchStatus: data.matchStatus,
        bestMatchTransactionId: data.suggestedTransactionId,
        bestMatchTransactionIds: data.suggestedTransactionIds,
        isConsolidated: data.isConsolidated,
        matchConfidence: data.matchConfidence,
        matchConfidenceLevel: data.matchConfidenceLevel,
        matchedAmount: data.matchedAmount,
        matchedDate: data.matchedDate ? new Date(data.matchedDate) : undefined,
        matchedEntity: data.matchedEntity,
        matchReasons: data.matchReasons,
        matchIsAmbiguous: data.matchIsAmbiguous,
        autoConfirmed: data.autoConfirmed,
        autoConfirmReason: data.autoConfirmReason,
        possibleDuplicateOf: data.possibleDuplicateOf,
      };
    },
    [user, selectedCompany],
  );

  // ── Main file processing ──────────────────────────────────────────────────────

  const processFiles = useCallback(
    async (files: File[]) => {
      if (!user || !selectedCompany || files.length === 0) return;

      const accepted = files.filter((f) => {
        const type = f.type || "application/pdf";
        return type === "application/pdf" || type.startsWith("image/");
      });
      if (accepted.length < files.length) {
        toast.error(
          `${files.length - accepted.length} arquivo(s) ignorado(s): só PDF e imagens (JPG, PNG, WebP).`,
        );
      }
      if (accepted.length === 0) return;

      try {
        setStep("processing");
        setProgress(5);
        setProgressLabel("Lendo os arquivos...");

        // Split PDFs into pages; images are treated as a single "page"
        type PageEntry = {
          blob: Blob;
          mimeType: string;
          pageNumber: number;
          totalPages: number;
          fileName: string;
          batchId: string;
        };
        const pagesToProcess: PageEntry[] = [];
        for (const file of accepted) {
          const mimeType = file.type || "application/pdf";
          const batchId = uuidv4();
          if (mimeType === "application/pdf") {
            const split = await splitPdfPages(file);
            split.forEach((s) =>
              pagesToProcess.push({
                ...s,
                mimeType: "application/pdf",
                fileName: file.name,
                batchId,
              }),
            );
          } else {
            pagesToProcess.push({
              blob: file,
              mimeType,
              pageNumber: 1,
              totalPages: 1,
              fileName: file.name,
              batchId,
            });
          }
        }

        const total = pagesToProcess.length;
        setProgressLabel(
          `Verificando duplicados (${total} página${total > 1 ? "s" : ""})...`,
        );
        setProgress(15);

        // Compute hashes for batch dedup
        const hashEntries = await Promise.all(
          pagesToProcess.map(async (p) => ({
            ...p,
            fileHash: await computeHash(p.blob),
          })),
        );

        // Batch dedup query (também entre arquivos do mesmo envio)
        const existingHashes = await comprovanteService.findExistingHashes(
          selectedCompany.id,
          hashEntries.map((e) => e.fileHash),
        );
        const seen = new Set<string>();
        const toProcess = hashEntries.filter((e) => {
          if (existingHashes.has(e.fileHash) || seen.has(e.fileHash)) {
            return false;
          }
          seen.add(e.fileHash);
          return true;
        });
        const duplicatesSkipped = hashEntries.length - toProcess.length;
        setProgress(20);

        // Pre-load paid/authorized transactions for the review step display
        const candidates = await transactionService.getAll({
          companyId: selectedCompany.id,
          type: "payable",
          statuses: ["paid", "authorized"],
        });
        setTransactions(candidates);
        setProgress(25);

        const results: PageResult[] = [];
        const pageFailures: string[] = [];

        for (let i = 0; i < toProcess.length; i++) {
          const entry = toProcess[i];
          const { blob, mimeType: pMimeType, pageNumber, totalPages } = entry;
          const label =
            accepted.length > 1
              ? `${entry.fileName}, página ${pageNumber} de ${totalPages}`
              : `página ${pageNumber} de ${totalPages}`;
          setProgressLabel(`Processando ${label}...`);
          setProgress(25 + Math.round((i / toProcess.length) * 65));

          const comprovanteId = uuidv4();
          const storageRef = ref(
            storage,
            `comprovantes/${selectedCompany.id}/${comprovanteId}.${pMimeType.startsWith("image/") ? pMimeType.split("/")[1] : "pdf"}`,
          );

          try {
            const result = await processPage(
              blob,
              pMimeType,
              pageNumber,
              totalPages,
              entry.fileHash,
              entry.batchId,
              storageRef,
            );
            if (!result) {
              pageFailures.push(label);
              continue;
            }
            const page = {
              ...result,
              fileName: entry.fileName,
              decision: null,
            };
            // Pré-marca só o que o algoritmo considera inequívoco.
            results.push({
              ...page,
              decision: isSafe(page) ? "confirm" : null,
            });
          } catch (pageErr) {
            console.error(
              `[UploadComprovanteDialog] ${label} falhou:`,
              pageErr,
            );
            // Roll back Storage upload if it happened
            deleteObject(storageRef).catch(() => {});
            pageFailures.push(label);
          }
        }

        setProgress(100);

        if (pageFailures.length > 0) {
          toast.error(
            `${pageFailures.length} página${pageFailures.length !== 1 ? "s" : ""} falharam ao enviar: ${pageFailures.join("; ")}. Envie de novo só esse arquivo.`,
          );
        }

        if (
          duplicatesSkipped > 0 &&
          results.length === 0 &&
          pageFailures.length === 0
        ) {
          toast.warning(
            `Todas as ${duplicatesSkipped} página${duplicatesSkipped !== 1 ? "s" : ""} já foram enviadas anteriormente.`,
          );
          reset();
          return;
        }

        if (results.length === 0) {
          reset();
          return;
        }

        if (duplicatesSkipped > 0) {
          toast.info(
            `${duplicatesSkipped} página${duplicatesSkipped !== 1 ? "s" : ""} ignorada${duplicatesSkipped !== 1 ? "s" : ""} (já enviadas anteriormente).`,
          );
        }

        setProgressLabel("Análise concluída!");
        setPages(results);
        setStep("review");
        // Os comprovantes já existem (a fila e os automáticos mudaram).
        onSuccess();
      } catch (err) {
        console.error("[UploadComprovanteDialog]", err);
        toast.error("Erro ao processar os arquivos.");
        reset();
      }
    },
    [user, selectedCompany, processPage, onSuccess],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(Array.from(e.dataTransfer.files));
  };

  // ── Save confirmed matches ─────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user || !selectedCompany) return;
    try {
      setStep("saving");
      const toConfirm = pages.filter(
        (p) =>
          p.decision === "confirm" &&
          p.bestMatchTransactionIds &&
          p.bestMatchTransactionIds.length > 0,
      );

      for (const page of toConfirm) {
        const txIds = page.bestMatchTransactionIds!;
        const matchTxs = txIds
          .map((id) => transactions.find((t) => t.id === id))
          .filter((t): t is Transaction => !!t);
        await comprovanteService.confirmMatch(
          page.comprovanteId,
          txIds,
          matchTxs,
          user.uid,
          page.storagePath,
          { companyId: selectedCompany.id, userEmail: user.email ?? "" },
        );
      }

      const confirmed = toConfirm.length + autoCount;
      const total = pages.length;
      const queued = total - confirmed;
      toast.success(
        `${total} comprovante${total > 1 ? "s" : ""} enviado${total > 1 ? "s" : ""}. ` +
          `${confirmed} associado${confirmed !== 1 ? "s" : ""}` +
          (queued > 0 ? `, ${queued} na fila de pendentes.` : "."),
      );
      setStep("done");
      onSuccess();
      setTimeout(() => {
        reset();
        onClose();
      }, 1500);
    } catch (err) {
      console.error("[UploadComprovanteDialog] save", err);
      toast.error("Erro ao salvar associações.");
      setStep("review");
    }
  };

  const toggleDecision = (idx: number) => {
    setPages((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, decision: p.decision ? null : "confirm" } : p,
      ),
    );
  };

  const confirmAllHigh = () => {
    setPages((prev) =>
      prev.map((p) => (isSafe(p) ? { ...p, decision: "confirm" } : p)),
    );
  };

  const highCount = pages.filter(isSafe).length;
  const autoCount = pages.filter((p) => p.autoConfirmed).length;
  const confirmedCount =
    pages.filter((p) => p.decision === "confirm").length + autoCount;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Enviar Comprovantes</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Cada página de PDF vira um comprovante. Os que batem com valor exato
            e CNPJ, Pix ou código de barras são associados na hora; o resto vai
            para a fila de pendentes.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {/* ── IDLE: drop zone ──────────────────────────────────────────────── */}
        {step === "idle" && (
          <button
            type="button"
            className={cn(
              "mt-4 flex w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
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
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={onFileChange}
        />

        {/* ── PROCESSING: progress ─────────────────────────────────────────── */}
        {step === "processing" && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-medium">{progressLabel}</p>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Extraindo texto e analisando correspondências com as transações…
            </p>
          </div>
        )}

        {/* ── REVIEW: results table ─────────────────────────────────────────── */}
        {step === "review" && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {pages.length} comprovante{pages.length !== 1 ? "s" : ""}
                {autoCount > 0 &&
                  `, ${autoCount} associado${autoCount !== 1 ? "s" : ""} automaticamente`}
              </p>
              {highCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={confirmAllHigh}
                  className="gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Marcar os seguros ({highCount})
                </Button>
              )}
            </div>

            <ul className="divide-y rounded-lg border">
              {pages.map((page, idx) => {
                const tx = page.bestMatchTransactionId
                  ? transactions.find(
                      (t) => t.id === page.bestMatchTransactionId,
                    )
                  : null;
                const isNeedsManual = page.matchStatus === "needs_manual";
                const insight = pageInsight(page);
                const extra = (page.bestMatchTransactionIds?.length ?? 1) - 1;

                return (
                  <li
                    key={page.comprovanteId}
                    className={cn(
                      "flex items-start gap-4 px-4 py-3 transition-colors",
                      (page.decision === "confirm" || page.autoConfirmed) &&
                        "bg-emerald-500/5",
                    )}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />

                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-xs text-muted-foreground">
                        {page.fileName} · página {page.pageNumber} de{" "}
                        {page.totalPages}
                      </p>
                      {isNeedsManual ? (
                        <p className="flex items-center gap-2 text-sm">
                          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                          Não foi possível ler o arquivo. Vincule na fila de
                          pendentes.
                        </p>
                      ) : tx ? (
                        <>
                          <p className="truncate text-sm font-medium">
                            {tx.description}
                            {extra > 0 && ` e mais ${extra}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tx.supplierOrClient && `${tx.supplierOrClient} · `}
                            <span className="font-financial">
                              {formatCurrency(
                                page.matchedAmount ??
                                  tx.finalAmount ??
                                  tx.amount,
                              )}
                            </span>
                            {tx.paymentDate &&
                              ` · pago em ${format(tx.paymentDate, "dd/MM/yyyy", { locale: ptBR })}`}
                          </p>
                          {insight && <InsightLine insight={insight} />}
                        </>
                      ) : (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          Nenhum título correspondente encontrado
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    {!isNeedsManual &&
                      !page.autoConfirmed &&
                      page.matchConfidenceLevel &&
                      tx && (
                        <Button
                          size="sm"
                          variant={
                            page.decision === "confirm" ? "default" : "outline"
                          }
                          aria-pressed={page.decision === "confirm"}
                          className="shrink-0 gap-1.5"
                          onClick={() => toggleDecision(idx)}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          {page.decision === "confirm"
                            ? "Confirmado"
                            : "Confirmar"}
                        </Button>
                      )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {confirmedCount} de {pages.length} associado
                {confirmedCount !== 1 ? "s" : ""}. Os demais já estão na fila de
                pendentes.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleClose}>
                  Fechar
                </Button>
                <Button onClick={handleSave} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Salvar confirmações
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── SAVING ──────────────────────────────────────────────────────── */}
        {step === "saving" && (
          <div className="mt-6 flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Salvando associações…
            </p>
          </div>
        )}

        {/* ── DONE ──────────────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="mt-6 flex flex-col items-center gap-4 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm font-medium">Comprovantes enviados!</p>
          </div>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
