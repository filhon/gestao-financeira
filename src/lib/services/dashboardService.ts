import { db } from "@/lib/firebase/client";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  Timestamp,
  getAggregateFromServer,
  sum,
  limit,
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
  addWeeks,
  addMonths,
  addYears,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { recurrenceService } from "./recurrenceService";

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
    // Optimization: Use Firestore Aggregation Queries to avoid fetching all documents.
    // This reduces reads from N (thousands) to 4 (one per query).

    const baseQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId)
    );

    // Helper to apply user filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyUserFilter = (q: any) =>
      userId ? query(q, where("createdBy", "==", userId)) : q;

    // 1. Total Revenue (Paid Receivables)
    // Note: Using 'amount' as per original code. If 'finalAmount' is needed,
    // we would need a separate field or ensure finalAmount is always populated.
    const revenueQuery = applyUserFilter(
      query(
        baseQuery,
        where("status", "==", "paid"),
        where("type", "==", "receivable")
      )
    );

    // 2. Total Expenses (Paid Payables)
    const expensesQuery = applyUserFilter(
      query(
        baseQuery,
        where("status", "==", "paid"),
        where("type", "==", "payable")
      )
    );

    // 3. Pending Receivables (Not Paid, Not Rejected)
    const pendingStatuses = ["draft", "pending_approval", "approved"];
    const pendingReceivablesQuery = applyUserFilter(
      query(
        baseQuery,
        where("status", "in", pendingStatuses),
        where("type", "==", "receivable")
      )
    );

    // 4. Pending Payables
    const pendingPayablesQuery = applyUserFilter(
      query(
        baseQuery,
        where("status", "in", pendingStatuses),
        where("type", "==", "payable")
      )
    );

    const [revenueSnap, expensesSnap, pendingRecSnap, pendingPaySnap] =
      await Promise.all([
        getAggregateFromServer(revenueQuery, { total: sum("amount") }),
        getAggregateFromServer(expensesQuery, { total: sum("amount") }),
        getAggregateFromServer(pendingReceivablesQuery, {
          total: sum("amount"),
        }),
        getAggregateFromServer(pendingPayablesQuery, { total: sum("amount") }),
      ]);

    const totalRevenue = revenueSnap.data().total || 0;
    const totalExpenses = expensesSnap.data().total || 0;
    const pendingReceivables = pendingRecSnap.data().total || 0;
    const pendingPayables = pendingPaySnap.data().total || 0;

    return {
      totalRevenue,
      totalExpenses,
      balance: totalRevenue - totalExpenses,
      pendingPayables,
      pendingReceivables,
    };
  },

  getUpcomingTransactions: async (
    companyId: string,
    userId?: string
  ): Promise<Transaction[]> => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("dueDate", ">=", Timestamp.fromDate(today)),
      where("status", "not-in", ["paid", "rejected"]),
      orderBy("dueDate", "asc"),
      limit(10)
    );

    if (userId) {
      q = query(q, where("createdBy", "==", userId));
    }

    const snapshot = await getDocs(q);
    const realTransactions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        dueDate: (data.dueDate as Timestamp).toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      } as Transaction;
    });

    // Fetch active recurring templates
    const recurringTemplates = await recurrenceService.getTemplates(companyId);
    const activeTemplates = recurringTemplates.filter((t) => t.active);

    const projectedTransactions: Transaction[] = [];

    // We only care about the *next* occurrence for the "Upcoming" list
    activeTemplates.forEach((template) => {
      if (
        isAfter(template.nextDueDate, today) ||
        isSameDay(template.nextDueDate, today)
      ) {
        // Check if expired
        if (template.endDate && isAfter(template.nextDueDate, template.endDate))
          return;

        projectedTransactions.push({
          id: `projected-${template.id}`,
          companyId: template.companyId,
          description: `${template.description} (Recorrência)`,
          amount: template.amount,
          type: template.type,
          status: "draft",
          dueDate: template.nextDueDate,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: "system",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any as Transaction);
      }
    });

    // Merge and Sort
    const all = [...realTransactions, ...projectedTransactions];
    all.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    return all.slice(0, 5);
  },

  getCashFlowData: async (
    companyId: string,
    months: number = 6
  ): Promise<CashFlowData[]> => {
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

    // Fetch active recurring templates to project future transactions
    const recurringTemplates = await recurrenceService.getTemplates(companyId);
    const activeTemplates = recurringTemplates.filter((t) => t.active);

    const projectedTransactions: Transaction[] = [];

    activeTemplates.forEach((template) => {
      let nextDate = template.nextDueDate;
      const interval = template.interval || 1;

      // Loop until we pass the projection end date
      while (isBefore(nextDate, endDate) || isSameDay(nextDate, endDate)) {
        // Check if template expires
        if (template.endDate && isAfter(nextDate, template.endDate)) {
          break;
        }

        // Only add if it falls within our projection window
        if (isAfter(nextDate, startDate) || isSameDay(nextDate, startDate)) {
          projectedTransactions.push({
            id: `projected-${template.id}-${nextDate.getTime()}`,
            companyId: template.companyId,
            description: `${template.description} (Projeção)`,
            amount: template.amount,
            type: template.type,
            status: "draft", // Treated as pending for cash flow
            dueDate: nextDate,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: "system",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any as Transaction);
        }

        // Advance date
        switch (template.frequency) {
          case "daily":
            nextDate = addDays(nextDate, interval);
            break;
          case "weekly":
            nextDate = addWeeks(nextDate, interval);
            break;
          case "monthly":
            nextDate = addMonths(nextDate, interval);
            break;
          case "yearly":
            nextDate = addYears(nextDate, interval);
            break;
          default:
            nextDate = addMonths(nextDate, interval);
        }
      }
    });

    const combinedTransactions = [...transactions, ...projectedTransactions];

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
      combinedTransactions.forEach((t) => {
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

    // Optimization: Use Cost Center Usage collection instead of fetching all transactions
    const usageQuery = query(
      collection(db, "cost_center_usage"),
      where("companyId", "==", companyId),
      where("monthKey", ">=", `${currentYear}-01`),
      where("monthKey", "<=", `${currentYear}-12`)
    );
    const usageSnapshot = await getDocs(usageQuery);

    const ytdExpensesByCC = new Map<string, number>();
    const currentMonthExpensesByCC = new Map<string, number>();

    const currentMonthKey = format(now, "yyyy-MM");

    usageSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const ccId = data.costCenterId;
      const amount = data.amount || 0;
      const monthKey = data.monthKey;

      // YTD (before current month)
      if (monthKey < currentMonthKey) {
        const current = ytdExpensesByCC.get(ccId) || 0;
        ytdExpensesByCC.set(ccId, current + amount);
      }

      // Current Month
      if (monthKey === currentMonthKey) {
        const current = currentMonthExpensesByCC.get(ccId) || 0;
        currentMonthExpensesByCC.set(ccId, current + amount);
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
