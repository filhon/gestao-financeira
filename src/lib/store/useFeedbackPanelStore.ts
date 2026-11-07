import { create } from "zustand";
import type { FeedbackType } from "@/lib/types";

interface FeedbackPanelState {
  open: boolean;
  /** Tipo pedido por quem abriu; o painel consome e limpa. */
  presetType: FeedbackType | null;
  openPanel: (presetType?: FeedbackType) => void;
  setOpen: (open: boolean) => void;
  clearPreset: () => void;
}

export const useFeedbackPanelStore = create<FeedbackPanelState>((set) => ({
  open: false,
  presetType: null,
  openPanel: (presetType) =>
    set({ open: true, presetType: presetType ?? null }),
  setOpen: (open) => set({ open }),
  clearPreset: () => set({ presetType: null }),
}));
