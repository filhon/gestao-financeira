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
import { Separator } from "@/components/ui/separator";
import {
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Link2,
  Link2Off,
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
import { ConfidenceBadge } from "./ConfidenceBadge";
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
  // user decision
  decision: "confirm" | "skip" | null;
};

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
    ): Promise<Omit<PageResult, "decision"> | null> => {
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
      };
    },
    [user, selectedCompany],
  );

  // ── Main file processing ──────────────────────────────────────────────────────

  const processFile = useCallback(
    async (file: File) => {
      if (!user || !selectedCompany) return;

      const mimeType = file.type || "application/pdf";
      const isPdf = mimeType === "application/pdf";
      const isImage = mimeType.startsWith("image/");

      if (!isPdf && !isImage) {
        toast.error(
          "Apenas arquivos PDF e imagens (JPG, PNG, WebP) são aceitos.",
        );
        return;
      }

      try {
        setStep("processing");
        setProgress(5);
        setProgressLabel("Lendo o arquivo...");

        // Split PDFs into pages; images are treated as a single "page"
        type PageEntry = {
          blob: Blob;
          mimeType: string;
          pageNumber: number;
          totalPages: number;
        };
        let pagesToProcess: PageEntry[];

        if (isPdf) {
          const split = await splitPdfPages(file);
          pagesToProcess = split.map((s) => ({
            ...s,
            mimeType: "application/pdf",
          }));
        } else {
          pagesToProcess = [
            { blob: file, mimeType, pageNumber: 1, totalPages: 1 },
          ];
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

        // Batch dedup query
        const allHashes = hashEntries.map((e) => e.fileHash);
        const existingHashes = await comprovanteService.findExistingHashes(
          selectedCompany.id,
          allHashes,
        );

        const toProcess = hashEntries.filter(
          (e) => !existingHashes.has(e.fileHash),
        );
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

        const batchId = uuidv4();
        const results: PageResult[] = [];
        const pageFailures: number[] = [];

        for (let i = 0; i < toProcess.length; i++) {
          const {
            blob,
            mimeType: pMimeType,
            pageNumber,
            totalPages,
            fileHash,
          } = toProcess[i];
          setProgressLabel(
            `Processando página ${pageNumber} de ${totalPages}...`,
          );
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
              fileHash,
              batchId,
              storageRef,
            );
            if (!result) {
              pageFailures.push(pageNumber);
              continue;
            }

            results.push({
              ...result,
              decision:
                result.matchConfidenceLevel === "HIGH" ? "confirm" : null,
            });
          } catch (pageErr) {
            console.error(
              `[UploadComprovanteDialog] página ${pageNumber} falhou:`,
              pageErr,
            );
            // Roll back Storage upload if it happened
            deleteObject(storageRef).catch(() => {});
            pageFailures.push(pageNumber);
          }
        }

        setProgress(100);

        if (pageFailures.length > 0) {
          toast.error(
            `${pageFailures.length} página${pageFailures.length !== 1 ? "s" : ""} falharam ao enviar (página${pageFailures.length !== 1 ? "s" : ""} ${pageFailures.join(", ")}).`,
          );
        }

        if (
          duplicatesSkipped > 0 &&
          results.length === 0 &&
          pageFailures.length === 0
        ) {
          toast.warning(
            `Todas as ${duplicatesSkipped} página${duplicatesSkipped !== 1 ? "s" : ""} deste arquivo já foram enviadas anteriormente.`,
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
      } catch (err) {
        console.error("[UploadComprovanteDialog]", err);
        toast.error("Erro ao processar o arquivo.");
        reset();
      }
    },
    [user, selectedCompany, processPage],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
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

      const confirmed = toConfirm.length;
      const total = pages.length;
      toast.success(
        `${total} comprovante${total > 1 ? "s" : ""} enviado${total > 1 ? "s" : ""}. ` +
          `${confirmed} associação${confirmed !== 1 ? "ões" : ""} confirmada${confirmed !== 1 ? "s" : ""}.`,
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

  const toggleDecision = (idx: number, dec: "confirm" | "skip") => {
    setPages((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, decision: p.decision === dec ? null : dec } : p,
      ),
    );
  };

  const confirmAllHigh = () => {
    setPages((prev) =>
      prev.map((p) =>
        p.matchConfidenceLevel === "HIGH" ? { ...p, decision: "confirm" } : p,
      ),
    );
  };

  const highCount = pages.filter(
    (p) => p.matchConfidenceLevel === "HIGH",
  ).length;
  const confirmedCount = pages.filter((p) => p.decision === "confirm").length;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Enviar Comprovantes</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Faça upload de um PDF com um ou mais comprovantes, ou de imagens
            (JPG, PNG). O sistema irá associar automaticamente cada página a uma
            transação.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {/* ── IDLE: drop zone ──────────────────────────────────────────────── */}
        {step === "idle" && (
          <div
            className={cn(
              "mt-4 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
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
                Arraste um arquivo ou clique para selecionar
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                PDF (cada página = um comprovante) · JPG · PNG · WebP
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        )}

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
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {pages.length} comprovante{pages.length !== 1 ? "s" : ""}{" "}
                encontrado{pages.length !== 1 ? "s" : ""}
              </p>
              {highCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={confirmAllHigh}
                  className="gap-1.5 text-xs"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  Confirmar todos com Alta confiança ({highCount})
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {pages.map((page, idx) => {
                const tx = page.bestMatchTransactionId
                  ? transactions.find(
                      (t) => t.id === page.bestMatchTransactionId,
                    )
                  : null;
                const isNeedsManual = page.matchStatus === "needs_manual";

                return (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-lg border p-4 transition-colors",
                      page.decision === "confirm" &&
                        "border-emerald-500/40 bg-emerald-500/5",
                      page.decision === "skip" && "opacity-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            Página {page.pageNumber}/{page.totalPages}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(page.fileSize / 1024).toFixed(0)} KB
                          </p>
                        </div>
                      </div>

                      {/* Match info */}
                      <div className="flex-1 min-w-0">
                        {isNeedsManual ? (
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                            <p className="text-sm text-muted-foreground">
                              Não foi possível ler o arquivo — revise
                              manualmente
                            </p>
                          </div>
                        ) : page.matchConfidenceLevel && tx ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ConfidenceBadge
                                level={page.matchConfidenceLevel}
                                score={page.matchConfidence}
                              />
                              {page.isConsolidated && (
                                <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                  {page.bestMatchTransactionIds?.length}{" "}
                                  transações agrupadas
                                </span>
                              )}
                              <span className="text-sm font-medium truncate">
                                {tx.description}
                                {page.isConsolidated &&
                                  (page.bestMatchTransactionIds?.length ?? 0) >
                                    1 &&
                                  ` e mais ${(page.bestMatchTransactionIds?.length ?? 1) - 1}`}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {tx.supplierOrClient &&
                                `${tx.supplierOrClient} · `}
                              {page.matchedAmount
                                ? formatCurrency(page.matchedAmount)
                                : formatCurrency(tx.finalAmount ?? tx.amount)}
                              {tx.paymentDate &&
                                ` · ${format(tx.paymentDate, "dd/MM/yyyy", { locale: ptBR })}`}
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                            <p className="text-sm text-muted-foreground">
                              Nenhuma transação correspondente encontrada
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {!isNeedsManual && page.matchConfidenceLevel && (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant={
                              page.decision === "confirm"
                                ? "default"
                                : "outline"
                            }
                            className="gap-1.5 h-8 text-xs"
                            onClick={() => toggleDecision(idx, "confirm")}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {page.decision === "confirm"
                              ? "Confirmado"
                              : "Confirmar"}
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              page.decision === "skip" ? "secondary" : "ghost"
                            }
                            className="h-8 w-8 p-0"
                            onClick={() => toggleDecision(idx, "skip")}
                            title="Rejeitar sugestão"
                          >
                            <Link2Off className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {confirmedCount} de {pages.length} associaç
                {confirmedCount !== 1 ? "ões confirmadas" : "ão confirmada"}. Os
                demais entrarão na fila de validação.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button onClick={handleSave} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Finalizar Envio
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
