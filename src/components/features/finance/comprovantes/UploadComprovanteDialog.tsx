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
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { splitPdfPages, extractTextFromPdf } from "@/lib/pdfUtils";
import { matchTransactions, MatchScore } from "@/lib/matchingAlgorithm";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { Transaction } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type PageResult = {
  pageNumber: number;
  totalPages: number;
  blob: Blob;
  extractedText: string;
  storageUrl: string;
  storagePath: string;
  fileSize: number;
  comprovanteId: string;
  // best match
  bestMatch: MatchScore | null;
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

  // ── File processing ──────────────────────────────────────────────────────────

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.includes("pdf")) {
        toast.error("Apenas arquivos PDF são aceitos.");
        return;
      }
      if (!user || !selectedCompany) return;

      try {
        setStep("processing");
        setProgress(5);
        setProgressLabel("Lendo o arquivo PDF...");

        // 1. Split pages
        const splitResult = await splitPdfPages(file);
        const total = splitResult.length;
        setProgressLabel(`Extraindo ${total} página${total > 1 ? "s" : ""}...`);
        setProgress(20);

        // 2. Load candidate transactions (paid or authorized payables)
        const allTx = await transactionService.getAll({
          companyId: selectedCompany.id,
          type: "payable",
        });
        const candidates = allTx.filter(
          (t) => t.status === "paid" || t.status === "authorized",
        );
        setTransactions(candidates);

        const batchId = uuidv4();
        const results: PageResult[] = [];
        let duplicatesSkipped = 0;

        for (let i = 0; i < splitResult.length; i++) {
          const { blob, pageNumber, totalPages } = splitResult[i];
          setProgressLabel(
            `Processando página ${pageNumber} de ${totalPages}...`,
          );
          setProgress(20 + Math.round((i / total) * 60));

          // 3. Compute SHA-256 hash for deduplication
          const hashBuf = await crypto.subtle.digest(
            "SHA-256",
            await blob.arrayBuffer(),
          );
          const fileHash = Array.from(new Uint8Array(hashBuf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          // 4. Check for duplicate — skip page if already uploaded
          const existing = await comprovanteService.findByHash(
            selectedCompany.id,
            fileHash,
          );
          if (existing) {
            duplicatesSkipped++;
            continue;
          }

          // 5. Extract text
          const text = await extractTextFromPdf(blob);

          // 6. Match
          const scores = matchTransactions(text, candidates);
          const best = scores[0] ?? null;

          // 7. Upload page to Storage
          const comprovanteId = uuidv4();
          const storageRef = ref(
            storage,
            `comprovantes/${selectedCompany.id}/${comprovanteId}.pdf`,
          );
          await uploadBytes(storageRef, blob, {
            contentType: "application/pdf",
          });
          const storageUrl = await getDownloadURL(storageRef);

          // 8. Save to Firestore (pending_review or unmatched)
          const firestoreId = await comprovanteService.create({
            companyId: selectedCompany.id,
            uploadBatchId: batchId,
            pageNumber,
            totalPages,
            storageUrl,
            storagePath: storageRef.fullPath,
            fileSize: blob.size,
            fileHash,
            matchStatus: best ? "pending_review" : "unmatched",
            suggestedTransactionId: best?.transactionId,
            suggestedTransactionIds: best?.transactionIds,
            isConsolidated: best?.isConsolidated ?? false,
            matchConfidence: best?.score,
            matchConfidenceLevel: best?.confidenceLevel,
            matchedAmount: best?.matchedAmount,
            matchedDate: best?.matchedDate,
            matchedEntity: best?.matchedEntity,
            extractedText: text,
            uploadedBy: user.uid,
            uploadedAt: new Date(),
          });

          results.push({
            pageNumber,
            totalPages,
            blob,
            extractedText: text,
            storageUrl,
            storagePath: storageRef.fullPath,
            fileSize: blob.size,
            comprovanteId: firestoreId,
            bestMatch: best,
            // auto-confirm HIGH confidence matches for admin review
            decision: best?.confidenceLevel === "HIGH" ? "confirm" : null,
          });
        }

        setProgress(100);

        if (duplicatesSkipped > 0 && results.length === 0) {
          toast.warning(
            `Todas as ${duplicatesSkipped} página${duplicatesSkipped !== 1 ? "s" : ""} deste PDF já foram enviadas anteriormente.`,
          );
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
        toast.error("Erro ao processar o arquivo PDF.");
        reset();
      }
    },
    [user, selectedCompany],
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

  // ── Save confirmed matches ───────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user) return;
    try {
      setStep("saving");
      const toConfirm = pages.filter(
        (p) => p.decision === "confirm" && p.bestMatch,
      );

      for (const page of toConfirm) {
        await comprovanteService.confirmMatch(
          page.comprovanteId,
          page.bestMatch!.transactionIds,
          page.storageUrl,
          user.uid,
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
        p.bestMatch?.confidenceLevel === "HIGH"
          ? { ...p, decision: "confirm" }
          : p,
      ),
    );
  };

  const highCount = pages.filter(
    (p) => p.bestMatch?.confidenceLevel === "HIGH",
  ).length;
  const confirmedCount = pages.filter((p) => p.decision === "confirm").length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Enviar Comprovantes</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Faça upload de um PDF com um ou mais comprovantes de pagamento. O
            sistema irá associar automaticamente cada página a uma transação.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {/* ── IDLE: drop zone ─────────────────────────────────────────────── */}
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
                Arraste um PDF ou clique para selecionar
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada página do PDF será tratada como um comprovante separado
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
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
              Extraindo texto e analisando matches com as transações do sistema…
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
                const tx = page.bestMatch
                  ? transactions.find(
                      (t) => t.id === page.bestMatch!.transactionId,
                    )
                  : null;

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
                        {page.bestMatch && tx ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ConfidenceBadge
                                level={page.bestMatch.confidenceLevel}
                                score={page.bestMatch.score}
                              />
                              {page.bestMatch.isConsolidated && (
                                <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                  {page.bestMatch.transactionIds.length}{" "}
                                  transações agrupadas
                                </span>
                              )}
                              <span className="text-sm font-medium truncate">
                                {tx.description}
                                {page.bestMatch.isConsolidated &&
                                  page.bestMatch.transactionIds.length > 1 &&
                                  ` e mais ${page.bestMatch.transactionIds.length - 1}`}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {tx.supplierOrClient &&
                                `${tx.supplierOrClient} · `}
                              {page.bestMatch.matchedAmount
                                ? formatCurrency(page.bestMatch.matchedAmount)
                                : formatCurrency(tx.finalAmount ?? tx.amount)}
                              {tx.paymentDate &&
                                ` · ${format(tx.paymentDate, "dd/MM/yyyy", { locale: ptBR })}`}
                            </p>
                            <p className="text-xs text-muted-foreground italic">
                              {page.bestMatch.reasons.join(" · ")}
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
                      {page.bestMatch && (
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

        {/* ── DONE ─────────────────────────────────────────────────────────── */}
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
