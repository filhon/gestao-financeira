"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCompany } from "@/components/providers/CompanyProvider";
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
import { Loader2 } from "lucide-react";
import { useSortableData } from "@/hooks/useSortableData";

export default function SearchPage() {
    const searchParams = useSearchParams();
    const query = searchParams.get("q") || "";
    const { selectedCompany } = useCompany();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const { items: sortedTransactions, requestSort, sortConfig } = useSortableData(transactions);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchAndFilter = async () => {
            if (!selectedCompany || !query) {
                setTransactions([]);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            try {
                // Fetch all transactions for the company
                // In a real app with many records, this should be a backend search
                const allTransactions = await transactionService.getAll({ companyId: selectedCompany.id });

                const lowerQuery = query.toLowerCase();
                const filtered = allTransactions.filter((t) =>
                    t.description.toLowerCase().includes(lowerQuery) ||
                    t.category?.toLowerCase().includes(lowerQuery) ||
                    t.amount.toString().includes(query)
                );

                setTransactions(filtered);
            } catch (error) {
                console.error("Error searching transactions:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAndFilter();
    }, [selectedCompany, query]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "paid":
            case "received":
                return <Badge className="bg-green-500">Concluído</Badge>;
            case "pending":
                return <Badge variant="outline" className="text-yellow-600 border-yellow-600">Pendente</Badge>;
            case "late":
                return <Badge variant="destructive">Atrasado</Badge>;
            default:
                return <Badge variant="secondary">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Resultados da Busca</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Transações encontradas</CardTitle>
                    <CardDescription>
                        Resultados para: <span className="font-medium">"{query}"</span>
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhuma transação encontrada.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('description')}
                                    >
                                        Descrição {sortConfig?.key === 'description' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('category')}
                                    >
                                        Categoria {sortConfig?.key === 'category' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('dueDate')}
                                    >
                                        Vencimento {sortConfig?.key === 'dueDate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('status')}
                                    >
                                        Status {sortConfig?.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="text-right cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('amount')}
                                    >
                                        Valor {sortConfig?.key === 'amount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedTransactions.map((transaction) => (
                                    <TableRow key={transaction.id}>
                                        <TableCell className="font-medium">{transaction.description}</TableCell>
                                        <TableCell>{transaction.category}</TableCell>
                                        <TableCell>
                                            {format(transaction.dueDate, "dd/MM/yyyy", { locale: ptBR })}
                                        </TableCell>
                                        <TableCell>{getStatusBadge(transaction.status)}</TableCell>
                                        <TableCell className={`text-right font-medium ${transaction.type === "payable" ? "text-red-600" : "text-green-600"
                                            }`}>
                                            {transaction.type === "payable" ? "-" : "+"}
                                            {formatCurrency(transaction.amount)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
