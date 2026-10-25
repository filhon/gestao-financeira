"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadStatement } from "@/components/features/finance/reconciliation/UploadStatement";
import {
  ReconciliationTable,
  StatusBadge,
  ReconciliationAction,
  RowActions,
  RowState,
  SystemCell,
  ActionHandler,
  IGNORE_REASONS,
} from "@/components/features/finance/reconciliation/ReconciliationTable";
import {
  QuickLaunchSheet,
  LaunchTemplate,
} from "@/components/features/finance/reconciliation/QuickLaunchSheet";
import { RulesSheet } from "@/components/features/finance/reconciliation/RulesSheet";
import {
  reconciliationRuleService,
  ReconciliationRuleDraft,
} from "@/lib/services/reconciliationRuleService";
import {
  accountRequiredFor,
  useChartOfAccounts,
} from "@/hooks/useChartOfAccounts";
import { BalanceStrip } from "@/components/features/finance/reconciliation/BalanceStrip";
import { AccountStrip } from "@/components/features/finance/reconciliation/AccountStrip";
import {
  SettleFromStatementSheet,
  Settlement,
} from "@/components/features/finance/reconciliation/SettleFromStatementSheet";
import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
import { transactionService } from "@/lib/services/transactionService";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { entityService } from "@/lib/services/entityService";
import { bankAccountService } from "@/lib/services/bankAccountService";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  FileText,
  X,
  Check,
  Plus,
  Search,
  Landmark,
  ListChecks,
  MoreHorizontal,
  MinusCircle,
  History,
  Undo2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { BankTransaction, ReconciliationRule, Transaction } from "@/lib/types";
import { subDays, addDays, format } from "date-fns";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionFormData } from "@/lib/validations/transaction";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency, plural } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";
import {
  applyRules,
  dailyBalances,
  dayKey,
  groupByDay,
  type DayGroup,
  isBalanceLine,
  isBeforeBase,
  isLocked,
  lastClosing,
  lineTransaction,
  rulePattern,
  summarizeAccount,
} from "@/lib/bankReconciliation";

const ACCOUNT_KEY = (companyId: string) =>
  `reconciliation-account-${companyId}`;

// Sugestão é pendente com palpite: fica em Pendentes, marcada pelo badge.
type Tab = "all" | "pending" | "matched" | "ignored";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "pending", label: "Pendentes" },
  { id: "matched", label: "Conciliadas" },
  { id: "ignored", label: "Ignoradas" },
];
const tabOf = (status: BankTransaction["status"]): Tab =>
  status === "unmatched" || status === "potential_match" ? "pending" : status;

function MobileBankTxCard({
  tx,
  state,
  canSettle,
  canLaunch,
  canRule,
  rule,
  onAction,
}: {
  tx: BankTransaction;
  state: RowState;
  canSettle: boolean;
  canLaunch: boolean;
  canRule: boolean;
  rule?: ReconciliationRule;
  onAction: ActionHandler;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-muted-foreground">
          {format(new Date(tx.date), "dd/MM/yyyy")}
        </span>
        <StatusBadge status={tx.status} />
      </div>

      <p className="text-sm font-medium truncate" title={tx.description}>
        {tx.description}
      </p>

      <div
        className={cn(
          "text-sm font-semibold font-financial tabular-nums mt-1",
          tx.amount < 0
            ? "text-red-700 dark:text-red-400"
            : "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {tx.amount < 0 ? "−" : "+"}
        {formatCurrency(Math.abs(tx.amount))}
      </div>

      <div className="mt-2">
        <SystemCell
          tx={tx}
          rule={rule}
          editable={state === "editable"}
          onAction={onAction}
        />
      </div>

      <div className="mt-2.5 flex justify-end">
        <RowActions
          tx={tx}
          state={state}
          canSettle={canSettle}
          canLaunch={canLaunch}
          canRule={canRule}
          onAction={onAction}
        />
      </div>
    </div>
  );
}

export function ReconciliationDashboard() {
  const {
    transactions: allItems,
    isLoading: isStoreLoading,
    setTransactions,
    updateTransactionStatus,
    setIsLoading,
  } = useReconciliationStore();
  const { selectedCompany, isLoading: isCompanyLoading } = useCompany();
  const { user } = useAuth();
  const {
    onlyOwnPayables,
    canViewReconciliation,
    canManageReconciliation,
    canPayPayables,
    canEditReceivables,
    canCreatePayables,
    canCreateReceivables,
    canManageBankAccounts,
    canManageReconciliationRules,
  } = usePermissions();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id;
  const { accounts, isLoading: isAccountsLoading } = useBankAccounts(
    canViewReconciliation ? companyId : undefined,
  );
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.active),
    [accounts],
  );
  const [isMatching, setIsMatching] = useState(false);

  // Sync with Firestore (only for roles allowed to view the bank statement)
  useEffect(() => {
    if (!companyId || !canViewReconciliation) return;

    setIsLoading(true);
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      // Best-effort one-time migration from the legacy single-document
      // session into the per-item subcollection. Only managers can write,
      // so a read-only viewer simply skips it (nothing is lost either way).
      if (canManageReconciliation) {
        try {
          await reconciliationSessionService.migrateLegacySessionIfNeeded(
            companyId,
          );
        } catch (e) {
          console.error("Falha ao migrar sessão legada de conciliação", e);
        }
      }

      if (cancelled) return;
      unsubscribe = reconciliationSessionService.subscribeToSession(
        companyId,
        (txs) => {
          setTransactions(txs);
          setIsLoading(false);
        },
      );
    };

    start();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    companyId,
    canViewReconciliation,
    canManageReconciliation,
    setTransactions,
    setIsLoading,
  ]);

  // ── Conta selecionada ──────────────────────────────────────────────────────
  const [pickedAccountId, setPickedAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) return;
    try {
      setPickedAccountId(localStorage.getItem(ACCOUNT_KEY(companyId)));
    } catch {
      // Sem storage: cai na primeira conta ativa.
    }
  }, [companyId]);
  // Uma prova por conta: alimenta a faixa de contas e a conta da tela.
  const summaries = useMemo(
    () =>
      new Map(activeAccounts.map((a) => [a.id, summarizeAccount(a, allItems)])),
    [activeAccounts, allItems],
  );
  // Mais atrasada primeiro: a que nunca fechou, depois a de fechamento mais antigo.
  const orderedAccounts = useMemo(
    () =>
      [...activeAccounts].sort(
        (a, b) =>
          (lastClosing(a)?.through.getTime() ?? -Infinity) -
            (lastClosing(b)?.through.getTime() ?? -Infinity) ||
          a.name.localeCompare(b.name),
      ),
    [activeAccounts],
  );
  const account =
    activeAccounts.find((a) => a.id === pickedAccountId) ?? orderedAccounts[0];
  const selectAccount = (id: string) => {
    setPickedAccountId(id);
    try {
      if (companyId) localStorage.setItem(ACCOUNT_KEY(companyId), id);
    } catch {
      // Preferência só desta sessão.
    }
  };

  // Linhas importadas antes de existir conta bancária.
  const legacyItems = useMemo(
    () => allItems.filter((t) => !t.bankAccountId),
    [allItems],
  );
  const transactions = useMemo(
    () =>
      account ? allItems.filter((t) => t.bankAccountId === account.id) : [],
    [allItems, account],
  );
  // Linhas de saldo do banco não são movimento: saem da lista e viram a
  // conferência do dia.
  const movementLines = useMemo(
    () => transactions.filter((t) => !isBalanceLine(t)),
    [transactions],
  );
  // Extratos entram um em cima do outro; o que já está no saldo inicial
  // (períodos fechados, dias até a abertura) fica fora da tela por padrão.
  const [showPast, setShowPast] = useState(false);
  const pastCount = account
    ? movementLines.filter((t) => isBeforeBase(t, account)).length
    : 0;
  const lines = useMemo(
    () =>
      showPast || !account
        ? movementLines
        : movementLines.filter((t) => !isBeforeBase(t, account)),
    [movementLines, account, showPast],
  );
  const summary = (account && summaries.get(account.id)) || null;
  const closing = account ? lastClosing(account) : undefined;
  // Fechada e sem extrato novo: o próximo passo é importar.
  const periodDone = !!closing && !!summary && !summary.hasMovement;
  // Para onde o saldo inicial volta ao reabrir: o fechamento anterior ou a abertura.
  const reopenTarget = account
    ? (account.closings?.at(-2) ?? {
        through: account.openingBalanceDate,
        balance: account.openingBalance,
      })
    : null;
  const dayBalances = useMemo(
    () =>
      account
        ? dailyBalances(account, allItems).filter(
            (d) => showPast || !isBeforeBase(d.lines[0], account),
          )
        : [],
    [account, allItems, showPast],
  );
  const lockedFor = (tx: BankTransaction) => isLocked(tx, account);
  const rowStateFor = (tx: BankTransaction): RowState =>
    lockedFor(tx)
      ? "locked"
      : account && isBeforeBase(tx, account)
        ? "before"
        : canManageReconciliation
          ? "editable"
          : "readonly";
  const canSettleFor = (tx: BankTransaction) =>
    canManageReconciliation &&
    (tx.amount < 0 ? canPayPayables : canEditReceivables);
  // Lançar cria título: quem libera pagamento concilia, mas não cria despesa.
  const canLaunchFor = (tx: BankTransaction) =>
    canManageReconciliation &&
    (tx.amount < 0 ? canCreatePayables : canCreateReceivables);

  // ── Regras ─────────────────────────────────────────────────────────────────
  const rulesKey = ["reconciliation-rules", companyId];
  const { data: rules = [] } = useQuery({
    queryKey: rulesKey,
    queryFn: () => reconciliationRuleService.getAll(companyId!),
    enabled: !!companyId && canViewReconciliation,
  });
  const ruleFor = (tx: BankTransaction) =>
    rules.find((r) => r.id === tx.ruleId);

  // Plano de contas: obrigatório a partir do exercício configurado.
  const { accounts: chartAccounts, requiredFrom } =
    useChartOfAccounts(companyId);
  const missingAccount = (tx: BankTransaction, accountId?: string) => {
    const nature = tx.amount < 0 ? "expense" : "revenue";
    return (
      !accountId &&
      accountRequiredFor(requiredFrom, new Date(tx.date)) &&
      chartAccounts.some(
        (a) => a.nature === nature && a.type === "analytic" && !a.archived,
      )
    );
  };

  /** Sugestão que a confirmação em lote consegue resolver sozinha. */
  const confirmableFor = (tx: BankTransaction) => {
    if (tx.status !== "potential_match" || rowStateFor(tx) !== "editable")
      return false;
    if (!tx.ruleId) return true;
    const rule = ruleFor(tx);
    return !!rule && (rule.action === "ignore" || canLaunchFor(tx));
  };
  /** Qualquer linha a tratar entra no lote: confirmar as sugestões, ignorar o resto. */
  const selectableFor = (tx: BankTransaction) =>
    rowStateFor(tx) === "editable" &&
    (tx.status === "unmatched" || tx.status === "potential_match");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = useRef(-1);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Modais e filtros ───────────────────────────────────────────────────────
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedBankTx, setSelectedBankTx] = useState<BankTransaction | null>(
    null,
  );
  const [settlingTx, setSettlingTx] = useState<BankTransaction | null>(null);
  const [launchingTx, setLaunchingTx] = useState<BankTransaction | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<ReconciliationRule | null>(
    null,
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [undoTx, setUndoTx] = useState<BankTransaction | null>(null);

  const clearFilters = () => {
    setTab("all");
    setSearchTerm("");
  };

  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = {
      all: lines.length,
      pending: 0,
      matched: 0,
      ignored: 0,
    };
    for (const tx of lines) counts[tabOf(tx.status)]++;
    return counts;
  }, [lines]);

  const filteredTransactions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    // Valor no jeito que o operador digita: "2.125,26", "2125,26" ou "2125.26".
    const haystack = (tx: BankTransaction) => {
      const abs = Math.abs(tx.amount);
      return [
        tx.description,
        formatCurrency(abs),
        abs.toFixed(2),
        abs.toFixed(2).replace(".", ","),
      ]
        .join(" ")
        .toLowerCase();
    };
    return lines
      .filter(
        (tx) =>
          (tab === "all" || tabOf(tx.status) === tab) &&
          (!term || haystack(tx).includes(term)),
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [lines, searchTerm, tab]);

  // ── Dias ───────────────────────────────────────────────────────────────────
  // Sem filtro, dia resolvido fica recolhido e o trabalho aparece sozinho. A
  // escolha do operador vale para o estado em que o dia estava: quando ele
  // muda (a última pendente foi tratada), o dia volta ao padrão e recolhe.
  const dayGroups = useMemo(
    () => (account ? groupByDay(account, lines, dayBalances) : []),
    [account, lines, dayBalances],
  );
  const unfiltered = tab === "all" && !searchTerm.trim();
  const [flippedDays, setFlippedDays] = useState<Set<string>>(new Set());
  const flipKey = (g: DayGroup) => `${g.day}|${g.done ? 1 : 0}`;
  const collapsedDays = useMemo(
    () =>
      new Set(
        unfiltered
          ? dayGroups
              .filter(
                (g) => g.total > 0 && g.done !== flippedDays.has(flipKey(g)),
              )
              .map((g) => g.day)
          : [],
      ),
    [dayGroups, flippedDays, unfiltered],
  );
  const toggleDay = (g: DayGroup) => {
    // Recolher pela mão não arrasta o cursor (nem o foco) para outra linha.
    activeIndex.current = -1;
    setFlippedDays((prev) => {
      const next = new Set(prev);
      const key = flipKey(g);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // O que o teclado percorre: só linhas de dia aberto.
  const navigable = useMemo(
    () =>
      filteredTransactions.filter((t) => !collapsedDays.has(dayKey(t.date))),
    [filteredTransactions, collapsedDays],
  );
  // Tudo o que foi importado já está no saldo inicial: não é filtro, é o fim do trabalho.
  const periodDoneMessage =
    lines.length === 0 && pastCount > 0 && summary
      ? `Tudo até ${format(summary.base.date, "dd/MM/yyyy")} já está no saldo inicial. Importe o próximo extrato para continuar.`
      : undefined;

  // Seleção vale só para o que está à vista: filtrar e confirmar nunca pega
  // linha escondida.
  const visibleSuggestions = filteredTransactions.filter(confirmableFor);
  const selection = filteredTransactions
    .filter((t) => selected.has(t.id) && selectableFor(t))
    .map((t) => t.id);
  const confirmSelection = visibleSuggestions
    .filter((t) => selected.has(t.id))
    .map((t) => t.id);

  const actor = user ? { uid: user.uid, email: user.email } : null;

  const updateStatusAndSync = async (
    id: string,
    status: BankTransaction["status"],
    updates?: Partial<BankTransaction>,
  ) => {
    updateTransactionStatus(id, status, updates);
    if (!companyId) return;

    await reconciliationSessionService.updateItem(companyId, id, {
      status,
      ...updates,
    });
  };

  const reconcileAll = (ids: string[], bankTx: BankTransaction) =>
    Promise.all(
      ids.map((matchedId) =>
        transactionService.reconcile(
          matchedId,
          {
            externalId: bankTx.id,
            reconciledBy: user!.uid,
            bankAccountId: bankTx.bankAccountId,
          },
          { companyId: companyId!, userEmail: user!.email },
        ),
      ),
    );

  /** Cria o lançamento já pago com valor e data da linha, e concilia. */
  const launchAndReconcile = async (
    tx: BankTransaction,
    template: LaunchTemplate,
    ruleId?: string,
  ) => {
    if (missingAccount(tx, template.accountId)) {
      throw new Error(
        `Lançamentos de ${new Date(tx.date).getFullYear()} precisam de conta contábil. Lance esta linha direto e escolha a conta.`,
      );
    }
    const draft = lineTransaction(tx, template);
    const ref = await transactionService.create(draft, actor!, companyId!);
    await reconcileAll([ref.id], tx);
    await updateStatusAndSync(tx.id, "matched", {
      matchedTransactionId: ref.id,
      matchedDetails: {
        id: ref.id,
        type: draft.type,
        status: "paid",
        description: draft.description,
        supplierOrClient: draft.supplierOrClient,
        amount: draft.amount,
        dueDate: draft.dueDate,
        paymentDate: draft.paymentDate,
      } as Transaction,
      confidence: 100,
      ruleId,
      resolution: "launched",
    });
  };

  /** Confirma uma sugestão — de título (`candidateId` escolhe outro) ou de regra. */
  const confirmLine = async (tx: BankTransaction, candidateId?: string) => {
    if (tx.ruleId && !candidateId) {
      const rule = ruleFor(tx);
      if (!rule) throw new Error("A regra desta sugestão foi excluída.");
      if (rule.action === "ignore" || !rule.template) {
        await updateStatusAndSync(tx.id, "ignored");
      } else {
        await launchAndReconcile(tx, rule.template, rule.id);
      }
      return;
    }

    const selectedCandidate = candidateId
      ? tx.matchCandidates?.find((c) => c.id === candidateId)
      : undefined;
    const matchedIds = selectedCandidate?.id
      ? [selectedCandidate.id]
      : tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0
        ? tx.matchedTransactionIds
        : tx.matchedTransactionId
          ? [tx.matchedTransactionId]
          : [];

    await reconcileAll(matchedIds, tx);
    await updateStatusAndSync(tx.id, "matched", {
      matchedTransactionId: selectedCandidate?.id || tx.matchedTransactionId,
      matchedDetails: selectedCandidate?.transaction || tx.matchedDetails,
      confidence: tx.confidence || 100,
      ruleId: undefined,
    });
  };

  // Uma por vez: cada lançamento passa pela validação de saldo do servidor, e
  // a falha de uma não deve derrubar as outras.
  const confirmSelected = async (ids: string[]) => {
    setBulkConfirming(true);
    let done = 0;
    const failures: string[] = [];
    for (const id of ids) {
      const tx = transactions.find((t) => t.id === id);
      if (!tx) continue;
      try {
        await confirmLine(tx);
        done++;
      } catch (error) {
        console.error(error);
        failures.push(friendlyError(error, "Erro ao confirmar"));
      }
    }
    setSelected(new Set());
    setBulkConfirming(false);
    if (failures.length === 0) {
      toast.success(
        `${plural(done, "sugestão confirmada", "sugestões confirmadas")}`,
      );
    } else {
      toast.warning(
        `${done} de ${done + failures.length} confirmadas; ${plural(failures.length, "falhou", "falharam")}`,
        { description: failureList(failures) },
      );
    }
  };

  /** Volta as linhas ao estado de antes de ignorar: status, motivo e regra. */
  const undoIgnore = (before: BankTransaction[]) => ({
    label: "Desfazer",
    onClick: async () => {
      if (!companyId) return;
      try {
        await reconciliationSessionService.bulkUpdateItems(
          companyId,
          before.map((t) => ({
            id: t.id,
            data: {
              status: t.status,
              ignoreReason: t.ignoreReason,
              ruleId: t.ruleId,
            },
          })),
        );
      } catch (error) {
        toast.error(friendlyError(error, "Erro ao desfazer"));
      }
    },
  });

  const ignoreSelected = async (
    ids: string[],
    reason: NonNullable<BankTransaction["ignoreReason"]>,
  ) => {
    if (!companyId) return;
    const before = transactions.filter((t) => ids.includes(t.id));
    try {
      await reconciliationSessionService.bulkUpdateItems(
        companyId,
        ids.map((id) => ({
          id,
          data: { status: "ignored", ignoreReason: reason, ruleId: undefined },
        })),
      );
      setSelected(new Set());
      toast.success(plural(ids.length, "linha ignorada", "linhas ignoradas"), {
        action: undoIgnore(before),
      });
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao ignorar as linhas"));
    }
  };

  /**
   * Grava a regra e já aplica nas outras linhas pendentes (de todas as contas
   * abertas): quem cria a regra quer ver o efeito na hora.
   */
  const createRuleAndApply = async (
    draft: ReconciliationRuleDraft,
    exceptId: string,
  ) => {
    const id = await reconciliationRuleService.create(
      draft,
      companyId!,
      actor!,
    );
    queryClient.invalidateQueries({ queryKey: ["reconciliation-rules"] });
    const rule = {
      ...draft,
      id,
      companyId: companyId!,
      active: true,
      createdBy: actor!.uid,
      createdAt: new Date(),
    };
    // Estado atual, não o do render: a linha de origem acabou de mudar.
    const pending = useReconciliationStore.getState().transactions.filter(
      (t) =>
        t.id !== exceptId &&
        !isBalanceLine(t) &&
        !isLocked(
          t,
          accounts.find((a) => a.id === t.bankAccountId),
        ),
    );
    const hits = applyRules(pending, [rule]).filter((t, i) => t !== pending[i]);
    if (hits.length > 0) {
      await reconciliationSessionService.bulkUpdateItems(
        companyId!,
        hits.map((t) => ({
          id: t.id,
          data: { status: t.status, ruleId: t.ruleId },
        })),
      );
    }
    return { ruleId: id, hits: hits.length };
  };

  const hitsNote = (hits: number) =>
    hits > 0
      ? `${plural(hits, "outra linha virou", "outras linhas viraram")} sugestão para confirmar.`
      : undefined;

  /** Ignora a linha e cria a regra que ignora as próximas iguais. */
  const ignoreAlways = async (tx: BankTransaction) => {
    const pattern = rulePattern(tx.description);
    if (pattern.length < 3) {
      toast.error("O histórico desta linha é curto demais para virar regra.");
      return;
    }
    try {
      const { ruleId, hits } = await createRuleAndApply(
        {
          pattern,
          direction: tx.amount < 0 ? "debit" : "credit",
          action: "ignore",
        },
        tx.id,
      );
      await updateStatusAndSync(tx.id, "ignored", { ruleId });
      toast.success(`Regra criada: ignorar “${pattern}”`, {
        description: hitsNote(hits),
      });
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao criar a regra"));
    }
  };

  const handleQuickLaunch = async (
    template: LaunchTemplate,
    pattern: string | null,
  ) => {
    const tx = launchingTx;
    if (!tx || !actor || !companyId) return;
    try {
      await launchAndReconcile(tx, template);
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao lançar"));
      throw error;
    }
    if (!pattern) {
      toast.success("Lançado e conciliado");
      return;
    }
    // O lançamento já foi gravado: falha na regra não desfaz nada.
    try {
      const { hits } = await createRuleAndApply(
        {
          pattern,
          direction: tx.amount < 0 ? "debit" : "credit",
          action: "create",
          template,
        },
        tx.id,
      );
      toast.success("Lançado, conciliado e regra criada", {
        description: hitsNote(hits),
      });
    } catch (error) {
      console.error(error);
      toast.warning("Lançado e conciliado, mas a regra não foi criada", {
        description: friendlyError(error, "Tente de novo pela próxima linha."),
      });
    }
  };

  const handleRuleToggle = async (
    rule: ReconciliationRule,
    active: boolean,
  ) => {
    if (!actor) return;
    try {
      await reconciliationRuleService.setActive(rule, active, actor);
      await queryClient.invalidateQueries({
        queryKey: ["reconciliation-rules"],
      });
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao atualizar a regra"));
    }
  };

  // Sugestões ainda abertas da regra voltam a pendente; as já confirmadas ficam.
  const handleRuleDelete = async () => {
    const rule = ruleToDelete;
    if (!rule || !actor || !companyId) return;
    try {
      await reconciliationRuleService.delete(rule, actor);
      const open = allItems.filter(
        (t) => t.ruleId === rule.id && t.status === "potential_match",
      );
      if (open.length > 0) {
        await reconciliationSessionService.bulkUpdateItems(
          companyId,
          open.map((t) => ({
            id: t.id,
            data: { status: "unmatched", ruleId: undefined },
          })),
        );
      }
      await queryClient.invalidateQueries({
        queryKey: ["reconciliation-rules"],
      });
      toast.success("Regra excluída");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao excluir a regra"));
    }
  };

  /**
   * Desfaz de verdade: o lançamento criado pela linha é excluído e a baixa
   * feita por ela é estornada. Só tirar a marca de conciliado deixava o título
   * pago, e o operador descobria depois em Contas a pagar.
   */
  const undoLine = async (tx: BankTransaction) => {
    if (!user || !companyId || !actor) return;
    const matchedIds =
      tx.matchedTransactionIds && tx.matchedTransactionIds.length > 0
        ? tx.matchedTransactionIds
        : tx.matchedTransactionId
          ? [tx.matchedTransactionId]
          : [];
    const resolution = tx.status === "matched" ? tx.resolution : undefined;

    try {
      if (resolution === "launched" && tx.matchedTransactionId) {
        await transactionService.delete(
          tx.matchedTransactionId,
          actor,
          companyId,
        );
      } else {
        // Estorna antes de soltar: se o estorno falhar, nada mudou.
        if (
          resolution === "settled" &&
          tx.previousStatus &&
          tx.matchedTransactionId
        ) {
          await transactionService.updateStatus(
            tx.matchedTransactionId,
            tx.previousStatus,
            actor,
            companyId,
          );
        }
        const unreconcileActor = {
          companyId,
          userId: user.uid,
          userEmail: user.email,
        };
        await Promise.all(
          matchedIds.map((matchedId) =>
            transactionService.unreconcile(matchedId, unreconcileActor),
          ),
        );
      }

      await updateStatusAndSync(tx.id, "unmatched", {
        matchedTransactionId: undefined,
        matchedTransactionIds: undefined,
        matchedDetails: undefined,
        matchedBundleDetails: undefined,
        confidence: undefined,
        ruleId: undefined,
        ignoreReason: undefined,
        resolution: undefined,
        previousStatus: undefined,
      });
      if (tx.status === "ignored") toast.success("Linha voltou para pendente");
      else if (resolution === "launched")
        toast.success("Conciliação desfeita e lançamento excluído");
      else if (resolution === "settled")
        toast.success("Conciliação desfeita e baixa estornada");
      else
        toast.success("Conciliação desfeita", {
          description: tx.matchedDetails
            ? `“${tx.matchedDetails.description}” continua pago no sistema.`
            : undefined,
        });
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao desfazer conciliação"));
    }
  };

  const handleAction: ActionHandler = async (id, action, arg) => {
    if (!canManageReconciliation || !user || !companyId) return;
    const tx = transactions.find((t) => t.id === id);
    if (!tx || rowStateFor(tx) !== "editable") return;

    if (action === "confirm") {
      try {
        await confirmLine(tx, arg);
        toast.success("Conciliação confirmada");
      } catch (error) {
        console.error(error);
        toast.error(friendlyError(error, "Erro ao confirmar conciliação"));
      }
    } else if (action === "ignore") {
      try {
        await updateStatusAndSync(id, "ignored", {
          ignoreReason: (arg ?? "other") as BankTransaction["ignoreReason"],
          ruleId: undefined,
        });
        toast.success("Linha ignorada", { action: undoIgnore([tx]) });
      } catch (error) {
        console.error(error);
        toast.error(friendlyError(error, "Erro ao ignorar lançamento"));
      }
    } else if (action === "ignoreAlways") {
      await ignoreAlways(tx);
    } else if (action === "create") {
      setLaunchingTx(tx);
    } else if (action === "settle") {
      setSettlingTx(tx);
    } else if (action === "unreconcile") {
      // Excluir lançamento ou estornar baixa pede confirmação; o resto é barato.
      if (
        tx.status === "matched" &&
        (tx.resolution === "launched" || tx.resolution === "settled")
      ) {
        setUndoTx(tx);
      } else {
        await undoLine(tx);
      }
    }
  };

  const handleCreateSubmit = async (data: TransactionFormData) => {
    if (!canManageReconciliation || !companyId || !user || !selectedBankTx)
      return;

    try {
      const ref = await transactionService.create(
        data,
        { uid: user.uid, email: user.email },
        companyId,
      );

      const matchedId = "id" in ref ? ref.id : undefined;
      if (matchedId) await reconcileAll([matchedId], selectedBankTx);

      await updateStatusAndSync(selectedBankTx.id, "matched", {
        matchedTransactionId: matchedId,
        matchedDetails: {
          id: matchedId,
          type: data.type,
          status: "paid",
          description: data.description,
          supplierOrClient: data.supplierOrClient,
          amount: data.amount,
          dueDate: data.dueDate,
          paymentDate: data.paymentDate,
        } as Transaction,
        confidence: 100,
        resolution: "launched",
      });

      toast.success("Lançamento criado e conciliado");
      setCreateModalOpen(false);
      setSelectedBankTx(null);
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao criar transação"));
    }
  };

  // Baixa um título em aberto com a data e o valor do extrato e já concilia.
  const handleSettle = async (title: Transaction, settlement: Settlement) => {
    if (!settlingTx || !actor || !companyId) return;
    try {
      const result = await transactionService.settle(
        title.id,
        settlement,
        actor,
        companyId,
      );
      await reconcileAll([title.id], settlingTx);
      await updateStatusAndSync(settlingTx.id, "matched", {
        matchedTransactionId: title.id,
        matchedDetails: {
          ...title,
          status: "paid",
          paymentDate: settlement.paymentDate,
          finalAmount: settlement.finalAmount,
        },
        confidence: 100,
        resolution: "settled",
        previousStatus: title.status,
      });
      toast.success("Título baixado e conciliado", {
        description: result.budgetExceeded
          ? "A baixa caiu num exercício sem orçamento suficiente; o gestor foi avisado."
          : undefined,
      });
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao baixar o título"));
      throw error;
    }
  };

  const triggerAutoMatch = async () => {
    if (!canManageReconciliation || !companyId || !user) return;
    const open = lines.filter((t) => rowStateFor(t) === "editable");
    if (open.length === 0) {
      toast.info("Nenhuma linha aberta para buscar correspondência.");
      return;
    }
    setIsMatching(true);
    try {
      const dates = open.map((t) => new Date(t.date).getTime());
      const [systemTransactions, entities] = await Promise.all([
        transactionService.getAll({
          companyId,
          // Only transactions where money actually moved are valid reconciliation
          // candidates — matching against draft/pending/rejected transactions would
          // let a bank line "confirm" a payment that hasn't happened.
          statuses: ["paid", "received"],
          startDate: subDays(new Date(Math.min(...dates)), 10),
          endDate: addDays(new Date(Math.max(...dates)), 10),
          ...(onlyOwnPayables ? { createdBy: user.uid } : {}),
        }),
        entityService.getAll(companyId),
      ]);

      const processed = ReconciliationService.runAutoReconciliation(
        open,
        systemTransactions,
        entities,
      );

      // Título vence regra: a linha que achou título larga a sugestão da regra.
      // O que sobrou pendente passa pelas regras.
      const withRules = applyRules(
        processed.map((tx, i) =>
          tx !== open[i] &&
          tx.ruleId &&
          (tx.matchedTransactionId || tx.matchedTransactionIds?.length)
            ? { ...tx, ruleId: undefined }
            : tx,
        ),
        rules,
      );

      // Only the entries the matcher actually touched need to be persisted —
      // runAutoReconciliation keeps the same object reference for anything
      // it skipped (already matched/ignored), so a reference check is a cheap diff.
      const changed = withRules.filter((tx, i) => tx !== open[i]);
      const changedById = new Map(changed.map((tx) => [tx.id, tx]));
      setTransactions(allItems.map((t) => changedById.get(t.id) ?? t));
      if (changed.length > 0) {
        await reconciliationSessionService.bulkUpdateItems(
          companyId,
          changed.map((tx) => ({ id: tx.id, data: tx })),
        );
      }

      // Sugestão forte já vem marcada: confirmar é um clique, mas é de alguém.
      const strong = changed.filter(
        (t) =>
          t.status === "potential_match" &&
          !t.ruleId &&
          (t.confidence ?? 0) >= 90,
      );
      if (strong.length > 0) {
        setSelected((prev) => new Set([...prev, ...strong.map((t) => t.id)]));
      }
      const byRule = changed.filter(
        (t) => t.status === "potential_match" && t.ruleId,
      ).length;
      const toReview =
        changed.filter((t) => t.status === "potential_match").length -
        strong.length -
        byRule;
      toast.success(
        changed.length === 0
          ? "Nenhuma correspondência nova encontrada."
          : strong.length > 0
            ? `${plural(strong.length, "sugestão forte já selecionada", "sugestões fortes já selecionadas")} para confirmar`
            : `${plural(toReview, "sugestão", "sugestões")} para revisar`,
        {
          description:
            [
              strong.length > 0 && toReview > 0
                ? `${plural(toReview, "outra sugestão", "outras sugestões")} para revisar.`
                : null,
              byRule > 0
                ? `${plural(byRule, "linha sugerida", "linhas sugeridas")} por regra.`
                : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined,
        },
      );
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar dados do sistema.");
    } finally {
      setIsMatching(false);
    }
  };

  const handleClearSession = async () => {
    if (!canManageReconciliation || !companyId || !account) return;
    try {
      await reconciliationSessionService.clearSession(companyId, account.id);
      toast.success("Linhas do extrato removidas");
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao limpar a sessão"));
    }
  };

  const assignLegacy = async () => {
    if (!companyId || !account) return;
    try {
      await reconciliationSessionService.bulkUpdateItems(
        companyId,
        legacyItems.map((t) => ({
          id: t.id,
          data: { bankAccountId: account.id },
        })),
      );
      toast.success(
        `${plural(legacyItems.length, "linha atribuída", "linhas atribuídas")} a ${account.name}`,
      );
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao atribuir as linhas"));
    }
  };

  const refreshAccounts = () =>
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });

  const handleStatementBalance = async (balance: number, date: Date) => {
    if (!account) return;
    try {
      await bankAccountService.setStatementBalance(account.id, balance, date);
      await refreshAccounts();
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao salvar o saldo"));
      throw error;
    }
  };

  const handleClosePeriod = async () => {
    if (!account || !summary?.canClose || !summary.statementDate || !actor)
      return;
    try {
      await bankAccountService.close(
        account,
        summary.statementDate,
        summary.bookBalance,
        actor,
      );
      await refreshAccounts();
      toast.success(
        `${account.name} conciliada até ${format(summary.statementDate, "dd/MM/yyyy")}`,
      );
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao fechar o período"));
    }
  };

  const handleReopen = async () => {
    if (!account || !actor) return;
    try {
      await bankAccountService.reopenLast(account, actor);
      await refreshAccounts();
      toast.success("Período reaberto");
    } catch (error) {
      toast.error(friendlyError(error, "Erro ao reabrir o período"));
    }
  };

  // ── Teclado ────────────────────────────────────────────────────────────────
  // Mesmo mapa das listas de contas: j/k andam, x seleciona, Enter faz a ação
  // principal, i abre as outras, 1-5 trocam de aba, / busca.
  const primaryAction = (tx: BankTransaction): ReconciliationAction | null =>
    tx.status === "potential_match"
      ? "confirm"
      : tx.status !== "unmatched"
        ? null
        : canSettleFor(tx)
          ? "settle"
          : canLaunchFor(tx)
            ? "create"
            : null;

  const moveActive = (delta: number) => {
    const list = navigable;
    if (list.length === 0) return;
    const index = list.findIndex((t) => t.id === activeId);
    const next =
      list[
        index < 0
          ? delta > 0
            ? 0
            : list.length - 1
          : Math.min(list.length - 1, Math.max(0, index + delta))
      ];
    setActiveId(next.id);
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.closest("input, textarea, select, [contenteditable='true']") ||
        target.closest("[role='dialog'], [role='menu']")
      ) {
        return;
      }
      const active = navigable.find((t) => t.id === activeId);
      const onRow = target.hasAttribute("data-row-id");
      // Setas só com o foco numa linha, para não roubar a rolagem da página.
      const arrow =
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        !!target.closest("[data-row-id]");

      if (e.key === "j" || e.key === "k" || arrow) {
        e.preventDefault();
        moveActive(e.key === "j" || e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (/^[1-4]$/.test(e.key)) {
        setTab(TABS[Number(e.key) - 1].id);
      } else if ((e.key === "[" || e.key === "]") && account) {
        const n = orderedAccounts.length;
        const i = orderedAccounts.findIndex((a) => a.id === account.id);
        if (n > 1)
          selectAccount(
            orderedAccounts[(i + (e.key === "]" ? 1 : -1) + n) % n].id,
          );
      } else if ((e.key === "x" || e.key === "X") && active) {
        if (!selectableFor(active)) return;
        const next = new Set(selected);
        if (next.has(active.id)) next.delete(active.id);
        else next.add(active.id);
        setSelected(next);
      } else if (e.key === "Enter" && active && onRow) {
        // Enter num botão da linha é do botão; só a linha inteira dispara a principal.
        const action = primaryAction(active);
        if (action && rowStateFor(active) === "editable") {
          e.preventDefault();
          handleAction(active.id, action);
        }
      } else if (e.key === "i" && active && selectableFor(active)) {
        setMenuOpenId(active.id);
      } else if (e.key === "Escape") {
        setSelected(new Set());
      }
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  // Linha tratada sai da aba filtrada, ou o dia dela recolhe: o cursor fica na
  // mesma posição (a próxima linha aberta) em vez de voltar ao topo. Trocar de
  // aba, de conta ou buscar zera a posição.
  useEffect(() => {
    activeIndex.current = -1;
  }, [tab, searchTerm, account?.id]);
  useEffect(() => {
    const i = navigable.findIndex((t) => t.id === activeId);
    if (i >= 0) {
      activeIndex.current = i;
    } else if (activeId && activeIndex.current >= 0) {
      const next =
        navigable[Math.min(activeIndex.current, navigable.length - 1)];
      setActiveId(next?.id ?? null);
    }
  }, [navigable, activeId]);
  useEffect(() => {
    if (!activeId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(activeId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    // Não tira o foco de um checkbox ou botão da própria linha.
    if (el && !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, [activeId]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold tracking-tight md:text-2xl">
        Conciliação Bancária
        {/* Com várias contas, a faixa de contas diz qual está aberta. */}
        {account && activeAccounts.length === 1 && (
          <span className="ml-2 text-base font-normal text-muted-foreground">
            · {account.name}
          </span>
        )}
      </h1>
      {account && (
        <div className="flex flex-wrap items-center gap-2">
          {canManageReconciliation && transactions.length > 0 && (
            <>
              <UploadStatement
                account={account}
                accounts={accounts}
                onAccountDetected={selectAccount}
                variant="button"
                primary={periodDone}
              />
              {/* Secundário: o primário da tela é fechar o período. */}
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={triggerAutoMatch}
                disabled={isMatching}
                aria-label="Buscar correspondências"
              >
                {isMatching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">
                  Buscar correspondências
                </span>
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label="Mais opções da conciliação"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setRulesOpen(true)}>
                <ListChecks className="h-4 w-4" />
                Regras de conciliação
                {rules.length > 0 && ` (${rules.length})`}
              </DropdownMenuItem>
              {closing && canManageBankAccounts && (
                <DropdownMenuItem onSelect={() => setReopenConfirmOpen(true)}>
                  <Undo2 className="h-4 w-4" />
                  Reabrir período até {format(closing.through, "dd/MM/yyyy")}
                </DropdownMenuItem>
              )}
              {canManageReconciliation && transactions.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setClearConfirmOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Limpar extrato desta conta
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  // Access guard — wait for the company/role to resolve before deciding
  if (!isCompanyLoading && selectedCompany && !canViewReconciliation) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para acessar a conciliação bancária.
        </p>
      </div>
    );
  }

  if ((isStoreLoading && allItems.length === 0) || isAccountsLoading) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Skeleton className="h-[76px] w-full" />
        <div className="rounded-lg border divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 flex-1 max-w-sm" />
              <Skeleton className="h-4 w-24 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Sem conta cadastrada não há o que conciliar.
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="rounded-lg border px-6 py-12 text-center">
          <Landmark className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 font-medium">Cadastre a conta que vai conciliar</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A conciliação é feita por conta: o saldo de abertura dela é o ponto
            de partida para conferir o extrato.
          </p>
          {canManageBankAccounts ? (
            <Button asChild className="mt-5">
              <Link href="/cadastros/contas-bancarias">
                <Plus className="h-4 w-4" />
                Cadastrar conta bancária
              </Link>
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Peça ao gestor financeiro para cadastrar as contas.
            </p>
          )}
        </div>
      </div>
    );
  }

  const legacyBanner = canManageReconciliation && legacyItems.length > 0 && (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <p className="flex-1 min-w-[16rem] text-amber-900 dark:text-amber-200">
        {legacyItems.length === 1
          ? "1 linha foi importada antes das contas bancárias e não pertence a nenhuma conta."
          : `${legacyItems.length} linhas foram importadas antes das contas bancárias e não pertencem a nenhuma conta.`}
      </p>
      <Button size="sm" variant="outline" onClick={assignLegacy}>
        Atribuir a {account.name}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {header}
      {activeAccounts.length > 1 && (
        <AccountStrip
          accounts={orderedAccounts}
          summaries={summaries}
          activeId={account.id}
          onSelect={selectAccount}
        />
      )}
      {legacyBanner}

      {summary && (
        <BalanceStrip
          account={account}
          summary={summary}
          canManage={canManageReconciliation}
          onSetStatementBalance={handleStatementBalance}
          onClose={() => setCloseConfirmOpen(true)}
          onShowPending={() => setTab("pending")}
        />
      )}

      {transactions.length === 0 ? (
        canManageReconciliation ? (
          <UploadStatement
            account={account}
            accounts={accounts}
            onAccountDetected={selectAccount}
          />
        ) : (
          <p className="rounded-lg border px-6 py-10 text-center text-sm text-muted-foreground">
            Nenhum extrato importado para {account.name}.
          </p>
        )
      ) : (
        <section className="rounded-lg border bg-card">
          {/* ── Abas por situação, como nas listas de contas ─────────────── */}
          <div
            role="tablist"
            aria-label="Situação das linhas"
            className="flex overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            // Setas trocam de aba e levam o foco junto (padrão WAI-ARIA de abas).
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex((t) => t.id === tab);
              const next =
                TABS[
                  (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) %
                    TABS.length
                ];
              setTab(next.id);
              e.currentTarget
                .querySelector<HTMLElement>(`[data-tab="${next.id}"]`)
                ?.focus();
            }}
          >
            {TABS.map((t, i) => {
              const selectedTab = t.id === tab;
              return (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  data-tab={t.id}
                  aria-selected={selectedTab}
                  aria-controls="reconciliation-panel"
                  tabIndex={selectedTab ? 0 : -1}
                  title={`${t.label} (${i + 1})`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
                    selectedTab
                      ? "after:bg-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {tabCounts[t.id]}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            id="reconciliation-panel"
            role="tabpanel"
            aria-label={TABS.find((t) => t.id === tab)?.label}
          >
            <div className="flex flex-col gap-3 border-b p-4">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1 md:max-w-[320px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    placeholder="Buscar descrição ou valor (/)"
                    aria-label="Buscar no extrato"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearchTerm("");
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-10 pl-9 pr-8 md:h-9"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Limpar busca"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <span className="ml-auto hidden text-xs text-muted-foreground tabular-nums md:inline">
                  {filteredTransactions.length} de{" "}
                  {plural(lines.length, "linha", "linhas")}
                </span>
                {pastCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={showPast}
                    onClick={() => setShowPast((v) => !v)}
                    className={cn(
                      "h-9 shrink-0 text-xs text-muted-foreground",
                      showPast && "bg-muted text-foreground",
                    )}
                  >
                    {/* Rótulo fixo: o estado vai no aria-pressed e no fundo. */}
                    <History className="h-3.5 w-3.5" />
                    Períodos anteriores ({pastCount})
                  </Button>
                )}
              </div>

              {/* Lote: confirmar as sugestões selecionadas, ignorar qualquer linha. */}
              {canManageReconciliation &&
                (selection.length > 0 || visibleSuggestions.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <span className="tabular-nums">
                      {selection.length > 0
                        ? plural(
                            selection.length,
                            "linha selecionada",
                            "linhas selecionadas",
                          )
                        : `${plural(visibleSuggestions.length, "sugestão", "sugestões")} para confirmar`}
                    </span>
                    <div className="ml-auto flex flex-wrap gap-2">
                      {selection.length > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => setSelected(new Set())}
                          disabled={bulkConfirming}
                        >
                          Limpar seleção
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() =>
                            setSelected(
                              new Set(visibleSuggestions.map((t) => t.id)),
                            )
                          }
                        >
                          Selecionar sugestões
                        </Button>
                      )}
                      {selection.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={bulkConfirming}
                            >
                              <MinusCircle className="h-3.5 w-3.5" />
                              Ignorar {selection.length}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                              Motivo
                            </DropdownMenuLabel>
                            {IGNORE_REASONS.map((r) => (
                              <DropdownMenuItem
                                key={r.value}
                                onSelect={() =>
                                  ignoreSelected(selection, r.value)
                                }
                              >
                                {r.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={
                          confirmSelection.length === 0 || bulkConfirming
                        }
                        onClick={() => confirmSelected(confirmSelection)}
                      >
                        {bulkConfirming ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Confirmar
                        {confirmSelection.length > 0 &&
                          ` ${confirmSelection.length}`}
                      </Button>
                    </div>
                  </div>
                )}
            </div>

            {/* Desktop table */}
            <div className="relative hidden md:block" aria-busy={isMatching}>
              {isMatching && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium shadow-sm"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Buscando correspondências…
                  </div>
                </div>
              )}
              <ReconciliationTable
                transactions={filteredTransactions}
                days={dayGroups}
                collapsedDays={collapsedDays}
                onToggleDay={toggleDay}
                showEmptyDays={unfiltered}
                onAction={handleAction}
                rowState={rowStateFor}
                canSettle={canSettleFor}
                canLaunch={canLaunchFor}
                canRule={canManageReconciliationRules}
                ruleFor={ruleFor}
                isSelectable={selectableFor}
                selected={selected}
                onSelectedChange={
                  canManageReconciliation ? setSelected : undefined
                }
                activeId={activeId}
                onActiveChange={setActiveId}
                menuOpenId={menuOpenId}
                onMenuOpenChange={setMenuOpenId}
                onClearFilters={clearFilters}
                emptyState={periodDoneMessage}
              />
              {/* Só quando há o que tratar: com tudo travado, as teclas não fazem nada. */}
              {lines.some((t) => rowStateFor(t) === "editable") && (
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  Teclado: <Kbd>j</Kbd> <Kbd>k</Kbd> navega · <Kbd>Enter</Kbd>{" "}
                  ação principal · <Kbd>i</Kbd> outras ações · <Kbd>x</Kbd>{" "}
                  seleciona · <Kbd>/</Kbd> busca · <Kbd>1</Kbd> a <Kbd>4</Kbd>{" "}
                  filtro
                  {orderedAccounts.length > 1 && (
                    <>
                      {" "}
                      · <Kbd>[</Kbd> <Kbd>]</Kbd> conta
                    </>
                  )}
                </p>
              )}
            </div>

            {/* Mobile card list */}
            <div className="md:hidden">
              {filteredTransactions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-muted-foreground">
                  <FileText className="h-8 w-8 opacity-40" />
                  <p className="text-center text-sm font-medium">
                    {searchTerm
                      ? `Nenhum resultado para "${searchTerm}"`
                      : (periodDoneMessage ?? "Nenhuma linha nesta aba")}
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={clearFilters}
                  >
                    Limpar filtros
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredTransactions.map((tx) => (
                    <MobileBankTxCard
                      key={tx.id}
                      tx={tx}
                      state={rowStateFor(tx)}
                      canSettle={canSettleFor(tx)}
                      canLaunch={canLaunchFor(tx)}
                      canRule={canManageReconciliationRules}
                      rule={ruleFor(tx)}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={`Limpar o extrato de ${account.name}?`}
        description={`${plural(transactions.length, "linha importada", "linhas importadas")} desta conta saem da tela, incluindo ${summary?.pending ?? 0} ainda pendentes. Lançamentos já conciliados continuam conciliados no sistema, e os períodos fechados não mudam.`}
        confirmText="Limpar extrato"
        variant="destructive"
        onConfirm={handleClearSession}
      />

      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title={`Fechar ${account.name} até ${summary?.statementDate ? format(summary.statementDate, "dd/MM/yyyy") : ""}?`}
        description={`O saldo conciliado de ${formatCurrency(summary?.bookBalance ?? 0)} vira o saldo inicial do próximo período. As linhas até essa data ficam somente leitura; só o gestor financeiro pode reabrir.`}
        confirmText="Fechar período"
        onConfirm={handleClosePeriod}
      />

      <ConfirmDialog
        open={reopenConfirmOpen}
        onOpenChange={setReopenConfirmOpen}
        title={`Reabrir o período fechado até ${closing ? format(closing.through, "dd/MM/yyyy") : ""}?`}
        description={`As linhas desse período voltam a ser editáveis e o saldo inicial volta para ${reopenTarget ? `${formatCurrency(reopenTarget.balance)} em ${format(new Date(reopenTarget.through), "dd/MM/yyyy")}` : "o fechamento anterior"}. A reabertura fica registrada na auditoria.`}
        confirmText="Reabrir"
        variant="destructive"
        onConfirm={handleReopen}
      />

      {companyId && (
        <QuickLaunchSheet
          companyId={companyId}
          account={account}
          bankTx={launchingTx}
          canCreateRule={canManageReconciliationRules}
          onOpenChange={(o) => !o && setLaunchingTx(null)}
          onSubmit={handleQuickLaunch}
          onOpenFullForm={(tx) => {
            setSelectedBankTx(tx);
            setCreateModalOpen(true);
          }}
        />
      )}

      {companyId && (
        <RulesSheet
          companyId={companyId}
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          rules={rules}
          canManage={canManageReconciliationRules}
          onToggle={handleRuleToggle}
          onDelete={setRuleToDelete}
        />
      )}

      <ConfirmDialog
        open={!!ruleToDelete}
        onOpenChange={(o) => !o && setRuleToDelete(null)}
        title={`Excluir a regra “${ruleToDelete?.pattern ?? ""}”?`}
        description="As sugestões dela ainda não confirmadas voltam para pendente. O que já foi conciliado continua conciliado."
        confirmText="Excluir regra"
        variant="destructive"
        onConfirm={handleRuleDelete}
      />

      {companyId && (
        <SettleFromStatementSheet
          companyId={companyId}
          bankTx={settlingTx}
          onOpenChange={(o) => !o && setSettlingTx(null)}
          onSettle={handleSettle}
        />
      )}

      <ConfirmDialog
        open={!!undoTx}
        onOpenChange={(o) => !o && setUndoTx(null)}
        title={
          undoTx?.resolution === "launched"
            ? "Desfazer e excluir o lançamento?"
            : "Desfazer e estornar a baixa?"
        }
        description={
          undoTx?.resolution === "launched"
            ? `“${undoTx.matchedDetails?.description ?? "O lançamento"}” foi criado a partir desta linha e será excluído. A linha volta para pendente.`
            : `A baixa de “${undoTx?.matchedDetails?.description ?? "o título"}” é estornada e ele volta a ficar em aberto. A linha volta para pendente.`
        }
        confirmText={
          undoTx?.resolution === "launched"
            ? "Excluir lançamento"
            : "Estornar baixa"
        }
        variant="destructive"
        onConfirm={async () => {
          if (undoTx) await undoLine(undoTx);
        }}
      />

      {/* Painel lateral, como o formulário de lançamento nas listas. */}
      <Sheet open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <SheetContent
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 overflow-hidden p-0 sm:max-w-4xl"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-6 py-4">
            <SheetTitle className="text-lg">Lançar e conciliar</SheetTitle>
            {selectedBankTx && (
              <SheetDescription>
                {selectedBankTx.description} ·{" "}
                {format(new Date(selectedBankTx.date), "dd/MM/yyyy")} ·{" "}
                {formatCurrency(Math.abs(selectedBankTx.amount))}
              </SheetDescription>
            )}
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 pt-5"
            style={{ "--form-inset": "1.5rem" } as React.CSSProperties}
          >
            {selectedBankTx && (
              <TransactionForm
                variant="reconcile"
                type={
                  selectedBankTx.type === "debit" ? "payable" : "receivable"
                }
                defaultValues={{
                  amount: Math.abs(selectedBankTx.amount),
                  description: selectedBankTx.description,
                  dueDate: new Date(selectedBankTx.date),
                  paymentDate: new Date(selectedBankTx.date),
                  status: "paid",
                  paymentMethod: "transfer",
                  bankAccountId: selectedBankTx.bankAccountId,
                  supplierOrClient: selectedBankTx.description,
                }}
                onSubmit={handleCreateSubmit}
                isLoading={false}
                onCancel={() => setCreateModalOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-foreground/80">
      {children}
    </kbd>
  );
}

/** Todas as falhas do lote, não só a primeira; a partir da quarta, a contagem. */
const failureList = (failures: string[]) =>
  [
    ...failures.slice(0, 3),
    ...(failures.length > 3 ? [`e mais ${failures.length - 3}`] : []),
  ].join("\n");
