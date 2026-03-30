"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus, Loader2, Trash2, Eye, Upload, Search, X } from "lucide-react";
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
import { recurrenceService } from "@/lib/services/recurrenceService";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import { TransactionFormData } from "@/lib/validations/transaction";
import { useAuth } from "@/components/providers/AuthProvider";
import { format, addDays, startOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { formatCurrency } from "@/lib/utils";
import { DunningStatus } from "@/components/features/finance/DunningStatus";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";

// ...

export default function AccountsReceivablePage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [itemsPerPage] = useState(25);

  const [filterOptions, setFilterOptions] = useState<{
    status: string;
    dateRange: DateRange | undefined;
  }>({
    status: "exclude-paid",
    dateRange: {
      from: startOfDay(new Date()),
      to: addDays(startOfDay(new Date()), 7),
    },
  });

  // ── Search state ─────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [searchResults, setSearchResults] = useState<Transaction[] | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);

  // ── Sort state — drives Firestore ordering directly ──────────────────────
  const [sortField, setSortField] = useState<string>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = useCallback(
    (field: string) => {
      if (field === sortField) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField],
  );

  // Use centralized permissions
  const { canDeleteReceivables, canCreateReceivables } = usePermissions();

  const {
    items: paginatedTransactions,
    hasMore,
    loadMore,
    isLoading: isPaginatedLoading,
    isFetchingNextPage,
    refresh: fetchTransactions,
    updateItem,
  } = usePaginatedQuery<Transaction>({
    queryKey: [
      "receivable-transactions",
      selectedCompany?.id,
      filterOptions.status,
      filterOptions.dateRange?.from?.toISOString(),
      filterOptions.dateRange?.to?.toISOString(),
      sortField,
      sortDirection,
    ],
    queryFn: async (pageSize, lastDoc) => {
      const filter = {
        type: "receivable" as const,
        excludeStatus: filterOptions.status === "exclude-paid" ? ["paid"] : [],
        status:
          filterOptions.status !== "all" &&
          filterOptions.status !== "exclude-paid"
            ? filterOptions.status
            : undefined,
        startDate: filterOptions.dateRange?.from,
        endDate: filterOptions.dateRange?.to,
        sortField,
        sortDirection,
      };

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
    // Desabilita paginação quando o modo de busca está ativo
    enabled: !!selectedCompany && !!user && !debouncedSearchTerm,
  });

  // ── Server-side search ───────────────────────────────────────────────────
  // Delega ao servidor para evitar download da coleção inteira.
  // Filtragem feita em memória no servidor com cap de 5.000 documentos.
  useEffect(() => {
    if (debouncedSearchTerm && selectedCompany && user) {
      const performSearch = async () => {
        setIsSearching(true);
        try {
          const params = new URLSearchParams({
            q: debouncedSearchTerm,
            companyId: selectedCompany.id,
            type: "receivable",
            allDates: "true",
            limit: "50",
          });

          const response = await fetch(
            `/api/internal/transactions/search?${params.toString()}`,
            { credentials: "include" },
          );

          if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
          }

          const json = await response.json();

          // Converte as datas serializadas como ISO string de volta para Date
          const mapped = (json.data ?? []).map(
            (t: Record<string, unknown>) => ({
              ...t,
              dueDate: t.dueDate ? new Date(t.dueDate as string) : new Date(),
              paymentDate: t.paymentDate
                ? new Date(t.paymentDate as string)
                : undefined,
              approvedAt: t.approvedAt
                ? new Date(t.approvedAt as string)
                : undefined,
              releasedAt: t.releasedAt
                ? new Date(t.releasedAt as string)
                : undefined,
              createdAt: t.createdAt
                ? new Date(t.createdAt as string)
                : undefined,
              updatedAt: t.updatedAt
                ? new Date(t.updatedAt as string)
                : undefined,
              approvalTokenExpiresAt: t.approvalTokenExpiresAt
                ? new Date(t.approvalTokenExpiresAt as string)
                : undefined,
            }),
          ) as Transaction[];

          let filteredResults = mapped;

          if (filterOptions.status === "exclude-paid") {
            filteredResults = filteredResults.filter(
              (t) => t.status !== "paid",
            );
          } else if (filterOptions.status !== "all") {
            filteredResults = filteredResults.filter(
              (t) => t.status === filterOptions.status,
            );
          }

          if (filterOptions.dateRange?.from) {
            filteredResults = filteredResults.filter(
              (t) => t.dueDate >= filterOptions.dateRange!.from!,
            );
          }
          if (filterOptions.dateRange?.to) {
            filteredResults = filteredResults.filter(
              (t) => t.dueDate <= filterOptions.dateRange!.to!,
            );
          }

          setSearchResults(filteredResults);
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
  }, [debouncedSearchTerm, selectedCompany, user, filterOptions]);

  // Decide entre resultados de busca e resultados paginados
  const transactions = searchResults ?? paginatedTransactions;
  const isLoading = debouncedSearchTerm ? isSearching : isPaginatedLoading;

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
          type: "receivable",
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
      } else {
        // Normal Transaction
        await transactionService.create(
          data,
          { uid: user.uid, email: user.email },
          selectedCompany.id,
        );
        toast.success("Conta a receber criada com sucesso!");
      }

      await fetchTransactions();
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Error saving transaction:", error);
      toast.error("Erro ao salvar conta a receber.");
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
        // Para ações complexas (pagamento, série de recorrências) faz re-fetch
        fetchTransactions();
      }
    },
    [fetchTransactions, updateItem],
  );

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-emerald-500">Aguardando Recebimento</Badge>;
      case "pending_approval":
        return <Badge className="bg-amber-500">Pendente</Badge>;
      case "paid":
        return <Badge className="bg-blue-500">Recebido</Badge>;
      case "rejected":
        return <Badge className="bg-red-500">Rejeitado</Badge>;
      default:
        return <Badge variant="secondary">Rascunho</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
        <div className="flex gap-2">
          {canCreateReceivables && (
            <>
              <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Importar
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova Receita
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Nova Conta a Receber</DialogTitle>
                  </DialogHeader>
                  <TransactionForm
                    type="receivable"
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
        type="receivable"
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transações</CardTitle>
              <CardDescription>Gerencie suas contas a receber.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Input de busca server-side */}
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="receivable-search"
                  placeholder="Buscar transações..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-[250px] pl-8 pr-8"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Limpar busca"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Select
                value={filterOptions.status}
                onValueChange={(val) =>
                  setFilterOptions((prev) => ({ ...prev, status: val }))
                }
              >
                <SelectTrigger id="status-filter" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclude-paid">
                    Excluir Recebidas
                  </SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="pending_approval">Pendente</SelectItem>
                  <SelectItem value="approved">
                    Aguardando Recebimento
                  </SelectItem>
                  <SelectItem value="paid">Recebido</SelectItem>
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
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => handleSort("dueDate")}
                  >
                    Vencimento{" "}
                    {sortField === "dueDate" &&
                      (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => handleSort("description")}
                  >
                    Descrição{" "}
                    {sortField === "description" &&
                      (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => handleSort("supplierOrClient")}
                  >
                    Cliente{" "}
                    {sortField === "supplierOrClient" &&
                      (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => handleSort("amount")}
                  >
                    Valor{" "}
                    {sortField === "amount" &&
                      (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => handleSort("status")}
                  >
                    Status{" "}
                    {sortField === "status" &&
                      (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      {debouncedSearchTerm
                        ? `Nenhum resultado para "${debouncedSearchTerm}".`
                        : "Nenhuma conta a receber encontrada no período."}
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell>{t.supplierOrClient}</TableCell>
                      <TableCell>{formatCurrency(t.amount)}</TableCell>
                      <TableCell>{getStatusBadge(t.status)}</TableCell>
                      <TableCell>
                        <DunningStatus status={t.dunningStatus} />
                      </TableCell>
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
                          {canDeleteReceivables && (
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
          {!isLoading && !debouncedSearchTerm && (
            <div className="mt-4 flex flex-col gap-4">
              {hasMore ? (
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
              ) : null}
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
