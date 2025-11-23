"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Transaction, TransactionStatus } from "@/lib/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/components/providers/AuthProvider";
import { transactionService } from "@/lib/services/transactionService";
import { emailService } from "@/lib/services/emailService";
import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Banknote, Send } from "lucide-react";
import { db } from "@/lib/firebase/client";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { toast } from "sonner";

interface TransactionDetailsDialogProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: () => void;
}

export function TransactionDetailsDialog({
    transaction,
    isOpen,
    onClose,
    onUpdate,
}: TransactionDetailsDialogProps) {
    const { user } = useAuth();
    const [isProcessing, setIsProcessing] = useState(false);

    if (!transaction) return null;

    const handleStatusUpdate = async (newStatus: TransactionStatus) => {
        if (!user) return;
        try {
            setIsProcessing(true);
            await transactionService.updateStatus(transaction.id, newStatus, user.uid, user.role);

            // Email Notifications
            try {
                if (newStatus === 'pending_approval') {
                    // Notify Approvers
                    const q = query(collection(db, "users"), where("role", "in", ["admin", "approver", "financial_manager"]));
                    const querySnapshot = await getDocs(q);
                    const approverEmails = querySnapshot.docs.map(doc => doc.data().email).filter(email => email);

                    if (approverEmails.length > 0) {
                        // Send to the first found for demo to avoid spam/limits
                        await emailService.sendApprovalRequest(transaction, approverEmails[0]);
                    }
                    toast.success("Solicitação enviada para aprovação!");
                } else {
                    // Notify Creator (Status Update)
                    const userDoc = await getDoc(doc(db, "users", transaction.createdBy));
                    const creatorEmail = userDoc.data()?.email;
                    if (creatorEmail) {
                        await emailService.sendStatusUpdate(transaction, creatorEmail, user.displayName);
                    }

                    if (newStatus === 'approved') toast.success("Transação aprovada com sucesso!");
                    else if (newStatus === 'rejected') toast.info("Transação rejeitada.");
                    else if (newStatus === 'paid') toast.success("Pagamento/Recebimento confirmado!");
                }
            } catch (emailError) {
                console.error("Failed to send email notification:", emailError);
                toast.warning("Status atualizado, mas houve erro ao enviar e-mail.");
            }

            onUpdate();
            onClose();
        } catch (error) {
            console.error("Error updating status:", error);
            toast.error("Erro ao atualizar status. Tente novamente.");
        } finally {
            setIsProcessing(false);
        }
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

    const canApprove = user?.role === 'admin' || user?.role === 'approver' || user?.role === 'financial_manager';
    const canPay = user?.role === 'admin' || user?.role === 'releaser' || user?.role === 'financial_manager';

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="flex items-center justify-between pr-8">
                        <DialogTitle>Detalhes da Transação</DialogTitle>
                        {getStatusBadge(transaction.status)}
                    </div>
                    <DialogDescription>
                        ID: {transaction.id}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Header Info */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground">Descrição</h4>
                            <p className="text-lg font-semibold">{transaction.description}</p>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground">Valor</h4>
                            <p className="text-lg font-semibold text-emerald-600">
                                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(transaction.amount)}
                            </p>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground">
                                {transaction.type === 'payable' ? 'Fornecedor' : 'Cliente'}
                            </h4>
                            <p className="text-base">{transaction.supplierOrClient}</p>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground">Vencimento</h4>
                            <p className="text-base">{format(transaction.dueDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</p>
                        </div>
                    </div>

                    <Separator />

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground">Solicitado por</h4>
                            <p className="text-sm">
                                {transaction.requestOrigin.name} ({transaction.requestOrigin.type === 'director' ? 'Diretoria' : transaction.requestOrigin.type === 'department' ? 'Departamento' : 'Setor'})
                            </p>
                        </div>
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground">Método de Pagamento</h4>
                            <p className="text-sm capitalize">{transaction.paymentMethod || '-'}</p>
                        </div>
                        {transaction.recurrence?.isRecurring && (
                            <div className="col-span-2">
                                <h4 className="text-sm font-medium text-muted-foreground">Recorrência</h4>
                                <p className="text-sm">
                                    Parcela {transaction.recurrence.currentInstallment} de {transaction.recurrence.totalInstallments || '?'} ({transaction.recurrence.frequency === 'monthly' ? 'Mensal' : 'Outro'})
                                </p>
                            </div>
                        )}
                    </div>

                    <Separator />

                    {/* Cost Centers */}
                    <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Rateio por Centro de Custo</h4>
                        <div className="space-y-2">
                            {transaction.costCenterAllocation.map((alloc, index) => (
                                <div key={index} className="flex justify-between text-sm border p-2 rounded">
                                    <span>Centro de Custo ID: {alloc.costCenterId}</span> {/* In a real app, we'd look up the name */}
                                    <div className="flex gap-4">
                                        <span>{alloc.percentage}%</span>
                                        <span className="font-medium">
                                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(alloc.amount)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Attachments */}
                    {transaction.attachments.length > 0 && (
                        <>
                            <Separator />
                            <div>
                                <h4 className="text-sm font-medium text-muted-foreground mb-2">Anexos</h4>
                                <div className="flex flex-wrap gap-2">
                                    {transaction.attachments.map((att) => (
                                        <a
                                            key={att.id}
                                            href={att.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-sm text-blue-600 hover:underline bg-blue-50 px-2 py-1 rounded"
                                        >
                                            {att.name}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Notes */}
                    {transaction.notes && (
                        <>
                            <Separator />
                            <div>
                                <h4 className="text-sm font-medium text-muted-foreground">Observações</h4>
                                <p className="text-sm whitespace-pre-wrap">{transaction.notes}</p>
                            </div>
                        </>
                    )}

                    {/* Approval Info */}
                    {(transaction.approvedBy || transaction.releasedBy) && (
                        <>
                            <Separator />
                            <div className="text-xs text-muted-foreground space-y-1">
                                {transaction.approvedBy && <p>Aprovado por: {transaction.approvedBy} em {transaction.approvedAt ? format(transaction.approvedAt, "dd/MM/yyyy HH:mm") : '-'}</p>}
                                {transaction.releasedBy && <p>Pago/Liberado por: {transaction.releasedBy} em {transaction.releasedAt ? format(transaction.releasedAt, "dd/MM/yyyy HH:mm") : '-'}</p>}
                            </div>
                        </>
                    )}

                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {/* Actions based on status */}

                    {transaction.status === 'draft' && (
                        <Button
                            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleStatusUpdate('pending_approval')}
                            disabled={isProcessing}
                        >
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Enviar para Aprovação
                        </Button>
                    )}

                    {transaction.status === 'pending_approval' && canApprove && (
                        <div className="flex gap-2 w-full sm:w-auto">
                            <Button
                                variant="destructive"
                                onClick={() => handleStatusUpdate('rejected')}
                                disabled={isProcessing}
                            >
                                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                Rejeitar
                            </Button>
                            <Button
                                className="bg-emerald-600 hover:bg-emerald-700"
                                onClick={() => handleStatusUpdate('approved')}
                                disabled={isProcessing}
                            >
                                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Aprovar
                            </Button>
                        </div>
                    )}

                    {transaction.status === 'approved' && canPay && (
                        <Button
                            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleStatusUpdate('paid')}
                            disabled={isProcessing}
                        >
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                            {transaction.type === 'payable' ? 'Confirmar Pagamento' : 'Confirmar Recebimento'}
                        </Button>
                    )}

                    <Button variant="outline" onClick={onClose} disabled={isProcessing}>
                        Fechar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
