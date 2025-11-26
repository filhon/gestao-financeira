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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { PaymentBatch } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
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

    // Batch Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
    const [openBatches, setOpenBatches] = useState<PaymentBatch[]>([]);
    const [newBatchName, setNewBatchName] = useState("");

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
        setSelectedIds(new Set()); // Clear selection on company change
    }, [selectedCompany]);

    const toggleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(transactions.map(t => t.id)));
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
            setOpenBatches(allBatches.filter(b => b.status === 'open'));
        } catch (error) {
            toast.error("Erro ao carregar lotes");
        }
    };

    const handleAddToBatch = async (batchId: string) => {
        try {
            const selectedTx = transactions.filter(t => selectedIds.has(t.id));
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
            const batchRef = await paymentBatchService.create(newBatchName, selectedCompany.id, user.uid);
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
            await transactionService.create(data, { uid: user.uid, email: user.email }, selectedCompany.id);
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
                <div className="flex gap-2">
                    {selectedIds.size > 0 && (
                        <Dialog open={isBatchDialogOpen} onOpenChange={setIsBatchDialogOpen}>
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
                                            <p className="text-sm text-muted-foreground">Nenhum lote aberto encontrado.</p>
                                        ) : (
                                            <div className="grid gap-2">
                                                {openBatches.map(batch => (
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
                                            <span className="bg-background px-2 text-muted-foreground">Ou crie um novo</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="Nome do novo lote"
                                            value={newBatchName}
                                            onChange={e => setNewBatchName(e.target.value)}
                                        />
                                        <Button onClick={handleCreateAndAddToBatch}>Criar e Adicionar</Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
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
                                    <TableHead className="w-[50px]">
                                        <Checkbox
                                            checked={transactions.length > 0 && selectedIds.size === transactions.length}
                                            onCheckedChange={toggleSelectAll}
                                        />
                                    </TableHead>
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
                                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                                            Nenhuma conta a pagar encontrada.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    transactions.map((t) => (
                                        <TableRow key={t.id}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={selectedIds.has(t.id)}
                                                    onCheckedChange={() => toggleSelect(t.id)}
                                                />
                                            </TableCell>
                                            <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span>{t.description}</span>
                                                    {t.batchId && (
                                                        <Badge variant="outline" className="w-fit text-[10px] mt-1">
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
