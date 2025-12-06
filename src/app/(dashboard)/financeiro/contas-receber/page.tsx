"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useSortableData } from "@/hooks/useSortableData";

// ...

export default function AccountsReceivablePage() {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const { items: sortedTransactions, requestSort, sortConfig } = useSortableData(transactions);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const fetchTransactions = async () => {
        if (!selectedCompany) return;
        try {
            const data = await transactionService.getAll({ type: "receivable", companyId: selectedCompany.id });
            setTransactions(data);
        } catch (error) {
            console.error("Error fetching transactions:", error);
            toast.error("Erro ao carregar transações.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTransactions();
    }, [selectedCompany]);

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
                    type: 'receivable',
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
                    }
                });
                toast.success("Recorrência criada com sucesso!");

                // Trigger processing immediately
                await recurrenceService.processDueTemplates(selectedCompany.id, { uid: user.uid, email: user.email });
            } else {
                // Normal Transaction
                await transactionService.create(data, { uid: user.uid, email: user.email }, selectedCompany.id);
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

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "approved": return <Badge className="bg-emerald-500">Aprovado</Badge>;
            case "pending_approval": return <Badge className="bg-amber-500">Pendente</Badge>;
            case "paid": return <Badge className="bg-blue-500">Recebido</Badge>;
            case "rejected": return <Badge className="bg-red-500">Rejeitado</Badge>;
            default: return <Badge variant="secondary">Rascunho</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
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
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Transações</CardTitle>
                    <CardDescription>
                        Gerencie suas contas a receber.
                    </CardDescription>
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
                                        onClick={() => requestSort('dueDate')}
                                    >
                                        Vencimento {sortConfig?.key === 'dueDate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('description')}
                                    >
                                        Descrição {sortConfig?.key === 'description' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('supplierOrClient')}
                                    >
                                        Cliente {sortConfig?.key === 'supplierOrClient' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('amount')}
                                    >
                                        Valor {sortConfig?.key === 'amount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('status')}
                                    >
                                        Status {sortConfig?.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedTransactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            Nenhuma conta a receber encontrada.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    sortedTransactions.map((t) => (
                                        <TableRow key={t.id}>
                                            <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                                            <TableCell>{t.description}</TableCell>
                                            <TableCell>{t.supplierOrClient}</TableCell>
                                            <TableCell>
                                                {new Intl.NumberFormat("pt-BR", {
                                                    style: "currency",
                                                    currency: "BRL",
                                                }).format(t.amount)}
                                            </TableCell>
                                            <TableCell>{getStatusBadge(t.status)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleViewDetails(t)}
                                                >
                                                    Detalhes
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <TransactionDetailsDialog
                transaction={selectedTransaction}
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                onUpdate={fetchTransactions}
            />
        </div>
    );
}
