import { db, functions } from "@/lib/firebase/client";
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
  doc,
  getDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Transaction } from "@/lib/types";
import {
  startOfMonth,
  endOfMonth,
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
import { recurrenceService } from "./recurrenceService";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";
const BUDGETS_COLLECTION = "budgets";
const COMPANY_STATS_COLLECTION = "company_stats";

export interface DashboardMetrics {
  totalRevenue: number;
  totalExpenses: number;
  balance: number;
  pendingPayables: number;
  pendingReceivables: number;
  /** Recebíveis pendentes com vencimento nos próximos 30 dias */
  shortTermReceivables: number;
  /** Pagamentos pendentes com vencimento nos próximos 30 dias */
  shortTermPayables: number;
  year: number;
}

export interface ProjectedCashFlowData {
  date: string;
  balance: number;
  income: number;
  expense: number;
}

export interface ProjectedCashFlowResult {
  data: ProjectedCashFlowData[];
  hasCompanyStats: boolean;
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
  getOverdueTransactions: async (
    companyId: string,
    userId?: string,
  ): Promise<Transaction[]> => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("type", "==", "payable"),
      where("status", "not-in", ["paid", "rejected"]),
      where("dueDate", "<", Timestamp.fromDate(today)),
      orderBy("dueDate", "asc"),
      limit(5),
    );

    if (userId) {
      q = query(q, where("createdBy", "==", userId));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        dueDate: (data.dueDate as Timestamp).toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      } as Transaction;
    });
  },

  getPendingApprovals: async (
    companyId: string,
    userId?: string,
  ): Promise<Transaction[]> => {
    let q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("status", "==", "pending_approval"),
      orderBy("dueDate", "asc"),
      limit(5),
    );

    if (userId) {
      q = query(q, where("createdBy", "==", userId));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        dueDate: (data.dueDate as Timestamp).toDate(),
        paymentDate: (data.paymentDate as Timestamp)?.toDate(),
      } as Transaction;
    });
  },

  getFinancialMetrics: async (
    companyId: string,
    userId?: string,
    year?: number,
  ): Promise<DashboardMetrics> => {
    const targetYear = year || new Date().getFullYear();
    const yearStartDate = startOfYear(new Date(targetYear, 0, 1));
    const yearEndDate = endOfYear(new Date(targetYear, 0, 1));

    // Short-term window: today → +30 days (always based on real today)
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const in30Days = addDays(todayDate, 30);
    const shortTermStart = Timestamp.fromDate(todayDate);
    const shortTermEnd = Timestamp.fromDate(in30Days);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyUserFilter = (q: any) =>
      userId ? query(q, where("createdBy", "==", userId)) : q;

    const pendingStatuses = ["draft", "pending_approval", "approved"];

    // --- Paid totals: use paymentDate as effective date ---
    // Expand dueDate query window ±90 days to capture early/late payments,
    // then filter in memory by effectiveDate (paymentDate if paid, else dueDate).
    const paidQueryStart = Timestamp.fromDate(addDays(yearStartDate, -90));
    const paidQueryEnd = Timestamp.fromDate(addDays(yearEndDate, 90));

    let paidQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("status", "==", "paid"),
      where("dueDate", ">=", paidQueryStart),
      where("dueDate", "<=", paidQueryEnd),
    );
    if (userId) paidQuery = query(paidQuery, where("createdBy", "==", userId));

    const paidSnapshot = await getDocs(paidQuery);
    let totalRevenue = 0;
    let totalExpenses = 0;

    paidSnapshot.docs.forEach((d) => {
      const data = d.data();
      // Use paymentDate as effective date for paid transactions
      const effDate: Date = data.paymentDate
        ? (data.paymentDate as Timestamp).toDate()
        : (data.dueDate as Timestamp).toDate();
      if (effDate < yearStartDate || effDate > yearEndDate) return;
      // Prefer finalAmount (actual amount paid) over amount
      const amount = Number(data.finalAmount ?? data.amount) || 0;
      if (data.type === "receivable") totalRevenue += amount;
      else if (data.type === "payable") totalExpenses += amount;
    });

    // --- Pending totals: dueDate is correct (no paymentDate yet) ---
    const pendingBaseQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("dueDate", ">=", Timestamp.fromDate(yearStartDate)),
      where("dueDate", "<=", Timestamp.fromDate(yearEndDate)),
    );
    const shortTermBaseQuery = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("dueDate", ">=", shortTermStart),
      where("dueDate", "<=", shortTermEnd),
    );

    let pendingPayables = 0;
    let pendingReceivables = 0;
    let shortTermPayables = 0;
    let shortTermReceivables = 0;

    try {
      const pendingReceivablesQuery = applyUserFilter(
        query(
          pendingBaseQuery,
          where("status", "in", pendingStatuses),
          where("type", "==", "receivable"),
        ),
      );
      const pendingPayablesQuery = applyUserFilter(
        query(
          pendingBaseQuery,
          where("status", "in", pendingStatuses),
          where("type", "==", "payable"),
        ),
      );
      const shortTermRecQuery = applyUserFilter(
        query(
          shortTermBaseQuery,
          where("status", "in", pendingStatuses),
          where("type", "==", "receivable"),
        ),
      );
      const shortTermPayQuery = applyUserFilter(
        query(
          shortTermBaseQuery,
          where("status", "in", pendingStatuses),
          where("type", "==", "payable"),
        ),
      );

      const [pendingRecSnap, pendingPaySnap, stRecSnap, stPaySnap] =
        await Promise.all([
          getAggregateFromServer(pendingReceivablesQuery, {
            total: sum("amount"),
          }),
          getAggregateFromServer(pendingPayablesQuery, {
            total: sum("amount"),
          }),
          getAggregateFromServer(shortTermRecQuery, { total: sum("amount") }),
          getAggregateFromServer(shortTermPayQuery, { total: sum("amount") }),
        ]);

      pendingPayables = pendingPaySnap.data().total || 0;
      pendingReceivables = pendingRecSnap.data().total || 0;
      shortTermReceivables = stRecSnap.data().total || 0;
      shortTermPayables = stPaySnap.data().total || 0;
    } catch {
      // Fallback: indexes may still be building. Use getDocs + client-side sum.
      console.warn(
        "Aggregation query failed (indexes may be building). Using fallback getDocs approach.",
      );

      let fallbackQuery = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where("companyId", "==", companyId),
        where("dueDate", ">=", Timestamp.fromDate(yearStartDate)),
        where("dueDate", "<=", Timestamp.fromDate(yearEndDate)),
        where("status", "in", pendingStatuses),
      );

      if (userId) {
        fallbackQuery = query(fallbackQuery, where("createdBy", "==", userId));
      }

      const snapshot = await getDocs(fallbackQuery);

      snapshot.docs.forEach((d) => {
        const data = d.data();
        const amount = Number(data.amount) || 0;
        const type = data.type as string;
        const dueDate: Date = (data.dueDate as Timestamp).toDate();
        const isShortTerm = dueDate >= todayDate && dueDate <= in30Days;

        if (type === "receivable") {
          pendingReceivables += amount;
          if (isShortTerm) shortTermReceivables += amount;
        } else if (type === "payable") {
          pendingPayables += amount;
          if (isShortTerm) shortTermPayables += amount;
        }
      });
    }

    // --- Recurring templates: project future occurrences not yet created ---
    // nextDueDate is always the next UNGENERATED date, so there is no double-counting
    // risk with actual transactions already in the database.
    const recurringTemplates = await recurrenceService.getTemplates(companyId);
    recurringTemplates
      .filter((t) => t.active)
      .forEach((template) => {
        let nextDate = new Date(template.nextDueDate);
        const interval = template.interval || 1;

        while (
          isBefore(nextDate, yearEndDate) ||
          isSameDay(nextDate, yearEndDate)
        ) {
          if (template.endDate && isAfter(nextDate, template.endDate)) break;

          if (
            isAfter(nextDate, yearStartDate) ||
            isSameDay(nextDate, yearStartDate)
          ) {
            const amount = template.amount;
            if (template.type === "payable") pendingPayables += amount;
            else pendingReceivables += amount;

            const isShortTerm =
              (isAfter(nextDate, todayDate) ||
                isSameDay(nextDate, todayDate)) &&
              (isBefore(nextDate, in30Days) || isSameDay(nextDate, in30Days));
            if (isShortTerm) {
              if (template.type === "payable") shortTermPayables += amount;
              else shortTermReceivables += amount;
            }
          }

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

    return {
      totalRevenue,
      totalExpenses,
      balance: totalRevenue - totalExpenses,
      pendingPayables,
      pendingReceivables,
      shortTermReceivables,
      shortTermPayables,
      year: targetYear,
    };
  },

  // getUpcomingTransactions and getCashFlowData removed (dead code)

  getProjectedCashFlow: async (
    companyId: string,
    mode: "30days" | "year" = "30days",
    year?: number,
  ): Promise<ProjectedCashFlowResult> => {
    const targetYear = year || new Date().getFullYear();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Reference date for year-scoped calculations
    const refDate = new Date(targetYear, 0, 1);

    let startDate: Date;
    let endDate: Date;

    if (mode === "year") {
      startDate = startOfYear(refDate);
      endDate = endOfYear(refDate);
    } else {
      startDate = today;
      endDate = addDays(today, 30);
    }

    // Fetch transactions for the period (FUTURE ONLY)
    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("dueDate", ">=", Timestamp.fromDate(startDate)),
      where("dueDate", "<=", Timestamp.fromDate(endDate)),
      orderBy("dueDate", "asc"),
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

    // PERFORMANCE FIX: Snapshot + Delta approach
    // Instead of aggregating all history, we read the current balance from company_stats
    let startingBalance = 0;
    let hasCompanyStats = false;
    try {
      const statsRef = doc(db, COMPANY_STATS_COLLECTION, companyId);
      const statsSnap = await getDoc(statsRef);
      if (statsSnap.exists()) {
        startingBalance = statsSnap.data().currentBalance || 0;
        hasCompanyStats = true;
      }
    } catch (error) {
      console.error("Error fetching company stats for balance:", error);
    }

    // PERFORMANCE: Pre-group transactions by date key for O(n+m) instead of O(n*m)
    // Use effectiveDate: paymentDate for paid transactions, dueDate otherwise
    const dateKeyFormat = mode === "year" ? "yyyy-MM-dd" : "yyyy-MM-dd";
    const txByDateKey = new Map<string, Transaction[]>();
    combinedTransactions.forEach((t) => {
      const effDate =
        t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
      const key = format(effDate, dateKeyFormat);
      if (!txByDateKey.has(key)) txByDateKey.set(key, []);
      txByDateKey.get(key)!.push(t);
    });

    const result: ProjectedCashFlowData[] = [];

    let currentBalance = startingBalance;

    // RECONSTRUCTION LOGIC
    // If we are showing the full year, we start at Jan 1st.
    // However, 'startingBalance' is the balance at 'Today'.
    // To find the balance at Jan 1st, we must subtract all net changes that occurred between Jan 1st and Today.
    if (mode === "year") {
      const pastTransactions = combinedTransactions.filter((t) => {
        const effDate =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        return t.status === "paid" && isBefore(effDate, today);
      });

      const netChangeBeforeToday = pastTransactions.reduce((acc, t) => {
        const amount = Number(t.finalAmount ?? t.amount) || 0;
        if (t.type === "receivable") {
          return acc + amount;
        } else {
          return acc - amount;
        }
      }, 0);

      currentBalance = startingBalance - netChangeBeforeToday;
    }

    let currentDate = new Date(startDate);

    // Use daily for 30 days, weekly for year view
    const interval = mode === "year" ? 7 : 1;

    while (!isAfter(currentDate, endDate)) {
      const nextDate = addDays(currentDate, interval);
      let dayIncome = 0;
      let dayExpense = 0;

      // Collect transactions for this period using pre-grouped map
      let daysToCheck = new Date(currentDate);
      while (
        isBefore(daysToCheck, nextDate) ||
        (mode !== "year" && isSameDay(daysToCheck, currentDate))
      ) {
        const key = format(daysToCheck, dateKeyFormat);
        const dayTxns = txByDateKey.get(key);
        if (dayTxns) {
          dayTxns.forEach((t) => {
            // Days strictly before today only occur in 'year' mode. Only PAID
            // transactions actually affected the real balance on those days —
            // overdue/unpaid ones were never realized, so including them here
            // would permanently skew today's and every future balance.
            if (isBefore(daysToCheck, today) && t.status !== "paid") return;

            // '30days' mode starts 'currentBalance' from the live
            // company_stats balance, which already reflects everything paid
            // up to and including today. Skip those paid transactions here
            // so they aren't subtracted/added a second time. ('year' mode
            // doesn't need this — its starting balance excludes today via
            // netChangeBeforeToday above, so today's paid transactions must
            // flow through this loop exactly once.) Compare by calendar day
            // (not exact time) since paymentDate carries a real time-of-day
            // while 'today' is normalized to midnight.
            if (mode === "30days" && t.status === "paid") {
              const effDate =
                t.status === "paid" && t.paymentDate
                  ? t.paymentDate
                  : t.dueDate;
              if (isBefore(effDate, addDays(today, 1))) return;
            }

            const amount = Number(t.finalAmount ?? t.amount) || 0;
            if (t.type === "receivable") {
              dayIncome += amount;
              currentBalance += amount;
            } else {
              dayExpense += amount;
              currentBalance -= amount;
            }
          });
        }

        if (mode !== "year") break; // For 30days mode, only check the single day
        daysToCheck = addDays(daysToCheck, 1);
      }

      result.push({
        date: format(currentDate, "dd/MM"),
        balance: Math.round(currentBalance * 100) / 100,
        income: Math.round(dayIncome * 100) / 100,
        expense: Math.round(dayExpense * 100) / 100,
      });

      currentDate = nextDate;
    }

    return { data: result, hasCompanyStats };
  },

  getExpensesByCostCenter: async (
    companyId: string,
  ): Promise<CostCenterData[]> => {
    // Get transactions for current month using effectiveDate (paymentDate if paid, else dueDate).
    // Expand query window by ±31 days so early/late payments are captured, then filter in memory.
    const start = startOfMonth(new Date());
    const end = endOfMonth(new Date());
    const queryStart = addDays(start, -31);
    const queryEnd = addDays(end, 31);

    const q = query(
      collection(db, TRANSACTIONS_COLLECTION),
      where("companyId", "==", companyId),
      where("type", "==", "payable"),
      where("dueDate", ">=", Timestamp.fromDate(queryStart)),
      where("dueDate", "<=", Timestamp.fromDate(queryEnd)),
    );

    const snapshot = await getDocs(q);
    // Apply effectiveDate filter in memory
    const transactions = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          ...data,
          paymentDate: (data.paymentDate as Timestamp)?.toDate(),
          dueDate: (data.dueDate as Timestamp).toDate(),
        } as Transaction;
      })
      .filter((t) => {
        const effDate =
          t.status === "paid" && t.paymentDate ? t.paymentDate : t.dueDate;
        return effDate >= start && effDate <= end;
      });

    // Get Cost Centers to map names
    const ccQuery = query(
      collection(db, COST_CENTERS_COLLECTION),
      where("companyId", "==", companyId),
    );
    const ccSnapshot = await getDocs(ccQuery);
    const costCenters = new Map(
      ccSnapshot.docs.map((doc) => [doc.id, doc.data().name]),
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
    companyId: string,
    year?: number,
  ): Promise<BudgetProgressData[]> => {
    const now = new Date();
    const currentYear = year || now.getFullYear();
    // For past/future years, use December as reference so full year is considered;
    // for the current year, use the actual current month.
    const isCurrentYear = currentYear === now.getFullYear();
    const currentMonth = isCurrentYear ? now.getMonth() : 11; // 0-indexed
    const remainingMonths = 12 - currentMonth; // Includes current month

    // Get all cost centers for the company
    const ccQuery = query(
      collection(db, COST_CENTERS_COLLECTION),
      where("companyId", "==", companyId),
    );
    const ccSnapshot = await getDocs(ccQuery);
    const costCenters = ccSnapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name as string,
    }));

    // Get all budgets for current year (annual amounts)
    // Budget docs don't store companyId — security is ensured by scoping
    // to costCenterIds already filtered by companyId above.
    const annualBudgets = new Map<string, number>();
    const ccIds = costCenters.map((cc) => cc.id);

    // Firestore 'in' supports max 30 values, batch if needed
    const batches: string[][] = [];
    for (let i = 0; i < ccIds.length; i += 30) {
      batches.push(ccIds.slice(i, i + 30));
    }

    await Promise.all(
      batches.map(async (batch) => {
        const budgetQuery = query(
          collection(db, BUDGETS_COLLECTION),
          where("year", "==", currentYear),
          where("costCenterId", "in", batch),
        );
        const budgetSnapshot = await getDocs(budgetQuery);
        budgetSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          annualBudgets.set(data.costCenterId, data.amount);
        });
      }),
    );

    // Reference month key for the target year
    const refNow = isCurrentYear ? now : new Date(currentYear, 11, 1);
    const currentMonthKey = format(refNow, "yyyy-MM");
    const ytdStartKey = `${currentYear}-01`;

    const ytdExpensesByCC = new Map<string, number>();
    const currentMonthExpensesByCC = new Map<string, number>();

    // cost_center_usage has at most N_CCs × 12 docs per year (1 doc per CC per month).
    // A single getDocs scoped by companyId + monthKey range is efficient and requires
    // no extra composite indexes. getAggregateFromServer would need indexes for
    // (companyId, costCenterId, monthKey) that don't exist.
    const usageQuery = query(
      collection(db, "cost_center_usage"),
      where("companyId", "==", companyId),
      where("monthKey", ">=", ytdStartKey),
      where("monthKey", "<=", `${currentYear}-12`),
    );
    const usageSnapshot = await getDocs(usageQuery);

    usageSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const ccId = data.costCenterId as string;
      const amount = (data.amount as number) || 0;
      const monthKey = data.monthKey as string;

      if (monthKey < currentMonthKey) {
        ytdExpensesByCC.set(ccId, (ytdExpensesByCC.get(ccId) || 0) + amount);
      } else if (monthKey === currentMonthKey) {
        currentMonthExpensesByCC.set(
          ccId,
          (currentMonthExpensesByCC.get(ccId) || 0) + amount,
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

  recalculateBalance: async (companyId: string) => {
    const recalibrate = httpsCallable(functions, "recalculateCompanyBalance");
    const result = await recalibrate({ companyId });
    return result.data as {
      success: boolean;
      newBalance: number;
      transactionCount: number;
    };
  },
};
