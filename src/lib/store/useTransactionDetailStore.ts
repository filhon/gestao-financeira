import { create } from "zustand";
import { Transaction } from "@/lib/types";

interface TransactionDetailState {
  transaction: Transaction | null;
  isOpen: boolean;
  openTransaction: (transaction: Transaction) => void;
  close: () => void;
}

export const useTransactionDetailStore = create<TransactionDetailState>(
  (set) => ({
    transaction: null,
    isOpen: false,
    openTransaction: (transaction) => set({ transaction, isOpen: true }),
    close: () => set({ isOpen: false }),
  }),
);
