import { create } from "zustand";
import { Transaction } from "@/lib/types";

interface TransactionDetailState {
  transaction: Transaction | null;
  isOpen: boolean;
  /** Abre à esquerda de outro painel lateral, sem cobrir a coluna de decisão. */
  beside: boolean;
  openTransaction: (
    transaction: Transaction,
    options?: { beside?: boolean },
  ) => void;
  close: () => void;
}

export const useTransactionDetailStore = create<TransactionDetailState>(
  (set) => ({
    transaction: null,
    isOpen: false,
    beside: false,
    openTransaction: (transaction, options) =>
      set({ transaction, isOpen: true, beside: options?.beside === true }),
    close: () => set({ isOpen: false }),
  }),
);
