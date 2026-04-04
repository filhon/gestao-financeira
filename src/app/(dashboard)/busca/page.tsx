"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import { transactionService } from "@/lib/services/transactionService";
import { Transaction } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Loader2,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  TrendingDown,
  TrendingUp,
  FileX,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary/15 text-primary rounded-[2px] px-0.5 font-medium not-italic">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function SortIcon({
  column,
  sortConfig,
}: {
  column: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
}) {
  if (sortConfig?.key !== column)
    return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40 inline-block" />;
  return sortConfig.direction === "asc" ? (
    <ArrowUp className="h-3 w-3 ml-1 text-primary inline-block" />
  ) : (
    <ArrowDown className="h-3 w-3 ml-1 text-primary inline-block" />
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "paid":
    case "received":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-500/20">
          Concluído
        </Badge>
      );
    case "pending":
      return (
        <Badge
          variant="outline"
          className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950"
        >
          Pendente
        </Badge>
      );
    case "pending_approval":
      return (
        <Badge
          variant="outline"
          className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950"
        >
          Ag. Aprovação
        </Badge>
      );
    case "approved":
      return (
        <Badge
          variant="outline"
          className="text-indigo-600 dark:text-indigo-400 border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950"
        >
          Aprovado
        </Badge>
      );
    case "pending_authorization":
      return (
        <Badge
          variant="outline"
          className="text-violet-600 dark:text-violet-400 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950"
        >
          Ag. Autorização
        </Badge>
      );
    case "authorized":
      return (
        <Badge
          variant="outline"
          className="text-teal-600 dark:text-teal-400 border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950"
        >
          Autorizado
        </Badge>
      );
    case "late":
      return <Badge variant="destructive">Atrasado</Badge>;
    case "rejected":
      return (
        <Badge
          variant="outline"
          className="text-destructive border-destructive/40 bg-destructive/5"
        >
          Rejeitado
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getTransactionHref(transaction: Transaction): string {
  return transaction.type === "payable"
    ? `/financeiro/contas-pagar`
    : `/financeiro/contas-receber`;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const {
    items: sortedTransactions,
    requestSort,
    sortConfig,
  } = useSortableData(transactions);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAndFilter = useCallback(async () => {
    if (!selectedCompany || !query || !user) {
      setTransactions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const filter: { companyId: string; createdBy?: string } = {
        companyId: selectedCompany.id,
      };
      if (onlyOwnPayables) {
        filter.createdBy = user.uid;
      }

      const allTransactions = await transactionService.getAll(filter);

      const lowerQuery = query.toLowerCase();
      const filtered = allTransactions.filter(
        (t) =>
          t.description.toLowerCase().includes(lowerQuery) ||
          t.supplierOrClient?.toLowerCase()?.includes(lowerQuery) ||
          t.requestOrigin?.name?.toLowerCase()?.includes(lowerQuery) ||
          t.amount.toString().includes(query)
      );

      setTransactions(filtered);
    } catch (error) {
      console.error("Error searching transactions:", error);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, query, user, onlyOwnPayables]);

  useEffect(() => {
    fetchAndFilter();
  }, [fetchAndFilter]);

  const payables = sortedTransactions.filter((t) => t.type === "payable");
  const receivables = sortedTransactions.filter((t) => t.type === "receivable");
  const totalPayable = payables.reduce((acc, t) => acc + t.amount, 0);
  const totalReceivable = receivables.reduce((acc, t) => acc + t.amount, 0);

  const hasResults = !isLoading && transactions.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Resultados da Busca
        </h1>
        <p className="text-muted-foreground">
          {query
            ? `Mostrando resultados para "${query}"`
            : "Use a barra de busca para pesquisar transações."}
        </p>
      </div>

      {/* Summary cards — only when there are results */}
      {hasResults && (
        <div
          className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationFillMode: "both" }}
        >
          {/* Payables summary */}
          <div className="flex items-center gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/50">
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total a pagar</p>
              <p className="text-sm font-semibold font-financial text-red-700 dark:text-red-400">
                {formatCurrency(totalPayable)}
              </p>
            </div>
            <Badge variant="secondary" className="ml-auto shrink-0 text-[11px]">
              {payables.length}
            </Badge>
          </div>

          {/* Receivables summary */}
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total a receber</p>
              <p className="text-sm font-semibold font-financial text-emerald-700 dark:text-emerald-400">
                {formatCurrency(totalReceivable)}
              </p>
            </div>
            <Badge variant="secondary" className="ml-auto shrink-0 text-[11px]">
              {receivables.length}
            </Badge>
          </div>
        </div>
      )}

      {/* Results card */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "60ms", animationFillMode: "both" }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Transações encontradas</CardTitle>
            <CardDescription>
              {isLoading
                ? "Buscando..."
                : hasResults
                  ? `${transactions.length} resultado${transactions.length !== 1 ? "s" : ""} para "${query}"`
                  : query
                    ? `Nenhuma transação encontrada para "${query}"`
                    : "Resultados da busca aparecerão aqui."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Buscando transações...
                </p>
              </div>
            ) : !query ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  Nenhum termo de busca
                </p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Use a barra de busca no topo (Ctrl+K) para pesquisar por
                  descrição, fornecedor, cliente ou valor.
                </p>
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                  <FileX className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  Nenhum resultado encontrado
                </p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Não encontramos transações para{" "}
                  <span className="font-medium text-foreground">
                    &ldquo;{query}&rdquo;
                  </span>
                  . Tente outros termos como descrição, fornecedor ou valor.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead
                      className="cursor-pointer hover:text-foreground select-none pl-6"
                      onClick={() => requestSort("description")}
                    >
                      <span className="inline-flex items-center">
                        Descrição
                        <SortIcon column="description" sortConfig={sortConfig} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground select-none"
                      onClick={() => requestSort("supplierOrClient")}
                    >
                      <span className="inline-flex items-center">
                        Fornecedor / Cliente
                        <SortIcon
                          column="supplierOrClient"
                          sortConfig={sortConfig}
                        />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground select-none"
                      onClick={() => requestSort("dueDate")}
                    >
                      <span className="inline-flex items-center">
                        Vencimento
                        <SortIcon column="dueDate" sortConfig={sortConfig} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground select-none"
                      onClick={() => requestSort("status")}
                    >
                      <span className="inline-flex items-center">
                        Status
                        <SortIcon column="status" sortConfig={sortConfig} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-right cursor-pointer hover:text-foreground select-none pr-6"
                      onClick={() => requestSort("amount")}
                    >
                      <span className="inline-flex items-center justify-end w-full">
                        Valor
                        <SortIcon column="amount" sortConfig={sortConfig} />
                      </span>
                    </TableHead>
                    <TableHead className="w-8 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTransactions.map((transaction, i) => {
                    const isPayable = transaction.type === "payable";
                    const originLabel =
                      transaction.supplierOrClient ||
                      transaction.requestOrigin?.name ||
                      null;

                    return (
                      <TableRow
                        key={transaction.id}
                        className={cn(
                          "group cursor-pointer animate-in fade-in-0 slide-in-from-bottom-1"
                        )}
                        style={{
                          animationDelay: `${i * 30}ms`,
                          animationFillMode: "both",
                        }}
                      >
                        <TableCell className="font-medium pl-6">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                isPayable
                                  ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
                                  : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                              )}
                            >
                              {isPayable ? "Pagar" : "Receber"}
                            </span>
                            <span className="truncate max-w-[220px]">
                              <HighlightedText
                                text={transaction.description}
                                query={query}
                              />
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {originLabel ? (
                            <HighlightedText text={originLabel} query={query} />
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums text-sm">
                          {format(transaction.dueDate, "dd/MM/yyyy", {
                            locale: ptBR,
                          })}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(transaction.status)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold font-financial pr-6",
                            isPayable
                              ? "text-red-600 dark:text-red-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {isPayable ? "−" : "+"}
                          {formatCurrency(transaction.amount)}
                        </TableCell>
                        <TableCell className="pr-4">
                          <Link
                            href={getTransactionHref(transaction)}
                            className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Ver transações"
                          >
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
