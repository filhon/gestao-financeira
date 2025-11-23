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
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";
import { TransactionFormData } from "@/lib/validations/transaction";
import { useAuth } from "@/components/providers/AuthProvider";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";

import { useCompany } from "@/components/providers/CompanyProvider";

// ...

export default function AccountsPayablePage() {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const fetchTransactions = async () => {
        if (!selectedCompany) return;
        try {
            const data = await transactionService.getAll({ type: "payable", companyId: selectedCompany.id });
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
            await transactionService.create(data, user.uid, selectedCompany.id);
            await fetchTransactions();
            setIsDialogOpen(false);
            toast.success("Conta a pagar criada com sucesso!");
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

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "approved": return <Badge className="bg-emerald-500">Aprovado</Badge>;
            case "pending_approval": return <Badge className="bg-amber-500">Pendente</Badge>;
            case "paid": return <Badge className="bg-blue-500">Pago</Badge>;
            case "rejected": return <Badge className="bg-red-500">Rejeitado</Badge>;
            default: return <Badge variant="secondary">Rascunho</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Contas a Pagar</h1>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            Nova Conta
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Transações</CardTitle>
                    <CardDescription>
                        Gerencie suas contas a pagar e fluxo de aprovação.
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
                                    <TableHead>Vencimento</TableHead>
                                    <TableHead>Descrição</TableHead>
                                    <TableHead>Fornecedor</TableHead>
                                    <TableHead>Valor</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {transactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            Nenhuma conta a pagar encontrada.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    transactions.map((t) => (
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
