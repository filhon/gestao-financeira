import { create } from "zustand";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { usageService } from "@/lib/services/usageService";

interface CostCenterState {
  costCenters: CostCenter[];
  usages: Record<string, number>;
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
  usages: {},
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
      const currentYear = new Date().getFullYear();
      const [data, usagesData] = await Promise.all([
        costCenterService.getAll(companyId, forUserId),
        usageService.getUsageByCompanyAndYear(companyId, currentYear),
      ]);
      set({
        costCenters: data,
        usages: usagesData,
        isLoading: false,
        lastFetchedAt: now,
      });
    } catch (error) {
      console.error("Failed to fetch cost centers:", error);
      set({ error: "Erro ao buscar centros de custo", isLoading: false });
    }
  },

  invalidateCache: () => {
    set({ lastFetchedAt: null, costCenters: [], usages: {} });
  },
}));
