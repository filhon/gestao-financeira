import { db } from "@/lib/firebase/client";
import { collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
import { Transaction, CostCenter } from "@/lib/types";
import { startOfMonth, endOfMonth, subMonths, format, isSameMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";

export interface DashboardMetrics {
    totalRevenue: number;
    totalExpenses: number;
    balance: number;
    pendingPayables: number;
    pendingReceivables: number;
}

export interface CashFlowData {
    name: string;
    income: number;
    expense: number;
}

export interface CostCenterData {
    name: string;
    value: number;
}

export const dashboardService = {
    getFinancialMetrics: async (companyId: string): Promise<DashboardMetrics> => {
        // Fetch all transactions for the company (we might want to limit this in the future)
        // For accurate totals, we need everything.
        // Optimization: Create aggregation counters in Firestore or use a cloud function.
        // For MVP: Client-side aggregation.

        const q = query(
            collection(db, TRANSACTIONS_COLLECTION),
            where("companyId", "==", companyId)
        );

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs.map(doc => doc.data() as Transaction);

        let totalRevenue = 0;
        let totalExpenses = 0;
        let pendingPayables = 0;
        let pendingReceivables = 0;

        transactions.forEach(t => {
            const amount = Number(t.amount) || 0;

            if (t.status === 'paid') {
                if (t.type === 'receivable') {
                    totalRevenue += amount;
                } else {
                    totalExpenses += amount;
                }
            } else if (t.status !== 'rejected') {
                // Pending (draft, pending_approval, approved)
                if (t.type === 'receivable') {
                    pendingReceivables += amount;
                } else {
                    pendingPayables += amount;
                }
            }
        });

        return {
            totalRevenue,
            totalExpenses,
            balance: totalRevenue - totalExpenses,
            pendingPayables,
            pendingReceivables
        };
    },

    getCashFlowData: async (companyId: string, months: number = 6): Promise<CashFlowData[]> => {
        const startDate = startOfMonth(subMonths(new Date(), months - 1));

        const q = query(
            collection(db, TRANSACTIONS_COLLECTION),
            where("companyId", "==", companyId),
            where("dueDate", ">=", Timestamp.fromDate(startDate)),
            orderBy("dueDate", "asc")
        );

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                dueDate: (data.dueDate as Timestamp).toDate()
            } as Transaction;
        });

        // Initialize map with all months
        const monthlyData = new Map<string, CashFlowData>();
        for (let i = 0; i < months; i++) {
            const date = subMonths(new Date(), months - 1 - i);
            const key = format(date, 'yyyy-MM');
            monthlyData.set(key, {
                name: format(date, 'MMM', { locale: ptBR }),
                income: 0,
                expense: 0
            });
        }

        transactions.forEach(t => {
            if (t.status === 'rejected') return;

            const key = format(t.dueDate, 'yyyy-MM');
            const entry = monthlyData.get(key);

            if (entry) {
                if (t.type === 'receivable') {
                    entry.income += Number(t.amount);
                } else {
                    entry.expense += Number(t.amount);
                }
            }
        });

        return Array.from(monthlyData.values());
    },

    getExpensesByCostCenter: async (companyId: string): Promise<CostCenterData[]> => {
        // Get transactions for current month
        const start = startOfMonth(new Date());
        const end = endOfMonth(new Date());

        const q = query(
            collection(db, TRANSACTIONS_COLLECTION),
            where("companyId", "==", companyId),
            where("type", "==", "payable"),
            where("dueDate", ">=", Timestamp.fromDate(start)),
            where("dueDate", "<=", Timestamp.fromDate(end))
        );

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs.map(doc => doc.data() as Transaction);

        // Get Cost Centers to map names
        const ccQuery = query(
            collection(db, COST_CENTERS_COLLECTION),
            where("companyId", "==", companyId)
        );
        const ccSnapshot = await getDocs(ccQuery);
        const costCenters = new Map(ccSnapshot.docs.map(doc => [doc.id, doc.data().name]));

        const expensesByCC = new Map<string, number>();

        transactions.forEach(t => {
            if (t.status === 'rejected') return;

            // Allocation logic
            if (t.costCenterAllocation && t.costCenterAllocation.length > 0) {
                t.costCenterAllocation.forEach(alloc => {
                    const ccName = costCenters.get(alloc.costCenterId) || "Outros";
                    const current = expensesByCC.get(ccName) || 0;
                    expensesByCC.set(ccName, current + (alloc.amount || 0));
                });
            } else if (t.costCenterId) {
                const ccName = costCenters.get(t.costCenterId) || "Outros";
                const current = expensesByCC.get(ccName) || 0;
                expensesByCC.set(ccName, current + Number(t.amount));
            } else {
                const ccName = "Sem Centro de Custo";
                const current = expensesByCC.get(ccName) || 0;
                expensesByCC.set(ccName, current + Number(t.amount));
            }
        });

        return Array.from(expensesByCC.entries())
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value); // Sort by highest expense
    }
};
