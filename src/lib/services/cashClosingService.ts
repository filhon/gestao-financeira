import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
} from "firebase/firestore";
import { ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
import {
  CLOSING_FILES,
  type CashClosing,
  type ClosingAccess,
  type ClosingFile,
  type ClosingLink,
  type ClosingSnapshot,
} from "@/lib/cashClosing";

const API = "/api/internal/cash-closings";

const toDate = (v: unknown) => (v as Timestamp | undefined)?.toDate?.();

async function call<T>(body: unknown): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(data.error ?? "Não foi possível concluir. Tente de novo.");
  return data as T;
}

/** Bytes que já chegaram ao Storage, dos dois arquivos juntos. */
function upload(
  companyId: string,
  uploadKey: string,
  files: Record<ClosingFile, Blob>,
  onProgress: (percent: number) => void,
) {
  const total = files.package.size + files.summary.size;
  const sent: Record<ClosingFile, number> = { package: 0, summary: 0 };
  return Promise.all(
    (Object.keys(CLOSING_FILES) as ClosingFile[]).map(async (key) => {
      const { name, contentType } = CLOSING_FILES[key];
      const task = uploadBytesResumable(
        ref(storage, `closings/${companyId}/${uploadKey}/${name}`),
        files[key],
        { contentType },
      );
      task.on("state_changed", (s) => {
        sent[key] = s.bytesTransferred;
        onProgress(Math.round(((sent.package + sent.summary) / total) * 100));
      });
      await task;
    }),
  );
}

export const cashClosingService = {
  /** Versões do fechamento do mês, da mais nova à mais antiga. */
  async getByPeriod(companyId: string, period: string): Promise<CashClosing[]> {
    const snap = await getDocs(
      query(
        collection(db, "cash_closings"),
        where("companyId", "==", companyId),
        where("period", "==", period),
      ),
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as DocumentData;
        return {
          ...data,
          id: d.id,
          closedAt: toDate(data.closedAt) ?? new Date(),
        } as CashClosing;
      })
      .sort((a, b) => b.version - a.version);
  },

  /** Links enviados da empresa, do mais novo ao mais antigo. */
  async getLinks(companyId: string): Promise<ClosingLink[]> {
    const snap = await getDocs(
      query(
        collection(db, "cash_closing_links"),
        where("companyId", "==", companyId),
      ),
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as DocumentData;
        return {
          ...data,
          id: d.id,
          createdAt: toDate(data.createdAt) ?? new Date(),
          expiresAt: toDate(data.expiresAt) ?? new Date(0),
          revokedAt: toDate(data.revokedAt),
          lastAccessAt: toDate(data.lastAccessAt),
        } as ClosingLink;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },

  async getAccesses(linkId: string): Promise<ClosingAccess[]> {
    const snap = await getDocs(
      query(
        collection(db, "cash_closing_links", linkId, "accesses"),
        orderBy("at", "desc"),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as DocumentData;
      return {
        ...data,
        id: d.id,
        at: toDate(data.at) ?? new Date(),
      } as ClosingAccess;
    });
  },

  async close(
    input: {
      companyId: string;
      period: string;
      snapshot: ClosingSnapshot;
      reason?: string;
      files: Record<ClosingFile, Blob>;
      /** O mesmo na repetição: o que já subiu e já foi gravado não duplica. */
      uploadKey: string;
      uploaded: boolean;
    },
    on: { upload: (percent: number) => void; saving: () => void },
  ) {
    if (!input.uploaded) {
      await upload(input.companyId, input.uploadKey, input.files, on.upload);
    }
    on.saving();
    return call<{ id: string; version: number }>({
      action: "close",
      companyId: input.companyId,
      period: input.period,
      snapshot: input.snapshot,
      uploadKey: input.uploadKey,
      reason: input.reason?.trim() || undefined,
    });
  },

  send: (input: {
    companyId: string;
    closingId: string;
    emails: string[];
    message?: string;
  }) =>
    call<{ results: { email: string; ok: boolean; error?: string }[] }>({
      action: "send",
      ...input,
      message: input.message?.trim() || undefined,
    }),

  revoke: (companyId: string, linkId: string) =>
    call({ action: "revoke", companyId, linkId }),

  async downloadUrl(companyId: string, closingId: string, file: ClosingFile) {
    const q = new URLSearchParams({ companyId, closingId, file });
    const res = await fetch(`${API}?${q}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Arquivo indisponível.");
    return data.url as string;
  },
};
