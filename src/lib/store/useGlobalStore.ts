import { create } from "zustand";

interface GlobalState {
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  novidadesOpen: boolean;
  setNovidadesOpen: (open: boolean) => void;
  // true nos primeiros dias após a data da última atualização (pill "Novo")
  novidadesNew: boolean;
  setNovidadesNew: (isNew: boolean) => void;
}

export const useGlobalStore = create<GlobalState>((set) => ({
  isLoading: false,
  setLoading: (loading) => set({ isLoading: loading }),
  novidadesOpen: false,
  setNovidadesOpen: (open) => set({ novidadesOpen: open }),
  novidadesNew: false,
  setNovidadesNew: (isNew) => set({ novidadesNew: isNew }),
}));
