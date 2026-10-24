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
  doc,
  getDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import currency from "currency.js";
import {
  CostCenter,
  CostCenterBalance,
  Transaction,
  UserRole,
} from "@/lib/types";
import { costCenterLedgerService } from "./costCenterLedgerService";
import { transactionService } from "./transactionService";
import {
  queueStatuses,
  tabFilter,
  type TabContext,
  type TabFilter,
} from "@/lib/transactionTabs";
import {
  startOfMonth,
  endOfMonth,
  format,
  addDays,
  startOfDay,
  endOfDay,
  startOfYear,
  endOfYear,
  subYears,
  isBefore,
  isAfter,
  isSameDay,
  addWeeks,
  addMonths,
  addYears,
} from "date-fns";
import { recurrenceService } from "./recurrenceService";
import {
  envelopePace,
  envelopeRank,
  envelopeStatus,
  nextBusinessDay,
  type EnvelopeStatus,
} from "@/lib/dashboardRules";

const TRANSACTIONS_COLLECTION = "transactions";
const COST_CENTERS_COLLECTION = "cost_centers";
const COMPANY_STATS_COLLECTION = "company_stats";

/** Tudo que ainda espera pagamento. Mesma regra das listas (CLOSED_STATUSES). */
const OPEN_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "pending_authorization",
  "authorized",
];

export interface DashboardMetrics {
  /** Recebido no exercício (data efetiva = paymentDate). */
  totalRevenue: number;
  /** Pago no exercício (data efetiva = paymentDate). */
  totalExpenses: number;
  /** Resultado de caixa do exercício: recebido − pago. Não é saldo bancário. */
  result: number;
  /** Mesmos totais no período de comparação (ano anterior). */
  previousRevenue: number;
  previousExpenses: number;
  /** true = comparação até a mesma data do ano anterior; false = ano cheio. */
  comparisonIsPartial: boolean;
  /** Saldo em caixa hoje (company_stats), a mesma base do fluxo projetado. */
  cashBalance: number;
  hasCompanyStats: boolean;
  pendingPayables: number;
  pendingReceivables: number;
  /** Recebíveis pendentes com vencimento nos próximos 30 dias */
  shortTermReceivables: number;
  /** Pagamentos pendentes com vencimento nos próximos 30 dias */
  shortTermPayables: number;
  year: number;
}

export interface ProjectedCashFlowData {
  /** Rótulo do eixo (dd/MM). */
  date: string;
  /** Início do balde (yyyy-MM-dd): diário no modo 30 dias, semanal no ano. */
  isoDate: string;
  /** Saldo conservador: sem os recebíveis vencidos. */
  balance: number;
  /** Cenário em que os recebíveis vencidos entram hoje. Só de hoje em diante. */
  balanceWithOverdue?: number;
  income: number;
  expense: number;
}

export interface ProjectedCashFlowResult {
  data: ProjectedCashFlowData[];
  hasCompanyStats: boolean;
  /** A receber vencido em aberto: fora de `balance`. */
  overdueIncome: number;
  /** A pagar vencido em aberto: lançado no dia de hoje. */
  overdueExpense: number;
}

export interface CostCenterData {
  name: string;
  value: number;
}

export interface BudgetProgressData {
  id: string;
  name: string;
  /** Comprometido: gasto direto (pago ou não) + distribuído aos filhos. */
  spent: number;
  /** Gasto direto já pago. */
  paid: number;
  paidPercentage: number;
  /** Tudo comprometido já pago e nada disponível: concluído. */
  exhausted: boolean;
  /** A 95% ou mais com exercício pela frente: a próxima despesa é recusada. */
  tight: boolean;
  spentDirect: number;
  allocated: number;
  budget: number;
  available: number;
  percentage: number;
  isLeaf: boolean;
  status: EnvelopeStatus;
}

export interface QueueSection {
  id: string;
  label: string;
  href: string;
  tone: "danger" | "warning" | "neutral";
  count: number;
  total: number;
  /** Agrupar por contraparte (vencidas) ou listar conta a conta. */
  grouped: boolean;
  /** Por vencimento, mais antigos primeiro: até 100 se agrupado, senão 5. */
  items: Transaction[];
}

async function readCompanyBalance(companyId: string) {
  try {
    const snap = await getDoc(doc(db, COMPANY_STATS_COLLECTION, companyId));
    if (snap.exists()) {
      return {
        balance: Number(snap.data().currentBalance) || 0,
        hasCompanyStats: true,
      };
    }
  } catch (error) {
    console.error("Error fetching company stats for balance:", error);
  }
  return { balance: 0, hasCompanyStats: false };
}

/**
 * Recebido e pago em cada janela pela data efetiva (paymentDate), numa leitura
 * só para todas as janelas. A consulta vai por dueDate com folga de ±90 dias
 * para pegar pagamentos antecipados ou atrasados; o corte fino é em memória.
 * ponytail: lê os documentos porque 92% das baixas não têm `finalAmount` e
 * algumas não têm `paymentDate`, o que impede somar no servidor. Preencher
 * esses campos num backfill libera `sum()` por paymentDate.
 */
async function paidTotals(
  companyId: string,
  userId: string | undefined,
  windows: { start: Date; end: Date }[],
) {
  const from = new Date(Math.min(...windows.map((w) => w.start.getTime())));
  const to = new Date(Math.max(...windows.map((w) => w.end.getTime())));
  let q = query(
    collection(db, TRANSACTIONS_COLLECTION),
    where("companyId", "==", companyId),
    where("status", "==", "paid"),
    where("dueDate", ">=", Timestamp.fromDate(addDays(from, -90))),
    where("dueDate", "<=", Timestamp.fromDate(addDays(to, 90))),
  );
  if (userId) q = query(q, where("createdBy", "==", userId));

  const snapshot = await getDocs(q);
  const totals = windows.map(() => ({
    revenue: currency(0),
    expenses: currency(0),
  }));
  snapshot.docs.forEach((d) => {
    const data = d.data();
    const effDate: Date = data.paymentDate
      ? (data.paymentDate as Timestamp).toDate()
      : (data.dueDate as Timestamp).toDate();
    // finalAmount é o valor efetivamente pago (com juros/desconto)
    const amount = Number(data.finalAmount ?? data.amount) || 0;
    windows.forEach((w, i) => {
      if (effDate < w.start || effDate > w.end) return;
      if (data.type === "receivable")
        totals[i].revenue = totals[i].revenue.add(amount);
      else if (data.type === "payable")
        totals[i].expenses = totals[i].expenses.add(amount);
    });
  });
  return totals.map((t) => ({
    revenue: t.revenue.value,
    expenses: t.expenses.value,
  }));
}

export const dashboardService = {
  /**
   * O que espera ação hoje, com contagem e total reais (agregados no
   * servidor). Usa os mesmos filtros das abas das listas, então o número do
   * painel bate com o da aba que o link abre.
   */
  getActionQueue: async (
    companyId: string,
    role: UserRole | null,
    /** Papel "user": só as próprias contas a pagar, sem recebíveis. */
    createdBy?: string,
  ): Promise<QueueSection[]> => {
    const today = startOfDay(new Date());
    const ctx = (type: "payable" | "receivable"): TabContext => ({
      type,
      today,
      status: "all",
      queue: [],
      createdBy,
    });

    const defs: Array<
      Omit<QueueSection, "count" | "total" | "items"> & {
        filter: TabFilter | null;
      }
    > = [
      {
        id: "payable-overdue",
        label: "A pagar vencidas",
        href: "/financeiro/contas-pagar?tab=overdue",
        tone: "danger",
        grouped: true,
        filter: tabFilter("overdue", ctx("payable")),
      },
      {
        id: "payable-today",
        label: "A pagar hoje",
        href: "/financeiro/contas-pagar?tab=today",
        tone: "warning",
        grouped: false,
        filter: tabFilter("today", ctx("payable")),
      },
      {
        id: "receivable-overdue",
        label: "A receber em atraso",
        href: "/financeiro/contas-receber?tab=overdue",
        tone: "danger",
        grouped: true,
        filter: createdBy ? null : tabFilter("overdue", ctx("receivable")),
      },
      ...queueStatuses(role).map((status) => ({
        id: status,
        label:
          status === "pending_approval" ? "Para aprovar" : "Para autorizar",
        href: "/financeiro/contas-pagar?tab=queue",
        tone: "neutral" as const,
        grouped: false,
        filter: { type: "payable" as const, status },
      })),
    ];

    const totals = await transactionService.getTabTotals(
      companyId,
      defs.map((d) => d.filter),
    );
    // ponytail: agrupamento usa as 100 vencidas mais antigas; acima disso os
    // grupos são parciais (a tela avisa). Agregar por entityId no servidor se
    // a carteira crescer.
    const items = await Promise.all(
      defs.map((d, i) =>
        d.filter && totals[i].count > 0
          ? transactionService
              .getPaginated(companyId, d.grouped ? 100 : 5, null, d.filter)
              .then((r) => r.transactions)
          : Promise.resolve([]),
      ),
    );

    return defs.map((d, i) => ({
      id: d.id,
      label: d.label,
      href: d.href,
      tone: d.tone,
      grouped: d.grouped,
      count: totals[i].count,
      total: totals[i].total,
      items: items[i],
    }));
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

    const pendingStatuses = OPEN_STATUSES;

    // Exercício corrente compara com o mesmo período do ano anterior; um
    // exercício já encerrado compara com o ano anterior inteiro.
    const comparisonIsPartial = targetYear === todayDate.getFullYear();
    const previousStart = startOfYear(new Date(targetYear - 1, 0, 1));
    const previousEnd = comparisonIsPartial
      ? endOfDay(subYears(todayDate, 1))
      : endOfYear(previousStart);

    const [[current, previous], cash] = await Promise.all([
      paidTotals(companyId, userId, [
        { start: yearStartDate, end: yearEndDate },
        { start: previousStart, end: previousEnd },
      ]),
      readCompanyBalance(companyId),
    ]);
    const totalRevenue = current.revenue;
    const totalExpenses = current.expenses;

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
      result: currency(totalRevenue).subtract(totalExpenses).value,
      previousRevenue: previous.revenue,
      previousExpenses: previous.expenses,
      comparisonIsPartial,
      cashBalance: cash.balance,
      hasCompanyStats: cash.hasCompanyStats,
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

    // Snapshot + delta: o saldo de hoje vem de company_stats, sem varrer o
    // histórico. Os vencidos em aberto (de qualquer ano) são tratados de forma
    // assimétrica, como manda a prudência: a pagar vencido é dívida certa e
    // sai do caixa hoje; a receber vencido pode não entrar nunca, então fica
    // fora do saldo e vira uma série à parte (`balanceWithOverdue`).
    const overdueCtx = (type: "payable" | "receivable"): TabContext => ({
      type,
      today,
      status: "all",
      queue: [],
    });
    const [{ balance: startingBalance, hasCompanyStats }, overdueTotals] =
      await Promise.all([
        readCompanyBalance(companyId),
        transactionService.getTabTotals(companyId, [
          tabFilter("overdue", overdueCtx("receivable")),
          tabFilter("overdue", overdueCtx("payable")),
        ]),
      ]);
    const overdueIncome = overdueTotals[0].total;
    const overdueExpense = overdueTotals[1].total;

    // PERFORMANCE: Pre-group transactions by date key for O(n+m) instead of O(n*m)
    // Data efetiva: paymentDate para pagas; para as abertas, o dia útil em que
    // o dinheiro de fato se move (vencimento no sábado compensa na segunda).
    const dateKeyFormat = mode === "year" ? "yyyy-MM-dd" : "yyyy-MM-dd";
    const txByDateKey = new Map<string, Transaction[]>();
    combinedTransactions.forEach((t) => {
      const effDate =
        t.status === "paid" && t.paymentDate
          ? t.paymentDate
          : t.status === "paid"
            ? t.dueDate
            : nextBusinessDay(t.dueDate);
      const key = format(effDate, dateKeyFormat);
      if (!txByDateKey.has(key)) txByDateKey.set(key, []);
      txByDateKey.get(key)!.push(t);
    });

    const result: ProjectedCashFlowData[] = [];

    // Somas em centavos (currency.js): o saldo acumula centenas de lançamentos.
    let currentBalance = currency(startingBalance);

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
        return t.type === "receivable" ? acc.add(amount) : acc.subtract(amount);
      }, currency(0));

      currentBalance = currency(startingBalance).subtract(netChangeBeforeToday);
    }

    let currentDate = new Date(startDate);

    // Use daily for 30 days, weekly for year view
    const interval = mode === "year" ? 7 : 1;
    let reachedToday = false;

    while (!isAfter(currentDate, endDate)) {
      const nextDate = addDays(currentDate, interval);
      let dayIncome = currency(0);
      let dayExpense = currency(0);

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
            // Aberta com vencimento antes de hoje é vencida: entra hoje pelo
            // total de vencidos, não pelo dia útil deslocado (contaria duas vezes).
            if (t.status !== "paid" && isBefore(t.dueDate, today)) return;

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
              dayIncome = dayIncome.add(amount);
              currentBalance = currentBalance.add(amount);
            } else {
              dayExpense = dayExpense.add(amount);
              currentBalance = currentBalance.subtract(amount);
            }
          });
        }

        if (mode !== "year") break; // For 30days mode, only check the single day
        daysToCheck = addDays(daysToCheck, 1);
      }

      // Balde que contém hoje recebe os vencidos a pagar.
      const holdsToday =
        !isBefore(today, currentDate) && isBefore(today, nextDate);
      if (holdsToday) {
        dayExpense = dayExpense.add(overdueExpense);
        currentBalance = currentBalance.subtract(overdueExpense);
        reachedToday = true;
      }

      result.push({
        date: format(currentDate, "dd/MM"),
        isoDate: format(currentDate, "yyyy-MM-dd"),
        balance: currentBalance.value,
        balanceWithOverdue:
          reachedToday && overdueIncome > 0
            ? currentBalance.add(overdueIncome).value
            : undefined,
        income: dayIncome.value,
        expense: dayExpense.value,
      });

      currentDate = nextDate;
    }

    return { data: result, hasCompanyStats, overdueIncome, overdueExpense };
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

  /**
   * Consumo do envelope anual por centro de custo.
   *
   * A versão anterior media ritmo mensal — orçamento restante dividido pelos
   * meses que faltavam, contra o gasto do mês corrente. Foi trocada porque as
   * duas fontes que ela usava não existem mais como verdade: a coleção
   * `budgets` e o agregado `cost_center_usage`, cuja soma mensal nem sequer
   * fecha com o razão (ele data a despesa por `paymentDate` mesmo quando ela
   * não está paga). O razão só guarda o exercício, não o mês, então a leitura
   * passou a ser a do envelope: quanto de cada centro já foi comprometido.
   *
   * `spent` inclui o que o centro distribuiu aos filhos, porque no modelo de
   * envelope distribuir também esvazia o bolso de quem distribuiu.
   */
  getBudgetProgressByCostCenter: async (
    companyId: string,
    year?: number,
  ): Promise<BudgetProgressData[]> => {
    const currentYear = year || new Date().getFullYear();

    const ccQuery = query(
      collection(db, COST_CENTERS_COLLECTION),
      where("companyId", "==", companyId),
    );
    const ccSnapshot = await getDocs(ccQuery);
    const costCenters = ccSnapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as CostCenter,
    );

    if (costCenters.length === 0) return [];

    let balances: Record<string, CostCenterBalance>;
    try {
      balances = await costCenterLedgerService.getBalances(
        companyId,
        costCenters,
        currentYear,
      );
    } catch (error) {
      // Hierarquia inválida (mais de um raiz): sem saldo confiável, a tela
      // mostra o erro em vez de um número errado ou um falso "nenhum centro".
      console.error("Error loading cost center balances:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Não foi possível calcular os envelopes.",
      );
    }

    const pace = envelopePace(currentYear);

    const result: BudgetProgressData[] = costCenters.map((cc) => {
      const b = balances[cc.id];
      const envelope = b ? currency(b.received).add(b.carryIn).value : 0;
      const committed = b
        ? currency(b.allocatedToChildren).add(b.spentDirect).value
        : 0;
      const isLeaf = b?.isLeaf ?? true;
      const paid = b?.spentDirectPaid ?? 0;
      const { percentage, paidPercentage, status, exhausted, tight } =
        envelopeStatus(envelope, committed, paid, isLeaf, pace);

      return {
        id: cc.id,
        name: cc.name,
        spent: committed,
        paid,
        paidPercentage,
        exhausted,
        tight,
        spentDirect: b?.spentDirect ?? 0,
        allocated: b?.allocatedToChildren ?? 0,
        budget: envelope,
        available: b?.available ?? 0,
        percentage,
        isLeaf,
        status,
      };
    });

    return result.sort(
      (a, b) =>
        envelopeRank(a) - envelopeRank(b) ||
        b.percentage - a.percentage ||
        b.spent - a.spent,
    );
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
