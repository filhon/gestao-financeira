import { create } from "zustand";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";

interface CostCenterState {
  costCenters: CostCenter[];
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchCostCenters: (
    companyId: string,
    forUserId?: string,
    forceRefresh?: boolean,
  ) => Promise<void>;
  invalidateCache: () => void;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useCostCenterStore = create<CostCenterState>((set, get) => ({
  costCenters: [],
  isLoading: false,
  error: null,
  lastFetchedAt: null,

  fetchCostCenters: async (companyId, forUserId, forceRefresh = false) => {
    const { costCenters, lastFetchedAt } = get();
    const now = Date.now();

    const isCacheValid = lastFetchedAt && now - lastFetchedAt < CACHE_DURATION;

    if (!forceRefresh && isCacheValid && costCenters.length > 0) {
      return; // Use cached data
    }

    set({ isLoading: true, error: null });

    try {
      // Saldo não vem daqui: quem precisa dele lê `costCenterLedgerService`,
      // que é a fonte única do envelope.
      const data = await costCenterService.getAll(companyId, forUserId);
      set({ costCenters: data, isLoading: false, lastFetchedAt: now });
    } catch (error) {
      console.error("Failed to fetch cost centers:", error);
      set({ error: "Erro ao buscar centros de custo", isLoading: false });
    }
  },

  invalidateCache: () => {
    set({ lastFetchedAt: null, costCenters: [] });
  },
}));
