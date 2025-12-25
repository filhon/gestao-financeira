import { db } from "@/lib/firebase/client";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { Transaction } from "@/lib/types";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  addDays,
  startOfYear,
  endOfYear,
  isBefore,
  isAfter,
  isSameDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";
const BUDGETS_COLLECTION = "budgets";

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

export interface ProjectedCashFlowData {
  date: string;
  balance: number;
  income: number;
  expense: number;
}

export interface CostCenterData {
  name: string;
  value: number;
}

export interface BudgetProgressData {
  id: string;
  name: string;
  spent: number;
  budget: number;
  percentage: number;
  status: "success" | "warning" | "danger" | "no-budget";
}

export const dashboardService = {
  getFinancialMetrics: async (
    companyId: string,
    userId?: string
  ): Promise<DashboardMetrics> => {
    // Fetch all transactions for the company (we might want to limit this in the future)
    // For accurate totals, we need everything.
    // Optimization: Create aggregation counters in Firestore or use a cloud function.
    // For MVP: Client-side aggregation.
    // For 'user' role, filter by createdBy to match Firestore rules

    let q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId)
    );

    if (userId) {
      q = query(q, where("createdBy", "==", userId));
    }

    const snapshot = await getDocs(q);
    const transactions = snapshot.docs.map((doc) => doc.data() as Transaction);

    let totalRevenue = 0;
    let totalExpenses = 0;
    let pendingPayables = 0;
    let pendingReceivables = 0;

    transactions.forEach((t) => {
      const amount = Number(t.amount) || 0;

      if (t.status === "paid") {
        if (t.type === "receivable") {
          totalRevenue += amount;
        } else {
          totalExpenses += amount;
        }
      } else if (t.status !== "rejected") {
        // Pending (draft, pending_approval, approved)
        if (t.type === "receivable") {
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
      pendingReceivables,
    };
  },

  getCashFlowData: async (
    companyId: string,
    months: number = 6
  ): Promise<CashFlowData[]> => {
    const startDate = startOfMonth(subMonths(new Date(), months - 1));

    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      orderBy("dueDate", "asc")
    );

    const snapshot = await getDocs(q);
    const transactions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        dueDate: (data.dueDate as Timestamp).toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      } as Transaction;
    });

    // Initialize map with all months
    const monthlyData = new Map<string, CashFlowData>();
    for (let i = 0; i < months; i++) {
      const date = subMonths(new Date(), months - 1 - i);
      const key = format(date, "yyyy-MM");
      monthlyData.set(key, {
        name: format(date, "MMM", { locale: ptBR }),
        income: 0,
        expense: 0,
      });
    }

    transactions.forEach((t) => {
      if (t.status === "rejected") return;

      // For paid transactions, use paymentDate; for others use dueDate
      const dateToUse =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const key = format(dateToUse, "yyyy-MM");
      const entry = monthlyData.get(key);

      if (entry) {
        const amountToUse =
          t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;
        if (t.type === "receivable") {
          entry.income += Number(amountToUse);
        } else {
          entry.expense += Number(amountToUse);
        }
      }
    });

    return Array.from(monthlyData.values());
  },

  getProjectedCashFlow: async (
    companyId: string,
    mode: "30days" | "year" = "30days"
  ): Promise<ProjectedCashFlowData[]> => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let startDate: Date;
    let endDate: Date;

    if (mode === "year") {
      startDate = startOfYear(today);
      endDate = endOfYear(today);
    } else {
      startDate = today;
      endDate = addDays(today, 30);
    }

    // Fetch all transactions for the period
    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      orderBy("dueDate", "asc")
    );

    const snapshot = await getDocs(q);
    const allTransactions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        dueDate: (data.dueDate as Timestamp).toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      } as Transaction;
    });

    // Filter out rejected transactions
    const transactions = allTransactions.filter((t) => t.status !== "rejected");

    // Calculate starting balance from all paid transactions before startDate
    // For paid transactions, use paymentDate; for others use dueDate
    let startingBalance = 0;
    transactions.forEach((t) => {
      const dateToCheck =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      if (t.status === "paid" && isBefore(dateToCheck, startDate)) {
        const amount = Number(t.finalAmount || t.amount) || 0;
        if (t.type === "receivable") {
          startingBalance += amount;
        } else {
          startingBalance -= amount;
        }
      }
    });

    // Generate daily or weekly data points
    const result: ProjectedCashFlowData[] = [];
    let currentBalance = startingBalance;
    let currentDate = new Date(startDate);

    // Use daily for 30 days, weekly for year view
    const interval = mode === "year" ? 7 : 1;

    while (!isAfter(currentDate, endDate)) {
      const nextDate = addDays(currentDate, interval);
      let dayIncome = 0;
      let dayExpense = 0;

      // Find transactions for this day/period
      transactions.forEach((t) => {
        // For paid transactions, use paymentDate; for others use dueDate
        const dateToUse =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        const isInPeriod =
          mode === "year"
            ? !isBefore(dateToUse, currentDate) && isBefore(dateToUse, nextDate)
            : isSameDay(dateToUse, currentDate);

        if (isInPeriod) {
          const amount =
            t.status === "paid" && t.finalAmount
              ? Number(t.finalAmount)
              : Number(t.amount) || 0;
          if (t.type === "receivable") {
            dayIncome += amount;
            currentBalance += amount;
          } else {
            dayExpense += amount;
            currentBalance -= amount;
          }
        }
      });

      result.push({
        date: format(currentDate, mode === "year" ? "dd/MM" : "dd/MM"),
        balance: Math.round(currentBalance * 100) / 100,
        income: Math.round(dayIncome * 100) / 100,
        expense: Math.round(dayExpense * 100) / 100,
      });

      currentDate = nextDate;
    }

    return result;
  },

  getExpensesByCostCenter: async (
    companyId: string
  ): Promise<CostCenterData[]> => {
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
    const transactions = snapshot.docs.map((doc) => doc.data() as Transaction);

    // Get Cost Centers to map names
    const ccQuery = query(
      collection(db, COST_CENTERS_COLLECTION),
      where("companyId", "==", companyId)
    );
    const ccSnapshot = await getDocs(ccQuery);
    const costCenters = new Map(
      ccSnapshot.docs.map((doc) => [doc.id, doc.data().name])
    );

    const expensesByCC = new Map<string, number>();

    transactions.forEach((t) => {
      if (t.status === "rejected") return;

      // Allocation logic
      if (t.costCenterAllocation && t.costCenterAllocation.length > 0) {
        t.costCenterAllocation.forEach((alloc) => {
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
  },

  getBudgetProgressByCostCenter: async (
    companyId: string
  ): Promise<BudgetProgressData[]> => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed (0 = January)
    const remainingMonths = 12 - currentMonth; // Includes current month

    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const yearStart = startOfYear(now);

    // Get all cost centers for the company
    const ccQuery = query(
      collection(db, COST_CENTERS_COLLECTION),
      where("companyId", "==", companyId)
    );
    const ccSnapshot = await getDocs(ccQuery);
    const costCenters = ccSnapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name as string,
    }));

    // Get all budgets for current year (annual amounts)
    const budgetQuery = query(
      collection(db, BUDGETS_COLLECTION),
      where("year", "==", currentYear)
    );
    const budgetSnapshot = await getDocs(budgetQuery);
    const annualBudgets = new Map<string, number>();
    budgetSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      annualBudgets.set(data.costCenterId, data.amount);
    });

    // Get ALL transactions for the year to calculate YTD spending
    // We need to fetch all transactions and then filter by paymentDate for paid ones
    const yearTxQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("type", "==", "payable")
    );
    const yearTxSnapshot = await getDocs(yearTxQuery);
    const allYearTransactions = yearTxSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        dueDate: (data.dueDate as Timestamp).toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      } as Transaction;
    });

    // Filter transactions for YTD (before current month)
    // Use paymentDate for paid transactions, dueDate for others
    const yearTransactions = allYearTransactions.filter((t) => {
      if (t.status === "rejected") return false;
      const dateToCheck =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      return dateToCheck >= yearStart && dateToCheck < currentMonthStart;
    });

    // Calculate YTD expenses per cost center (before current month)
    const ytdExpensesByCC = new Map<string, number>();
    yearTransactions.forEach((t) => {
      const amountToUse =
        t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;

      if (t.costCenterAllocation && t.costCenterAllocation.length > 0) {
        t.costCenterAllocation.forEach((alloc) => {
          const current = ytdExpensesByCC.get(alloc.costCenterId) || 0;
          ytdExpensesByCC.set(
            alloc.costCenterId,
            current + (alloc.amount || 0)
          );
        });
      } else if (t.costCenterId) {
        const current = ytdExpensesByCC.get(t.costCenterId) || 0;
        ytdExpensesByCC.set(t.costCenterId, current + Number(amountToUse));
      }
    });

    // Filter transactions for current month
    // Use paymentDate for paid transactions, dueDate for others
    const transactions = allYearTransactions.filter((t) => {
      if (t.status === "rejected") return false;
      const dateToCheck =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      return dateToCheck >= currentMonthStart && dateToCheck <= currentMonthEnd;
    });

    // Calculate current month expenses per cost center
    const currentMonthExpensesByCC = new Map<string, number>();
    transactions.forEach((t) => {
      const amountToUse =
        t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;

      if (t.costCenterAllocation && t.costCenterAllocation.length > 0) {
        t.costCenterAllocation.forEach((alloc) => {
          const current = currentMonthExpensesByCC.get(alloc.costCenterId) || 0;
          currentMonthExpensesByCC.set(
            alloc.costCenterId,
            current + (alloc.amount || 0)
          );
        });
      } else if (t.costCenterId) {
        const current = currentMonthExpensesByCC.get(t.costCenterId) || 0;
        currentMonthExpensesByCC.set(
          t.costCenterId,
          current + Number(amountToUse)
        );
      }
    });

    // Build result array with adjusted monthly budget
    const result: BudgetProgressData[] = costCenters.map((cc) => {
      const annualBudget = annualBudgets.get(cc.id) || 0;
      const ytdSpent = ytdExpensesByCC.get(cc.id) || 0;
      const currentMonthSpent = currentMonthExpensesByCC.get(cc.id) || 0;

      // Calculate adjusted monthly budget
      // Remaining budget = Annual - YTD spent (before current month)
      // Adjusted monthly = Remaining / Remaining months (including current)
      const remainingBudget = Math.max(0, annualBudget - ytdSpent);
      const adjustedMonthlyBudget =
        remainingMonths > 0 ? remainingBudget / remainingMonths : 0;

      const percentage =
        adjustedMonthlyBudget > 0
          ? Math.round((currentMonthSpent / adjustedMonthlyBudget) * 100)
          : 0;

      let status: BudgetProgressData["status"];
      if (annualBudget === 0) {
        status = "no-budget";
      } else if (percentage >= 100) {
        status = "danger";
      } else if (percentage >= 80) {
        status = "warning";
      } else {
        status = "success";
      }

      return {
        id: cc.id,
        name: cc.name,
        spent: Math.round(currentMonthSpent * 100) / 100,
        budget: Math.round(adjustedMonthlyBudget * 100) / 100,
        percentage,
        status,
      };
    });

    // Sort by percentage (highest first), then by spent amount
    return result.sort((a, b) => {
      if (a.status === "no-budget" && b.status !== "no-budget") return 1;
      if (a.status !== "no-budget" && b.status === "no-budget") return -1;
      if (b.percentage !== a.percentage) return b.percentage - a.percentage;
      return b.spent - a.spent;
    });
  },
};
