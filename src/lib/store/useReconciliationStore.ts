import { create } from "zustand";
import { BankTransaction } from "@/lib/types";

interface ReconciliationState {
  transactions: BankTransaction[];
  isLoading: boolean;

  // Actions
  setTransactions: (transactions: BankTransaction[]) => void;
  updateTransactionStatus: (
    id: string,
    status: BankTransaction["status"],
    matchedId?: string,
  ) => void;
  clearSession: () => void;
}

export const useReconciliationStore = create<ReconciliationState>((set) => ({
  transactions: [],
  isLoading: false,

  setTransactions: (transactions) => set({ transactions }),

  updateTransactionStatus: (id, status, matchedId) =>
    set((state) => ({
      transactions: state.transactions.map((t) =>
        t.id === id ? { ...t, status, matchedTransactionId: matchedId } : t,
      ),
    })),

  clearSession: () => set({ transactions: [] }),
}));
