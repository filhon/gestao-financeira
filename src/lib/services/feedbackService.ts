"use client";

import {
  collection,
  getCountFromServer,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { CreateFeedbackInput } from "@/lib/feedback";
import type { Feedback, FeedbackEvent, FeedbackStatus } from "@/lib/types";

const COLLECTION_NAME = "feedbacks";

const toDate = (value: unknown) => (value as Timestamp | undefined)?.toDate?.();

const convertDates = (data: DocumentData): Feedback =>
  ({
    ...data,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    respondedAt: toDate(data.respondedAt),
    dueAt: toDate(data.dueAt),
    fixedAt: toDate(data.fixedAt),
    events: ((data.events ?? []) as DocumentData[]).map(
      (e) => ({ ...e, at: toDate(e.at) ?? new Date(0) }) as FeedbackEvent,
    ),
    errorContext: data.errorContext
      ? { ...data.errorContext, timestamp: toDate(data.errorContext.timestamp) }
      : undefined,
  }) as Feedback;

const list = async (constraints: Parameters<typeof query>[1][]) => {
  const snapshot = await getDocs(
    query(collection(db, COLLECTION_NAME), ...constraints),
  );
  return snapshot.docs.map((d) => convertDates({ id: d.id, ...d.data() }));
};

/** Toda escrita passa pelo servidor: é ele que avisa as pessoas e numera. */
async function post<T = unknown>(body: object): Promise<T> {
  const response = await fetch("/api/internal/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error ?? "Falha ao salvar. Tente novamente.");
  }
  return json as T;
}

export const feedbackService = {
  /** Reenviar com o mesmo id devolve o mesmo chamado: não duplica. */
  create: (input: CreateFeedbackInput) =>
    post<{ id: string; protocol: string; dueAt: string | null }>({
      action: "create",
      ...input,
    }),

  getByUser: (userId: string) =>
    list([where("userId", "==", userId), orderBy("createdAt", "desc")]),

  /** Só admin global (rules). */
  getAll: () => list([orderBy("createdAt", "desc")]),

  reply: (id: string, text: string) => post({ action: "reply", id, text }),

  rate: (id: string, solved: boolean) => post({ action: "rate", id, solved }),

  markSeen: (id: string) => post({ action: "seen", id }),

  teamUpdate: (
    id: string,
    input: { text?: string; status?: FeedbackStatus; inRelease?: boolean },
  ) => post({ action: "team", id, ...input }),

  merge: (id: string, targetId: string) =>
    post({ action: "merge", id, targetId }),

  /** Selo da barra lateral do admin. */
  getUnreadCount: async (): Promise<number> => {
    const snapshot = await getCountFromServer(
      query(collection(db, COLLECTION_NAME), where("read", "==", false)),
    );
    return snapshot.data().count;
  },
};
