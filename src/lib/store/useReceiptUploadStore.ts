import { create } from "zustand";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { ref, uploadBytesResumable, deleteObject } from "firebase/storage";
import { connectionAwareError } from "@/lib/errors";
import { storage } from "@/lib/firebase/client";
import { splitPdfPages } from "@/lib/pdfUtils";
import { comprovanteService } from "@/lib/services/comprovanteService";
import type { Comprovante } from "@/lib/types";

/** Comprovante recém-lido, com o nome do arquivo de origem. */
export type UploadedReceipt = Comprovante & { fileName: string };

interface PageJob {
  blob: Blob;
  mimeType: string;
  pageNumber: number;
  totalPages: number;
  fileName: string;
  fileHash: string;
}

/** Página que não foi gravada, com o motivo. */
export type FailedPage = PageJob & { message: string };

interface UploadContext {
  companyId: string;
  uid: string;
  /** Leva o usuário à tela de comprovantes (o aviso pode chegar em outra tela). */
  onOpenResult?: () => void;
}

interface ReceiptUploadState {
  status: "idle" | "processing" | "done";
  dialogOpen: boolean;
  batchId: string | null;
  startedAt: Date | null;
  fileNames: string[];
  phase: string;
  total: number;
  processed: number;
  results: UploadedReceipt[];
  failures: FailedPage[];
  duplicates: number;
  /** Bytes das páginas desta rodada: o envio é real, a leitura depois não informa. */
  bytesSent: number;
  bytesTotal: number;
  setDialogOpen: (open: boolean) => void;
  start: (files: File[], ctx: UploadContext) => Promise<void>;
  /** Refaz uma página; sem ela, todas as que falharam. */
  retryFailures: (ctx: UploadContext, page?: FailedPage) => Promise<void>;
  patchResults: (patches: Record<string, Partial<Comprovante>>) => void;
  reset: () => void;
}

const CONCURRENCY = 4;

/** Roda `fn` sobre os itens com no máximo `limit` chamadas ao mesmo tempo. */
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const failureLabel = (job: { fileName: string; pageNumber: number }) =>
  `${job.fileName}, página ${job.pageNumber}`;

const warnBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();

/** Sobe a página e roda o pipeline no servidor. null = já existia. */
async function processPage(
  job: PageJob,
  ctx: UploadContext,
  batchId: string,
  onBytes: (delta: number) => void,
): Promise<UploadedReceipt | null> {
  const ext = job.mimeType.startsWith("image/")
    ? job.mimeType.split("/")[1]
    : "pdf";
  const storageRef = ref(
    storage,
    `comprovantes/${ctx.companyId}/${uuidv4()}.${ext}`,
  );

  try {
    const task = uploadBytesResumable(storageRef, job.blob, {
      contentType: job.mimeType,
    });
    let sent = 0;
    task.on("state_changed", (s) => {
      onBytes(s.bytesTransferred - sent);
      sent = s.bytesTransferred;
    });
    await task;
    const resp = await fetch("/api/internal/comprovantes/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath: storageRef.fullPath,
        companyId: ctx.companyId,
        pageNumber: job.pageNumber,
        totalPages: job.totalPages,
        fileHash: job.fileHash,
        uploadBatchId: batchId,
        uploadedBy: ctx.uid,
        mimeType: job.mimeType,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error ?? "server_error");

    // Outro envio gravou o mesmo arquivo antes deste: o upload sobra.
    if (data.duplicate) {
      deleteObject(storageRef).catch(() => {});
      return null;
    }

    const now = new Date();
    const linked = data.autoConfirmed
      ? data.suggestedTransactionIds
      : undefined;
    return {
      id: data.comprovanteId,
      companyId: ctx.companyId,
      uploadBatchId: batchId,
      pageNumber: job.pageNumber,
      totalPages: job.totalPages,
      storagePath: storageRef.fullPath,
      fileSize: job.blob.size,
      fileName: job.fileName,
      matchStatus: data.matchStatus,
      transactionId: linked?.[0],
      transactionIds: linked,
      suggestedTransactionId: data.suggestedTransactionId,
      suggestedTransactionIds: data.suggestedTransactionIds,
      isConsolidated: data.isConsolidated,
      matchConfidence: data.matchConfidence,
      matchConfidenceLevel: data.matchConfidenceLevel,
      matchedAmount: data.matchedAmount,
      matchedDate: data.matchedDate ? new Date(data.matchedDate) : undefined,
      matchedEntity: data.matchedEntity,
      matchReasons: data.matchReasons,
      matchIsAmbiguous: data.matchIsAmbiguous,
      matchAlternatives: data.matchAlternatives,
      matchSignals: data.matchSignals,
      possibleDuplicateOf: data.possibleDuplicateOf,
      autoConfirmed: data.autoConfirmed,
      autoConfirmReason: data.autoConfirmReason,
      uploadedBy: ctx.uid,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    deleteObject(storageRef).catch(() => {});
    throw err;
  }
}

const INITIAL = {
  status: "idle" as const,
  batchId: null,
  startedAt: null,
  fileNames: [],
  phase: "",
  total: 0,
  processed: 0,
  results: [],
  failures: [],
  duplicates: 0,
  bytesSent: 0,
  bytesTotal: 0,
};

/**
 * Envio de comprovantes fora do ciclo de vida do modal: fechar a janela não
 * interrompe a leitura, que continua enquanto a aba estiver aberta.
 */
export const useReceiptUploadStore = create<ReceiptUploadState>((set, get) => {
  const runJobs = async (jobs: PageJob[], ctx: UploadContext) => {
    const batchId = get().batchId!;
    set({
      phase: "Lendo comprovantes",
      bytesSent: 0,
      bytesTotal: jobs.reduce((sum, job) => sum + job.blob.size, 0),
    });

    await runPool(jobs, CONCURRENCY, async (job) => {
      try {
        const r = await processPage(job, ctx, batchId, (delta) =>
          set((s) => ({ bytesSent: s.bytesSent + delta })),
        );
        set((s) =>
          r
            ? { results: [...s.results, r], processed: s.processed + 1 }
            : { duplicates: s.duplicates + 1, processed: s.processed + 1 },
        );
      } catch (err) {
        console.error(`[receipt-upload] ${failureLabel(job)}:`, err);
        set((s) => ({
          failures: [
            ...s.failures,
            {
              ...job,
              message: connectionAwareError(
                err,
                "Não foi possível ler esta página.",
              ),
            },
          ],
          processed: s.processed + 1,
        }));
      }
    });

    // Comprovantes do mesmo valor e favorecido não disputam a mesma conta.
    if (!get().results.some((r) => r.matchStatus === "pending_review")) return;
    set({ phase: "Distribuindo as sugestões" });
    const changed = await comprovanteService
      .rebalance(ctx.companyId)
      .catch(() => []);
    const byId = new Map(changed.map((c) => [c.comprovanteId, c]));
    set((s) => ({
      results: s.results.map((r) => {
        const c = byId.get(r.id);
        if (!c) return r;
        return {
          ...r,
          ...(c.suggestedTransactionIds && {
            suggestedTransactionId: c.suggestedTransactionId,
            suggestedTransactionIds: c.suggestedTransactionIds,
            isConsolidated: c.isConsolidated,
            matchConfidence: c.matchConfidence,
            matchConfidenceLevel: c.matchConfidenceLevel,
            matchedAmount: c.matchedAmount,
            matchedDate: c.matchedDate ? new Date(c.matchedDate) : undefined,
            matchedEntity: c.matchedEntity,
          }),
          matchReasons: c.matchReasons,
          matchIsAmbiguous: c.matchIsAmbiguous,
        };
      }),
    }));
  };

  const finish = (ctx: UploadContext) => {
    window.removeEventListener("beforeunload", warnBeforeUnload);
    set({ status: "done", phase: "" });
    const { dialogOpen, results, failures } = get();
    if (dialogOpen) return;
    const auto = results.filter((r) => r.autoConfirmed).length;
    toast.success(
      `Leitura concluída: ${results.length} comprovante${results.length !== 1 ? "s" : ""}, ` +
        `${auto} associado${auto !== 1 ? "s" : ""} automaticamente` +
        (failures.length ? `, ${failures.length} com falha.` : "."),
      {
        duration: 15_000,
        action: {
          label: "Ver resultado",
          onClick: () => {
            set({ dialogOpen: true });
            ctx.onOpenResult?.();
          },
        },
      },
    );
  };

  return {
    ...INITIAL,
    dialogOpen: false,

    setDialogOpen: (open) => {
      // Fechar depois de ver o resultado encerra o envio: tudo já está na fila.
      if (!open && get().status === "done") set({ ...INITIAL });
      set({ dialogOpen: open });
    },

    async start(files, ctx) {
      if (get().status === "processing") return;

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

      set({
        ...INITIAL,
        status: "processing",
        batchId: uuidv4(),
        startedAt: new Date(),
        fileNames: accepted.map((f) => f.name),
        phase: "Separando as páginas",
      });
      window.addEventListener("beforeunload", warnBeforeUnload);

      try {
        const pages: Omit<PageJob, "fileHash">[] = [];
        for (const file of accepted) {
          const mimeType = file.type || "application/pdf";
          if (mimeType === "application/pdf") {
            for (const s of await splitPdfPages(file)) {
              pages.push({ ...s, mimeType, fileName: file.name });
            }
          } else {
            pages.push({
              blob: file,
              mimeType,
              pageNumber: 1,
              totalPages: 1,
              fileName: file.name,
            });
          }
        }

        set({ phase: "Procurando duplicados", total: pages.length });
        const hashed = await Promise.all(
          pages.map(async (p) => ({ ...p, fileHash: await sha256(p.blob) })),
        );
        const existing = await comprovanteService.findExistingHashes(
          ctx.companyId,
          hashed.map((p) => p.fileHash),
        );
        const seen = new Set<string>();
        const jobs = hashed.filter((p) => {
          if (existing.has(p.fileHash) || seen.has(p.fileHash)) return false;
          seen.add(p.fileHash);
          return true;
        });
        set({
          duplicates: hashed.length - jobs.length,
          processed: hashed.length - jobs.length,
        });

        await runJobs(jobs, ctx);
      } catch (err) {
        console.error("[receipt-upload]", err);
        toast.error("Erro ao ler os arquivos. Nada do que falhou foi gravado.");
      } finally {
        finish(ctx);
      }
    },

    async retryFailures(ctx, page) {
      const jobs = page ? [page] : get().failures;
      if (!jobs.length || get().status === "processing") return;
      set((s) => ({
        status: "processing",
        failures: s.failures.filter((f) => !jobs.includes(f)),
        processed: s.processed - jobs.length,
      }));
      window.addEventListener("beforeunload", warnBeforeUnload);
      try {
        await runJobs(jobs, ctx);
      } finally {
        finish(ctx);
      }
    },

    patchResults: (patches) =>
      set((s) => ({
        results: s.results.map((r) =>
          patches[r.id] ? { ...r, ...patches[r.id] } : r,
        ),
      })),

    reset: () => set({ ...INITIAL }),
  };
});
