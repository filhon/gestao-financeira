import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentBatch, Transaction } from "@/lib/types";
import { useEffect, useState } from "react";
import { transactionService } from "@/lib/services/transactionService";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";

interface BatchDetailsDialogProps {
    batch: PaymentBatch | null;
    isOpen: boolean;
    onClose: () => void;
}

export function BatchDetailsDialog({ batch, isOpen, onClose }: BatchDetailsDialogProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const loadTransactions = async () => {
            if (batch && isOpen) {
                setIsLoading(true);
                try {
                    const data = await transactionService.getAll({ batchId: batch.id });
                    setTransactions(data);
                } catch (error) {
                    console.error("Error loading batch transactions", error);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        loadTransactions();
    }, [batch, isOpen]);

    if (!batch) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Detalhes do Lote: {batch.name}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Total: {formatCurrency(batch.totalAmount)}</span>
                        <span>Itens: {batch.transactionIds.length}</span>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                    ) : (
                        <div className="border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Vencimento</TableHead>
                                        <TableHead>Descrição</TableHead>
                                        <TableHead>Fornecedor</TableHead>
                                        <TableHead className="text-right">Valor</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {transactions.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                                                Nenhuma transação encontrada neste lote.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        transactions.map(t => (
                                            <TableRow key={t.id}>
                                                <TableCell>{format(t.dueDate, "dd/MM/yyyy")}</TableCell>
                                                <TableCell>{t.description}</TableCell>
                                                <TableCell>{t.supplierOrClient}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(t.amount)}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
