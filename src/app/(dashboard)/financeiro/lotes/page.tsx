"use client";

import { useEffect, useState } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { PaymentBatch } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Plus, Eye, MoreHorizontal } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BatchDetailsDialog } from "@/components/features/finance/BatchDetailsDialog";

export default function PaymentBatchesPage() {
    const { selectedCompany } = useCompany();
    const { user } = useAuth();
    const [batches, setBatches] = useState<PaymentBatch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newBatchName, setNewBatchName] = useState("");

    const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const fetchBatches = async () => {
        if (!selectedCompany) return;
        try {
            setIsLoading(true);
            const data = await paymentBatchService.getAll(selectedCompany.id);
            setBatches(data);
        } catch (error) {
            console.error("Error fetching batches:", error);
            toast.error("Erro ao carregar lotes");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchBatches();
    }, [selectedCompany]);

    const handleCreateBatch = async () => {
        if (!selectedCompany || !user || !newBatchName.trim()) return;
        try {
            await paymentBatchService.create(newBatchName, selectedCompany.id, user.uid);
            toast.success("Lote criado com sucesso");
            setIsCreateOpen(false);
            setNewBatchName("");
            fetchBatches();
        } catch (error) {
            console.error("Error creating batch:", error);
            toast.error("Erro ao criar lote");
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleUpdateStatus = async (batchId: string, status: any) => {
        if (!user) return;
        try {
            await paymentBatchService.updateStatus(batchId, status, user.uid);
            toast.success(`Status atualizado para ${status}`);
            fetchBatches();
        } catch (error) {
            console.error(error);
            toast.error("Erro ao atualizar status");
        }
    };

    const handleViewDetails = (batch: PaymentBatch) => {
        setSelectedBatch(batch);
        setIsDetailsOpen(true);
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "open": return <Badge variant="outline">Aberto</Badge>;
            case "pending_approval": return <Badge variant="secondary">Pendente</Badge>;
            case "approved": return <Badge className="bg-green-500">Aprovado</Badge>;
            case "paid": return <Badge className="bg-blue-500">Pago</Badge>;
            case "rejected": return <Badge variant="destructive">Rejeitado</Badge>;
            default: return <Badge>{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold tracking-tight">Lotes de Pagamento</h1>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> Novo Lote
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Criar Novo Lote</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Nome do Lote</Label>
                                <Input
                                    id="name"
                                    placeholder="Ex: Pagamentos Semana 42"
                                    value={newBatchName}
                                    onChange={(e) => setNewBatchName(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                            <Button onClick={handleCreateBatch}>Criar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Transações</TableHead>
                            <TableHead>Valor Total</TableHead>
                            <TableHead>Criado em</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {batches.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    Nenhum lote encontrado.
                                </TableCell>
                            </TableRow>
                        ) : (
                            batches.map((batch) => (
                                <TableRow key={batch.id}>
                                    <TableCell className="font-medium">{batch.name}</TableCell>
                                    <TableCell>{getStatusBadge(batch.status)}</TableCell>
                                    <TableCell>{batch.transactionIds.length}</TableCell>
                                    <TableCell>{formatCurrency(batch.totalAmount)}</TableCell>
                                    <TableCell>{format(batch.createdAt, "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>Ações</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => handleViewDetails(batch)}>
                                                    Ver Detalhes
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                {batch.status === 'open' && (
                                                    <DropdownMenuItem onClick={() => handleUpdateStatus(batch.id, 'pending_approval')}>
                                                        Enviar para Aprovação
                                                    </DropdownMenuItem>
                                                )}
                                                {batch.status === 'pending_approval' && (
                                                    <DropdownMenuItem onClick={() => handleUpdateStatus(batch.id, 'approved')}>
                                                        Aprovar Lote
                                                    </DropdownMenuItem>
                                                )}
                                                {batch.status === 'approved' && (
                                                    <DropdownMenuItem onClick={() => handleUpdateStatus(batch.id, 'paid')}>
                                                        Marcar como Pago
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <BatchDetailsDialog
                batch={selectedBatch}
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
            />
        </div>
    );
}
