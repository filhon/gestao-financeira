import { create } from "zustand";
import { BankTransaction, Transaction } from "@/lib/types";

interface ReconciliationState {
  transactions: BankTransaction[];
  isLoading: boolean;
  /**
   * Etapa de cada linha com ação em andamento. Fora do componente para a trava
   * valer já no clique seguinte e sobreviver à troca de tela.
   */
  lineStages: ReadonlyMap<string, string>;
  setLineStage: (id: string, stage: string | null) => void;

  // Actions
  setTransactions: (transactions: BankTransaction[]) => void;
  updateTransactionStatus: (
    id: string,
    status: BankTransaction["status"],
    updates?: Partial<BankTransaction>,
  ) => void;
  setIsLoading: (loading: boolean) => void;
}

const reviveTransactionDates = (tx: Transaction): Transaction => ({
  ...tx,
  dueDate: tx.dueDate ? new Date(tx.dueDate) : tx.dueDate,
  paymentDate: tx.paymentDate ? new Date(tx.paymentDate) : tx.paymentDate,
  approvedAt: tx.approvedAt ? new Date(tx.approvedAt) : tx.approvedAt,
  releasedAt: tx.releasedAt ? new Date(tx.releasedAt) : tx.releasedAt,
  createdAt: tx.createdAt ? new Date(tx.createdAt) : tx.createdAt,
  updatedAt: tx.updatedAt ? new Date(tx.updatedAt) : tx.updatedAt,
});

export const reviveBankTx = (tx: BankTransaction): BankTransaction => ({
  ...tx,
  date: new Date(tx.date),
  matchedDetails: tx.matchedDetails
    ? reviveTransactionDates(tx.matchedDetails)
    : tx.matchedDetails,
  matchedBundleDetails: tx.matchedBundleDetails
    ? tx.matchedBundleDetails.map(reviveTransactionDates)
    : tx.matchedBundleDetails,
  matchCandidates: tx.matchCandidates
    ? tx.matchCandidates.map((c) => ({
        ...c,
        transaction: reviveTransactionDates(c.transaction),
      }))
    : tx.matchCandidates,
});

export const useReconciliationStore = create<ReconciliationState>((set) => ({
  transactions: [],
  isLoading: false,
  lineStages: new Map(),

  setLineStage: (id, stage) =>
    set((state) => {
      const lineStages = new Map(state.lineStages);
      if (stage === null) lineStages.delete(id);
      else lineStages.set(id, stage);
      return { lineStages };
    }),

  setTransactions: (transactions) =>
    set({ transactions: transactions.map(reviveBankTx), isLoading: false }),

  updateTransactionStatus: (id, status, updates) =>
    set((state) => {
      const newTransactions = state.transactions.map((t) =>
        t.id === id ? { ...t, status, ...updates } : t,
      );
      return { transactions: newTransactions };
    }),

  setIsLoading: (isLoading) => set({ isLoading }),
}));
