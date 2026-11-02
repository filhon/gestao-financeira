import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Entity, ExpenseSubmission, ReimbursementLink } from "@/lib/types";

const SUBMISSIONS = "expense_submissions";
const LINKS = "reimbursement_links";

const toDate = (v: unknown) => (v as Timestamp | null)?.toDate?.() ?? null;

const convert = (id: string, d: DocumentData): ExpenseSubmission =>
  ({
    ...d,
    id,
    date: toDate(d.date),
    createdAt: toDate(d.createdAt) ?? new Date(),
    decidedAt: toDate(d.decidedAt) ?? undefined,
  }) as ExpenseSubmission;

const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const linkUrl = (token: string) =>
  `${window.location.origin}/enviar-despesa/${token}`;

export const expenseSubmissionService = {
  /** Notas que esperam o financeiro lançar ou recusar. */
  getPending: async (companyId: string): Promise<ExpenseSubmission[]> => {
    const snap = await getDocs(
      query(
        collection(db, SUBMISSIONS),
        where("companyId", "==", companyId),
        where("status", "==", "pending"),
      ),
    );
    return snap.docs
      .map((d) => convert(d.id, d.data()))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  },

  getLinks: async (companyId: string): Promise<ReimbursementLink[]> => {
    const snap = await getDocs(
      query(collection(db, LINKS), where("companyId", "==", companyId)),
    );
    return snap.docs.map(
      (d) =>
        ({
          ...d.data(),
          id: d.id,
          createdAt: toDate(d.get("createdAt")) ?? new Date(),
        }) as ReimbursementLink,
    );
  },

  /**
   * Um link por funcionário: gerar de novo revoga o anterior. O token tem
   * 256 bits e o documento é guardado sob o hash dele.
   */
  createLink: async (
    companyId: string,
    employee: Entity,
    userId: string,
    existing: ReimbursementLink[],
  ): Promise<string> => {
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    await setDoc(doc(db, LINKS, await sha256(token)), {
      companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      token,
      createdBy: userId,
      createdAt: serverTimestamp(),
    });
    await Promise.all(
      existing
        .filter((l) => l.employeeId === employee.id)
        .map((l) => deleteDoc(doc(db, LINKS, l.id))),
    );
    return token;
  },

  revokeLink: (linkId: string) => deleteDoc(doc(db, LINKS, linkId)),

  markLaunched: (id: string, transactionId: string, userId: string) =>
    updateDoc(doc(db, SUBMISSIONS, id), {
      status: "launched",
      transactionId,
      decidedBy: userId,
      decidedAt: serverTimestamp(),
    }),

  refuse: (id: string, reason: string, userId: string) =>
    updateDoc(doc(db, SUBMISSIONS, id), {
      status: "refused",
      refusedReason: reason,
      decidedBy: userId,
      decidedAt: serverTimestamp(),
    }),
};
