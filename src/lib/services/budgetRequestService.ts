import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions as fbFunctions } from "@/lib/firebase/client";
import { BudgetRequest } from "@/lib/types";

const COLLECTION_NAME = "budget_requests";

const fromDoc = (id: string, data: Record<string, unknown>): BudgetRequest =>
  ({
    id,
    ...data,
    createdAt: (data.createdAt as Timestamp)?.toDate() ?? new Date(),
    decidedAt: (data.decidedAt as Timestamp)?.toDate(),
  }) as BudgetRequest;

const newestFirst = (a: BudgetRequest, b: BudgetRequest) =>
  b.createdAt.getTime() - a.createdAt.getTime();

export const budgetRequestService = {
  async create(input: {
    companyId: string;
    costCenterId: string;
    year: number;
    amount: number;
    reason: string;
    requestedBy: string;
    requestedByName: string;
  }) {
    return addDoc(collection(db, COLLECTION_NAME), {
      ...input,
      reason: input.reason.trim(),
      status: "pending",
      createdAt: serverTimestamp(),
    });
  },

  // Só igualdades: o Firestore resolve sem índice composto. A ordem fica no
  // cliente porque a lista é curta (pedidos abertos de uma empresa).
  async getPending(companyId: string): Promise<BudgetRequest[]> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
        where("status", "==", "pending"),
      ),
    );
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort(newestFirst);
  },

  async getByCostCenter(
    companyId: string,
    costCenterId: string,
  ): Promise<BudgetRequest[]> {
    const snap = await getDocs(
      query(
        collection(db, COLLECTION_NAME),
        where("companyId", "==", companyId),
        where("costCenterId", "==", costCenterId),
      ),
    );
    return snap.docs.map((d) => fromDoc(d.id, d.data())).sort(newestFirst);
  },

  /** Aprovar soma o valor ao envelope, tirando do pai; o servidor valida. */
  async decide(requestId: string, approve: boolean, note?: string) {
    const call = httpsCallable<
      { requestId: string; approve: boolean; note?: string },
      { success: boolean }
    >(fbFunctions, "decideBudgetRequest");
    await call({ requestId, approve, note });
  },
};
