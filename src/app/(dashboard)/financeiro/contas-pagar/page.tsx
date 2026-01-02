"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Loader2, Trash2, Eye, Upload } from "lucide-react";
import { BulkImportDialog } from "@/components/features/finance/BulkImportDialog";
import { Button } from "@/components/ui/button";
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
import { format, addDays } from "date-fns";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

// ...

export default function AccountsPayablePage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const {
    items: sortedTransactions,
    requestSort,
    sortConfig,
  } = useSortableData(transactions, { key: "dueDate", direction: "asc" });
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Batch Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [openBatches, setOpenBatches] = useState<PaymentBatch[]>([]);
  const [newBatchName, setNewBatchName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [itemsPerPage] = useState(25);
  const [statusFilter, setStatusFilter] = useState<string>("exclude-paid");

  // Use centralized permissions
  const { canDeletePayables, canCreatePayables, onlyOwnPayables } =
    usePermissions();

  const fetchTransactions = useCallback(
    async (isLoadMore = false) => {
      if (!selectedCompany || !user) return;
      try {
        setIsLoading(true);
        // For 'user' role, pass createdBy filter directly to Firestore query
        // This matches the Firestore rules and prevents permission errors
        const filter: {
          type: string;
          excludeStatus?: string[];
          status?: string;
          endDate?: Date;
          createdBy?: string;
        } = {
          type: "payable",
          excludeStatus: statusFilter === "exclude-paid" ? ["paid"] : [],
          status:
            statusFilter !== "all" && statusFilter !== "exclude-paid"
              ? statusFilter
              : undefined,
          endDate: !showAllTransactions ? addDays(new Date(), 7) : undefined,
        };

        if (onlyOwnPayables) {
          filter.createdBy = user.uid;
        }

        const currentLastDoc = isLoadMore ? lastDocRef.current : null;

        const { transactions: newTransactions, lastDoc: newLastDoc } =
          await transactionService.getPaginated(
            selectedCompany.id,
            itemsPerPage,
            currentLastDoc,
            filter
          );

        if (isLoadMore) {
          setTransactions((prev) => [...prev, ...newTransactions]);
        } else {
          setTransactions(newTransactions);
        }

        lastDocRef.current = newLastDoc;
        setHasMore(newTransactions.length === itemsPerPage);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        toast.error("Erro ao carregar transações.");
      } finally {
        setIsLoading(false);
      }
    },
    [
      selectedCompany,
      user,
      onlyOwnPayables,
      statusFilter,
      showAllTransactions,
      itemsPerPage,
    ]
  );

  useEffect(() => {
    fetchTransactions();
    setSelectedIds(new Set()); // Clear selection on company change
  }, [fetchTransactions, selectedCompany]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      // Only select draft transactions
      const draftTransactions = sortedTransactions.filter(
        (t) => t.status === "draft"
      );
      setSelectedIds(new Set(draftTransactions.map((t) => t.id)));
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
      const allBatches = await paymentBatchService.getAll(selectedCompany.id);
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
        (t) => t.status !== "draft"
      );
      if (nonDraftTransactions.length > 0) {
        toast.error(
          "Apenas transações em rascunho podem ser adicionadas ao lote"
        );
        return;
      }

      await paymentBatchService.addTransactions(batchId, selectedTx);
      toast.success("Transações adicionadas ao lote");
      setIsBatchDialogOpen(false);
      setSelectedIds(new Set());
      fetchTransactions();
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
        user.uid
      );
      await handleAddToBatch(batchRef.id);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao criar e adicionar ao lote");
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
            notes: data.notes,
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
          selectedCompany.id
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

  const handleDelete = async () => {
    if (!deleteId || !user || !selectedCompany) return;
    try {
      await transactionService.delete(
        deleteId,
        { uid: user.uid, email: user.email },
        selectedCompany.id
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

  // Filter logic moved to server-side fetchTransactions

  // Pagination logic removed (Server-side pagination used)

  // Reset to first page when filters change
  useEffect(() => {
    // setCurrentPage(1); // Removed
  }, [showAllTransactions, itemsPerPage, statusFilter]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
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
              <Label
                htmlFor="status-filter"
                className="text-sm text-muted-foreground"
              >
                Filtrar:
              </Label>
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
                        sortedTransactions.filter((t) => t.status === "draft")
                          .length > 0 &&
                        sortedTransactions
                          .filter((t) => t.status === "draft")
                          .every((t) => selectedIds.has(t.id))
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
                  sortedTransactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onCheckedChange={() => toggleSelect(t.id)}
                          disabled={t.status !== "draft"}
                        />
                      </TableCell>
                      <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{t.description}</span>
                          {t.batchId && (
                            <Badge
                              variant="outline"
                              className="w-fit text-[10px] mt-1"
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
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleViewDetails(t)}
                            title="Ver detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canDeletePayables && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setDeleteId(t.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
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
              {hasMore && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fetchTransactions(true)}
                  disabled={isLoading}
                >
                  {isLoading ? (
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
        onUpdate={fetchTransactions}
      />

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
