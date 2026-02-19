import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { BankTransaction, Transaction } from "@/lib/types";

interface ReconciliationState {
  transactions: BankTransaction[];
  isLoading: boolean;

  // Actions
  setTransactions: (transactions: BankTransaction[]) => void;
  updateTransactionStatus: (
    id: string,
    status: BankTransaction["status"],
    updates?: Partial<BankTransaction>,
  ) => void;
  clearSession: () => void;
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

const reviveBankTx = (tx: BankTransaction): BankTransaction => ({
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

const safeStorage = createJSONStorage(() => {
  if (typeof window !== "undefined") return localStorage;
  return {
    length: 0,
    clear: () => undefined,
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as Storage;
});

export const useReconciliationStore = create<ReconciliationState>()(
  persist(
    (set) => ({
      transactions: [],
      isLoading: false,

      setTransactions: (transactions) =>
        set({ transactions: transactions.map(reviveBankTx) }),

      updateTransactionStatus: (id, status, updates) =>
        set((state) => ({
          transactions: state.transactions.map((t) =>
            t.id === id ? { ...t, status, ...updates } : t,
          ),
        })),

      clearSession: () => set({ transactions: [] }),
    }),
    {
      name: "reconciliation-session",
      storage: safeStorage,
      partialize: (state) => ({ transactions: state.transactions }),
      onRehydrateStorage: () => (state) => {
        if (state?.transactions) {
          state.transactions = state.transactions.map(reviveBankTx);
        }
      },
    },
  ),
);
