import { create } from 'zustand';

interface GlobalState {
    isLoading: boolean;
    setLoading: (loading: boolean) => void;
    // Add more global state here
}

export const useGlobalStore = create<GlobalState>((set) => ({
    isLoading: false,
    setLoading: (loading) => set({ isLoading: loading }),
}));
