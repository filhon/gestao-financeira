"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Plus,
  Loader2,
  Trash2,
  Eye,
  Upload,
  Search,
  RotateCcw,
  CheckCheck,
  CheckCircle2,
  DollarSign,
  MoreHorizontal,
} from "lucide-react";
import { BulkImportDialog } from "@/components/features/finance/BulkImportDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Transaction } from "@/lib/types";
import { transactionService } from "@/lib/services/transactionService";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import { TransactionFormData } from "@/lib/validations/transaction";
import { useAuth } from "@/components/providers/AuthProvider";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { PaymentBatch } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useSortableData } from "@/hooks/useSortableData";
import { usePermissions } from "@/hooks/usePermissions";
import { useDebounce } from "@/hooks/useDebounce";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { CurrencyInput } from "@/components/ui/currency-input";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";

function useAnimatedValue(targetValue: number, duration: number = 800) {
  const [currentValue, setCurrentValue] = useState(targetValue);
  const startValueRef = useRef(targetValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startValueRef.current = currentValue;
    startTimeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetValue]);

  useEffect(() => {
    let animationFrameId: number;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const progress = Math.min(
        (timestamp - startTimeRef.current) / duration,
        1,
      );
      // Ease out quart
      const ease = 1 - Math.pow(1 - progress, 4);

      const nextValue =
        startValueRef.current + (targetValue - startValueRef.current) * ease;

      setCurrentValue(nextValue);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [targetValue, duration]);

  return currentValue;
}

const AnimatedNumber = ({
  value,
  formatter,
}: {
  value: number;
  formatter?: (n: number) => string;
}) => {
  const animated = useAnimatedValue(value);
  return <>{formatter ? formatter(animated) : Math.round(animated)}</>;
};

// ...

export default function AccountsPayablePage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [selectedCostCenterId, setSelectedCostCenterId] =
    useState<string>("all");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Batch Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isBatchPaymentOpen, setIsBatchPaymentOpen] = useState(false);
  const [isBatchRevertOpen, setIsBatchRevertOpen] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchPaymentDate, setBatchPaymentDate] = useState<Date>(new Date());
  const [openBatches, setOpenBatches] = useState<PaymentBatch[]>([]);
  const [newBatchName, setNewBatchName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Payment Confirmation State
  const [transactionToConfirm, setTransactionToConfirm] =
    useState<Transaction | null>(null);
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [itemsPerPage] = useState(25);
  const [statusFilter, setStatusFilter] = useState<string>("exclude-paid");

  // Use centralized permissions
  const {
    canDeletePayables,
    canCreatePayables,
    onlyOwnPayables,
    canEditPayables,
    isAdmin,
    isFinancialManager,
  } = usePermissions();

  // --- Search mode (client-side) ---
  const [searchResults, setSearchResults] = useState<Transaction[] | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);

  const {
    items: paginatedTransactions,
    hasMore,
    loadMore,
    isLoading: isPaginatedLoading,
    isFetchingNextPage,
    refresh: refreshTransactions,
    updateItem,
  } = usePaginatedQuery<Transaction>({
    queryKey: [
      "payable-transactions",
      selectedCompany?.id,
      statusFilter,
      showAllTransactions,
      selectedCostCenterId,
      onlyOwnPayables ? user?.uid : "all",
    ],
    queryFn: async (pageSize, lastDoc) => {
      const getDescendantIds = (
        rootId: string,
        all: CostCenter[],
      ): string[] => {
        const children = all.filter((c) => c.parentId === rootId);
        let ids = [rootId];
        for (const child of children) {
          ids = [...ids, ...getDescendantIds(child.id, all)];
        }
        return ids;
      };

      const targetCostCenterIds =
        selectedCostCenterId !== "all" && costCenters.length > 0
          ? getDescendantIds(selectedCostCenterId, costCenters)
          : undefined;

      const filter: {
        type: string;
        excludeStatus?: string[];
        status?: string;
        endDate?: Date;
        createdBy?: string;
        costCenterIds?: string[];
      } = {
        type: "payable",
        excludeStatus: statusFilter === "exclude-paid" ? ["paid"] : [],
        status:
          statusFilter !== "all" && statusFilter !== "exclude-paid"
            ? statusFilter
            : undefined,
        endDate: !showAllTransactions ? addDays(new Date(), 7) : undefined,
        costCenterIds: targetCostCenterIds,
      };

      if (onlyOwnPayables) {
        filter.createdBy = user!.uid;
      }

      const { transactions: items, lastDoc: newLastDoc } =
        await transactionService.getPaginated(
          selectedCompany!.id,
          pageSize,
          lastDoc,
          filter,
        );

      return { items, lastDoc: newLastDoc };
    },
    pageSize: itemsPerPage,
    enabled: !!selectedCompany && !!user && !debouncedSearchTerm,
  });

  // Decide entre resultados de busca e resultados paginados
  const transactions = searchResults ?? paginatedTransactions;
  const isLoading = debouncedSearchTerm ? isSearching : isPaginatedLoading;

  const {
    items: sortedTransactions,
    requestSort,
    sortConfig,
  } = useSortableData(transactions, {
    key: "dueDate",
    direction: "asc",
  });

  const handleOpenPaymentConfirmation = async (t: Transaction) => {
    if (!user || !selectedCompany) return;
    try {
      if (t.batchId) {
        setIsConfirmingPayment(true);
        const batch = await paymentBatchService.getById(t.batchId);
        setIsConfirmingPayment(false);
        if (batch) {
          const allowedStatuses = [
            "approved",
            "authorized",
            "pending_authorization",
            "paid",
          ];
          if (!allowedStatuses.includes(batch.status)) {
            toast.error(
              "O lote desta transação precisa estar aprovado para confirmar o pagamento.",
            );
            return;
          }
        }
      }

      setTransactionToConfirm(t);
      setPaymentDate(new Date());
      setPaymentAmount(t.amount); // Default to full amount
    } catch (error) {
      console.error("Error validating batch:", error);
      toast.error("Erro ao validar lote.");
      setIsConfirmingPayment(false);
    }
  };

  const handleExecutePayment = async () => {
    if (!transactionToConfirm || !user || !selectedCompany) return;

    try {
      setIsConfirmingPayment(true);
      await transactionService.update(
        transactionToConfirm.id,
        {
          status: "paid",
          paymentDate: paymentDate,
          finalAmount: paymentAmount, // Store actual paid amount
        },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );

      toast.success("Pagamento confirmado com sucesso!");
      refreshTransactions();
      setTransactionToConfirm(null);
    } catch (error) {
      console.error("Error confirming payment:", error);
      toast.error("Erro ao confirmar pagamento.");
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const fetchTransactions = refreshTransactions;

  useEffect(() => {
    if (selectedCompany) {
      costCenterService
        .getAll(selectedCompany.id)
        .then((ccs) => {
          setCostCenters(ccs);
        })
        .catch((err) => console.error("Error loading cost centers", err));
    }
  }, [selectedCompany]);

  // Client-side search
  useEffect(() => {
    if (debouncedSearchTerm && selectedCompany && user) {
      const performSearch = async () => {
        setIsSearching(true);
        try {
          const filter: {
            companyId: string;
            type: string;
            createdBy?: string;
          } = {
            companyId: selectedCompany.id,
            type: "payable",
          };

          if (onlyOwnPayables) {
            filter.createdBy = user.uid;
          }

          const all = await transactionService.getAll(filter);

          const search = debouncedSearchTerm
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");

          const filtered = all.filter((t) => {
            const description = t.description
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
            const supplier = (t.supplierOrClient || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
            return description.includes(search) || supplier.includes(search);
          });

          setSearchResults(filtered);
        } catch (e) {
          console.error(e);
          toast.error("Erro na busca");
        } finally {
          setIsSearching(false);
        }
      };
      performSearch();
    } else {
      setSearchResults(null);
    }

    setSelectedIds(new Set());
  }, [debouncedSearchTerm, selectedCompany, user, onlyOwnPayables]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select all visible transactions
      setSelectedIds(new Set(sortedTransactions.map((t) => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const fetchOpenBatches = async () => {
    if (!selectedCompany) return;
    try {
      const { batches: allBatches } = await paymentBatchService.getAll(
        selectedCompany.id,
      );
      setOpenBatches(allBatches.filter((b) => b.status === "open"));
    } catch {
      toast.error("Erro ao carregar lotes");
    }
  };

  const handleAddToBatch = async (batchId: string) => {
    try {
      const selectedTx = transactions.filter((t) => selectedIds.has(t.id));

      // Validate that only draft transactions can be added to batch
      const nonDraftTransactions = selectedTx.filter(
        (t) => t.status !== "draft",
      );
      if (nonDraftTransactions.length > 0) {
        toast.error(
          "Apenas transações em rascunho podem ser adicionadas ao lote",
        );
        return;
      }

      await paymentBatchService.addTransactions(batchId, selectedTx);
      toast.success("Transações adicionadas ao lote");
      setIsBatchDialogOpen(false);
      setSelectedIds(new Set());
      refreshTransactions();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao adicionar ao lote");
    }
  };

  const handleCreateAndAddToBatch = async () => {
    if (!selectedCompany || !user || !newBatchName.trim()) return;
    try {
      const batchRef = await paymentBatchService.create(
        newBatchName,
        selectedCompany.id,
        user.uid,
      );
      await handleAddToBatch(batchRef.id);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao criar e adicionar ao lote");
    }
  };

  const handleBatchPayment = async () => {
    if (!user || !selectedCompany) return;

    // Filter transactions that can be paid (not already paid)
    const transactionsToPay = transactions.filter(
      (t) => selectedIds.has(t.id) && t.status !== "paid",
    );

    if (transactionsToPay.length === 0) {
      toast.error("Nenhuma transação elegível para pagamento selecionada.");
      return;
    }

    try {
      setIsProcessingBatch(true);

      const promises = transactionsToPay.map((t) =>
        transactionService.update(
          t.id,
          {
            status: "paid",
            paymentDate: batchPaymentDate,
          },
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        ),
      );

      await Promise.all(promises);
      toast.success(
        `${transactionsToPay.length} transações pagas com sucesso!`,
      );
      setIsBatchPaymentOpen(false);
      setSelectedIds(new Set());
      refreshTransactions();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao realizar pagamento em lote.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleBatchRevert = async () => {
    if (!user || !selectedCompany) return;

    // Filter transactions that can be reverted (must be paid)
    const transactionsToRevert = transactions.filter(
      (t) => selectedIds.has(t.id) && t.status === "paid",
    );

    if (transactionsToRevert.length === 0) {
      toast.error("Nenhuma transação paga selecionada para reversão.");
      return;
    }

    try {
      setIsProcessingBatch(true);

      // We explicitly set paymentDate to null (or we could use deleteField if needed,
      // but null is often safer for types if we adjust the type definition or just cast)
      // For now, let's just change status to draft which seems to be the standard behavior in this app
      const promises = transactionsToRevert.map((t) =>
        transactionService.update(
          t.id,
          { status: "draft" }, // Reverting to draft effectively undoes payment
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        ),
      );

      await Promise.all(promises);
      toast.success(
        `${transactionsToRevert.length} pagamentos revertidos com sucesso!`,
      );
      setIsBatchRevertOpen(false);
      setSelectedIds(new Set());
      refreshTransactions();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao reverter pagamentos em lote.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleSubmit = async (data: TransactionFormData) => {
    if (!user || !selectedCompany) return;
    try {
      setIsSubmitting(true);

      if (data.recurrence?.isRecurring) {
        // Create Recurring Template
        await recurrenceService.createTemplate({
          companyId: selectedCompany.id,
          description: data.description,
          amount: data.amount,
          type: "payable",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          frequency: data.recurrence.frequency as any,
          interval: data.recurrence.interval || 1,
          nextDueDate: data.dueDate,
          active: true,
          baseTransactionData: {
            costCenterAllocation: data.costCenterAllocation,
            supplierOrClient: data.supplierOrClient,
            entityId: data.entityId,
            paymentMethod: data.paymentMethod,
            requestOrigin: data.requestOrigin,
            notes: data.notes || "",
          },
        });
        toast.success("Recorrência criada com sucesso!");

        // Trigger processing immediately to generate the first one if due
        await recurrenceService.processDueTemplates(selectedCompany.id, {
          uid: user.uid,
          email: user.email,
        });
      } else {
        // Normal Transaction
        await transactionService.create(
          data,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        );
        toast.success("Conta a pagar criada com sucesso!");
      }

      await fetchTransactions();
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Error saving transaction:", error);
      toast.error("Erro ao salvar conta a pagar.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewDetails = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsDetailsOpen(true);
  };

  const handleTransactionUpdate = useCallback(
    (updatedTransaction?: Transaction) => {
      if (updatedTransaction) {
        // Atualiza o item na lista local sem nova leitura no banco
        updateItem(updatedTransaction.id, () => updatedTransaction);
        setSelectedTransaction(updatedTransaction);
      } else {
        // Para acões complexas (pagamento, serie de recorrências) faz re-fetch
        refreshTransactions();
      }
    },
    [refreshTransactions, updateItem],
  );

  const handleRevertToDraft = async (transaction: Transaction) => {
    if (!user || !selectedCompany) return;
    try {
      await transactionService.update(
        transaction.id,
        { status: "draft" },
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Transação revertida para rascunho!");
      fetchTransactions();
    } catch (error) {
      console.error("Error reverting transaction:", error);
      toast.error("Erro ao reverter transação.");
    }
  };

  const handleDelete = async () => {
    if (!deleteId || !user || !selectedCompany) return;
    try {
      await transactionService.delete(
        deleteId,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Transação excluída com sucesso!");
      fetchTransactions();
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error("Erro ao excluir transação.");
    } finally {
      setDeleteId(null);
    }
  };

  // Filter logic moved to server-side via usePaginatedQuery

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-emerald-500">Aprovado</Badge>;
      case "pending_approval":
        return <Badge className="bg-amber-500">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-blue-500">Pago</Badge>;
      case "rejected":
        return <Badge className="bg-red-500">Rejeitado</Badge>;
      default:
        return <Badge variant="secondary">Rascunho</Badge>;
    }
  };

  const selectedTotal = transactions
    .filter((t) => selectedIds.has(t.id))
    .reduce((acc, t) => acc + t.amount, 0);

  return (
    <div className="space-y-6">
      {selectedIds.size > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Selecionadas
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <AnimatedNumber value={selectedIds.size} />
              </div>
              <p className="text-xs text-muted-foreground">
                Transações marcadas
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Valor Total</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                <AnimatedNumber
                  value={selectedTotal}
                  formatter={formatCurrency}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Soma dos valores originais
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>

        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <Dialog
                open={isBatchDialogOpen}
                onOpenChange={setIsBatchDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button variant="secondary" onClick={fetchOpenBatches}>
                    Adicionar ao Lote ({selectedIds.size})
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar ao Lote de Pagamento</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Selecione um Lote Aberto</Label>
                      {openBatches.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhum lote aberto encontrado.
                        </p>
                      ) : (
                        <div className="grid gap-2">
                          {openBatches.map((batch) => (
                            <Button
                              key={batch.id}
                              variant="outline"
                              className="justify-start"
                              onClick={() => handleAddToBatch(batch.id)}
                            >
                              {batch.name} ({formatCurrency(batch.totalAmount)})
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          Ou crie um novo
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Nome do novo lote"
                        value={newBatchName}
                        onChange={(e) => setNewBatchName(e.target.value)}
                      />
                      <Button onClick={handleCreateAndAddToBatch}>
                        Criar e Adicionar
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog
                open={isBatchPaymentOpen}
                onOpenChange={setIsBatchPaymentOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-green-600 border-green-600 hover:bg-green-50"
                  >
                    Pagar ({selectedIds.size})
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Pagamento em Lote</DialogTitle>
                    <CardDescription>
                      Serão pagos{" "}
                      {
                        transactions.filter(
                          (t) => selectedIds.has(t.id) && t.status !== "paid",
                        ).length
                      }{" "}
                      itens selecionados. Itens já pagos serão ignorados.
                    </CardDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Data do Pagamento</Label>
                      <Input
                        type="date"
                        value={format(batchPaymentDate, "yyyy-MM-dd")}
                        onChange={(e) => {
                          const date = e.target.valueAsDate;
                          if (date) {
                            const userTimezoneOffset =
                              date.getTimezoneOffset() * 60000;
                            setBatchPaymentDate(
                              new Date(date.getTime() + userTimezoneOffset),
                            );
                          }
                        }}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setIsBatchPaymentOpen(false)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleBatchPayment}
                        disabled={isProcessingBatch}
                      >
                        {isProcessingBatch && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Confirmar Pagamento
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog
                open={isBatchRevertOpen}
                onOpenChange={setIsBatchRevertOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-red-600 border-red-600 hover:bg-red-50"
                  >
                    Reverter ({selectedIds.size})
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reverter Pagamento em Lote</DialogTitle>
                    <CardDescription>
                      Deseja reverter o pagamento de{" "}
                      {
                        transactions.filter(
                          (t) => selectedIds.has(t.id) && t.status === "paid",
                        ).length
                      }{" "}
                      itens selecionados para Rascunho? Itens não pagos serão
                      ignorados.
                    </CardDescription>
                  </DialogHeader>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setIsBatchRevertOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleBatchRevert}
                      disabled={isProcessingBatch}
                    >
                      {isProcessingBatch && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Confirmar Reversão
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
          {canCreatePayables && (
            <>
              <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Importar
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Conta
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Nova Conta a Pagar</DialogTitle>
                  </DialogHeader>
                  <TransactionForm
                    type="payable"
                    onSubmit={handleSubmit}
                    isLoading={isSubmitting}
                    onCancel={() => setIsDialogOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <BulkImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={fetchTransactions}
        type="payable"
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transações</CardTitle>
              <CardDescription>
                Gerencie suas contas a pagar e fluxo de aprovação.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar transações..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-[250px] pl-8"
                />
              </div>
              <Select
                value={selectedCostCenterId}
                onValueChange={setSelectedCostCenterId}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Centro de Custo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {costCenters.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclude-paid">Excluir Pagas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="pending_approval">Pendente</SelectItem>
                  <SelectItem value="approved">Aprovado</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="rejected">Rejeitado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={
                        sortedTransactions.length > 0 &&
                        sortedTransactions.every((t) => selectedIds.has(t.id))
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("dueDate")}
                  >
                    Vencimento{" "}
                    {sortConfig?.key === "dueDate" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("description")}
                  >
                    Descrição{" "}
                    {sortConfig?.key === "description" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("supplierOrClient")}
                  >
                    Fornecedor{" "}
                    {sortConfig?.key === "supplierOrClient" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("amount")}
                  >
                    Valor{" "}
                    {sortConfig?.key === "amount" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("status")}
                  >
                    Status{" "}
                    {sortConfig?.key === "status" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground"
                    >
                      {sortedTransactions.length === 0
                        ? "Nenhuma conta a pagar encontrada."
                        : "Nenhuma conta com vencimento nos próximos 7 dias."}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedTransactions.map((t) => {
                    const isOverdue =
                      (t.status === "draft" ||
                        t.status === "pending_approval" ||
                        t.status === "approved" ||
                        t.status === "rejected") &&
                      isBefore(t.dueDate, startOfDay(new Date()));

                    return (
                      <TableRow
                        key={t.id}
                        className={
                          isOverdue ? "bg-red-50 dark:bg-red-900/10" : ""
                        }
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(t.id)}
                            onCheckedChange={() => toggleSelect(t.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div
                            className={
                              isOverdue
                                ? "font-medium text-red-600 dark:text-red-400"
                                : ""
                            }
                          >
                            {format(t.dueDate, "dd/MM/yyyy")}
                            {isOverdue && (
                              <div className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">
                                Vencida
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex items-center gap-2">
                            <span className="truncate" title={t.description}>
                              {t.description}
                            </span>
                            {t.batchId && (
                              <Badge
                                variant="outline"
                                className="shrink-0 text-[10px]"
                              >
                                Em Lote
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{t.supplierOrClient}</TableCell>
                        <TableCell>
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          }).format(t.amount)}
                        </TableCell>
                        <TableCell>{getStatusBadge(t.status)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Abrir menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Ações</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => handleViewDetails(t)}
                              >
                                <Eye className="mr-2 h-4 w-4" /> Ver detalhes
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {(isAdmin || isFinancialManager) &&
                                t.status !== "paid" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleOpenPaymentConfirmation(t)
                                    }
                                    className="text-green-600 focus:text-green-700"
                                  >
                                    <CheckCheck className="mr-2 h-4 w-4" />{" "}
                                    Confirmar Pagamento
                                  </DropdownMenuItem>
                                )}
                              {canEditPayables &&
                                t.status === "pending_approval" && (
                                  <DropdownMenuItem
                                    onClick={() => handleRevertToDraft(t)}
                                  >
                                    <RotateCcw className="mr-2 h-4 w-4" />{" "}
                                    Reverter para Rascunho
                                  </DropdownMenuItem>
                                )}
                              {canDeletePayables && (
                                <DropdownMenuItem
                                  onClick={() => setDeleteId(t.id)}
                                  className="text-red-600 focus:text-red-700"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
          {!isLoading && (
            <div className="mt-4 flex flex-col gap-4">
              {!showAllTransactions && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowAllTransactions(true)}
                >
                  Ver Todas as Transações
                </Button>
              )}
              {hasMore && !debouncedSearchTerm && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={loadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Carregar Mais
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TransactionDetailsDialog
        transaction={selectedTransaction}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        onUpdate={handleTransactionUpdate}
      />

      <Dialog
        open={!!transactionToConfirm}
        onOpenChange={(open) => {
          if (!open) setTransactionToConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Data do Pagamento</Label>
              <Input
                type="date"
                value={format(paymentDate, "yyyy-MM-dd")}
                onChange={(e) => {
                  const date = e.target.valueAsDate;
                  if (date) {
                    // Fix timezone offset issue with input type=date
                    const userTimezoneOffset = date.getTimezoneOffset() * 60000;
                    setPaymentDate(
                      new Date(date.getTime() + userTimezoneOffset),
                    );
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Valor Pago</Label>
              <CurrencyInput
                value={paymentAmount}
                onChange={(val) => setPaymentAmount(val)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setTransactionToConfirm(null)}
                disabled={isConfirmingPayment}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleExecutePayment}
                disabled={isConfirmingPayment}
              >
                {isConfirmingPayment && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Excluir Transação"
        description="Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
