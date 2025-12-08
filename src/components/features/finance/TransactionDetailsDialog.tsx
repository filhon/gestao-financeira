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
import { useCompany } from "@/components/providers/CompanyProvider";
import { transactionService } from "@/lib/services/transactionService";
import { emailService } from "@/lib/services/emailService";
import { costCenterService } from "@/lib/services/costCenterService";
import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, Banknote, Send, CalendarIcon, Edit2 } from "lucide-react";
import { PaymentDialog } from "./PaymentDialog";
import { formatCurrency } from "@/lib/utils";
import { db } from "@/lib/firebase/client";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { toast } from "sonner";
import { TransactionForm } from "./TransactionForm"; // Import Form
import { TransactionFormData } from "@/lib/validations/transaction";
import { RecurrenceUpdateDialog } from "./RecurrenceUpdateDialog";
import { usePermissions } from "@/hooks/usePermissions";

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
    const { selectedCompany } = useCompany();
    const {
        canEditPayables,
        canApprovePayables,
        canPayPayables,
        canEditReceivables
    } = usePermissions();

    const [isProcessing, setIsProcessing] = useState(false);
    const [isEditing, setIsEditing] = useState(false); // Edit Mode State

    const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
    const [isRecurrenceUpdateDialogOpen, setIsRecurrenceUpdateDialogOpen] = useState(false); // Recurrence Dialog State
    const [pendingUpdateData, setPendingUpdateData] = useState<TransactionFormData | null>(null); // Store data while asking scope

    const [costCenterNames, setCostCenterNames] = useState<Record<string, string>>({});
    const [userNames, setUserNames] = useState<Record<string, string>>({});

    // Reset edit mode when dialog closes or transaction changes
    useEffect(() => {
        if (!isOpen) {
            setIsEditing(false);
            setPendingUpdateData(null);
            setIsRecurrenceUpdateDialogOpen(false);
        }
    }, [isOpen, transaction]);

    useEffect(() => {
        const fetchNames = async () => {
            if (!transaction || !selectedCompany) return;

            const newCostCenterNames: Record<string, string> = {};
            const newUserNames: Record<string, string> = {};
            let hasNewData = false;

            // Fetch Cost Center Names
            if (transaction.costCenterAllocation) {
                for (const alloc of transaction.costCenterAllocation) {
                    try {
                        const cc = await costCenterService.getById(alloc.costCenterId);
                        if (cc) {
                            newCostCenterNames[alloc.costCenterId] = cc.name;
                            hasNewData = true;
                        }
                    } catch (e) {
                        console.error(`Failed to fetch cost center ${alloc.costCenterId}`, e);
                    }
                }
            }

            // Fetch User Names
            const userIdsToFetch = [transaction.approvedBy, transaction.releasedBy].filter(Boolean) as string[];
            for (const uid of userIdsToFetch) {
                try {
                    const userDoc = await getDoc(doc(db, "users", uid));
                    if (userDoc.exists()) {
                        newUserNames[uid] = userDoc.data().displayName || userDoc.data().email || uid;
                        hasNewData = true;
                    }
                } catch (e) {
                    console.error(`Failed to fetch user ${uid}`, e);
                }
            }

            if (hasNewData) {
                setCostCenterNames(newCostCenterNames);
                setUserNames(newUserNames);
            }
        };

        if (isOpen && transaction) {
            fetchNames();
        }
    }, [transaction?.id, isOpen, selectedCompany]);

    if (!transaction || !selectedCompany) return null;

    const isPayable = transaction.type === 'payable';

    // Approval/Payment logic
    const canEdit = isPayable ? canEditPayables : canEditReceivables;
    const canApprove = isPayable ? canApprovePayables : canEditReceivables;
    const canPay = isPayable ? canPayPayables : canEditReceivables;

    const handleStatusUpdate = async (newStatus: TransactionStatus) => {
        if (!user) return;
        try {
            setIsProcessing(true);
            await transactionService.updateStatus(transaction.id, newStatus, { uid: user.uid, email: user.email }, selectedCompany.id);
            // ... (Email logic omitted for brevity, keeping existing notification logic implies just calling updateStatus is enough if service handles it, but service doesn't send emails for status updates fully yet? Keeping existing logic)
            // Email Notifications (Re-implementing simplified for brevity as it was lengthy in original)
            // For now assume service handles db update and we just toast.
            // Actually, the original code had heavy email logic here. I should probably keep it or refactor.
            // To be safe and not break features, I will retain the email logic block.

            try {
                if (newStatus === 'pending_approval') {
                    const q = query(collection(db, "users"), where("role", "in", ["admin", "approver", "financial_manager"]));
                    const querySnapshot = await getDocs(q);
                    const approverEmails = querySnapshot.docs.map(doc => doc.data().email).filter(email => email);
                    if (approverEmails.length > 0) {
                        await emailService.sendApprovalRequest(transaction, approverEmails[0]);
                    }
                    toast.success("Solicitação enviada para aprovação!");
                } else {
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


    const handleEditSubmit = async (data: TransactionFormData) => {
        if (!user) return;

        // Check if part of a group (installments/parcelas)
        if (transaction.installments?.groupId) {
            setPendingUpdateData(data);
            setIsRecurrenceUpdateDialogOpen(true);
            return;
        }

        // Single Update
        try {
            setIsProcessing(true);
            await transactionService.update(transaction.id, data, { uid: user.uid, email: user.email }, selectedCompany.id);
            toast.success("Transação atualizada com sucesso!");
            onUpdate();
            setIsEditing(false); // Exit edit mode
            // Don't close dialog, let user see changes? Or close? Original req doesn't specify.
            // Behaving like "Save" -> usually keeps context or goes back. Let's keep dialog open in View mode.
        } catch (error) {
            console.error("Error updating transaction:", error);
            toast.error("Erro ao atualizar transação.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRecurrenceConfirm = async (scope: "single" | "series") => {
        if (!user || !pendingUpdateData) return;

        try {
            setIsProcessing(true);
            await transactionService.updateRecurrence(
                transaction,
                pendingUpdateData,
                scope,
                { uid: user.uid, email: user.email },
                selectedCompany.id
            );
            toast.success("Transações atualizadas com sucesso!");
            onUpdate();
            setIsEditing(false);
            setIsRecurrenceUpdateDialogOpen(false);
        } catch (error) {
            console.error("Error updating recurrence:", error);
            toast.error("Erro ao atualizar transações recorrentes.");
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

    const handlePaymentConfirm = async (data: { paymentDate: Date; finalAmount: number; discount: number; interest: number }) => {
        if (!user || !selectedCompany) return;
        try {
            setIsProcessing(true);
            await transactionService.settle(transaction.id, data, { uid: user.uid, email: user.email }, selectedCompany.id);
            toast.success("Pagamento/Recebimento registrado com sucesso!");
            onUpdate();
            onClose();
        } catch (error) {
            console.error("Error settling transaction:", error);
            toast.error("Erro ao registrar pagamento.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <div className="flex items-center justify-between pr-8">
                            <DialogTitle>
                                {isEditing ? "Editar Transação" : "Detalhes da Transação"}
                            </DialogTitle>
                            {!isEditing && getStatusBadge(transaction.status)}
                        </div>
                        <DialogDescription>
                            ID: {transaction.id}
                        </DialogDescription>
                    </DialogHeader>

                    {isEditing ? (
                        <div className="py-4">
                            <TransactionForm
                                type={transaction.type}
                                defaultValues={{
                                    ...transaction,
                                    // Ensure dates are Dates
                                    dueDate: transaction.dueDate ? new Date(transaction.dueDate) : new Date(),
                                    paymentDate: transaction.paymentDate ? new Date(transaction.paymentDate) : undefined,
                                    // Map transaction structure to form structure if needed
                                    // Transaction has proper structure mostly.
                                }}
                                onSubmit={handleEditSubmit}
                                onCancel={() => setIsEditing(false)}
                                isLoading={isProcessing}
                            />
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-6 py-4">
                                {/* ... [Existing Details View Code - Keeping same logic] ... */}
                                {/* Reuse previous details view code here for brevity, inserting exactly what was there */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h4 className="text-sm font-medium text-muted-foreground">Descrição</h4>
                                        <p className="text-lg font-semibold">{transaction.description}</p>
                                    </div>
                                    <div className="text-right">
                                        <h4 className="text-sm font-medium text-muted-foreground">Valor</h4>
                                        <p className={`text-lg font-semibold ${transaction.type === 'payable' ? 'text-red-600' : 'text-green-600'}`}>
                                            {transaction.type === 'payable' ? '-' : '+'}
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
                                        <p className="text-base flex items-center gap-2 justify-end">
                                            <CalendarIcon className="h-4 w-4" />
                                            {format(transaction.dueDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                                        </p>
                                    </div>
                                </div>

                                <Separator />

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <h4 className="text-sm font-medium text-muted-foreground">Solicitado por</h4>
                                        <p className="text-sm">
                                            {transaction.requestOrigin?.name || '-'} ({transaction.requestOrigin?.type === 'director' ? 'Diretoria' : transaction.requestOrigin?.type === 'department' ? 'Departamento' : transaction.requestOrigin?.type === 'sector' ? 'Setor' : '-'})
                                        </p>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-medium text-muted-foreground">Método de Pagamento</h4>
                                        <p className="text-sm capitalize">{transaction.paymentMethod || '-'}</p>
                                    </div>

                                    {transaction.paymentDate && (
                                        <div>
                                            <h4 className="text-sm font-medium text-muted-foreground">Data de Pagamento</h4>
                                            <p className="text-sm flex items-center gap-2 text-blue-600 font-medium">
                                                <CheckCircle2 className="h-4 w-4" />
                                                {format(transaction.paymentDate, "dd/MM/yyyy", { locale: ptBR })}
                                            </p>
                                        </div>
                                    )}

                                    {transaction.finalAmount !== undefined && (
                                        <div>
                                            <h4 className="text-sm font-medium text-muted-foreground">Valor Final</h4>
                                            <p className="text-sm font-medium">{formatCurrency(transaction.finalAmount)}</p>
                                        </div>
                                    )}

                                    {transaction.recurrence?.isRecurring && (
                                        <div className="col-span-2">
                                            <h4 className="text-sm font-medium text-muted-foreground">Recorrência</h4>
                                            <p className="text-sm">
                                                {transaction.installments ? (
                                                    `Parcela ${transaction.installments.current} de ${transaction.installments.total}`
                                                ) : (
                                                    transaction.recurrence.frequency === 'monthly' ? 'Mensal' : 'Outro'
                                                )}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <Separator />

                                <div>
                                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Rateio por Centro de Custo</h4>
                                    <div className="space-y-2">
                                        {transaction.costCenterAllocation?.map((alloc, index) => (
                                            <div key={index} className="flex justify-between text-sm border p-2 rounded">
                                                <span>{costCenterNames[alloc.costCenterId] || alloc.costCenterId}</span>
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

                                {transaction.attachments && transaction.attachments.length > 0 && (
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

                                {transaction.notes && (
                                    <>
                                        <Separator />
                                        <div>
                                            <h4 className="text-sm font-medium text-muted-foreground">Observações</h4>
                                            <p className="text-sm whitespace-pre-wrap">{transaction.notes}</p>
                                        </div>
                                    </>
                                )}

                                {(transaction.approvedBy || transaction.releasedBy) && (
                                    <>
                                        <Separator />
                                        <div className="text-xs text-muted-foreground space-y-1">
                                            {transaction.approvedBy && <p>Aprovado por: {userNames[transaction.approvedBy] || transaction.approvedBy} em {transaction.approvedAt ? format(transaction.approvedAt, "dd/MM/yyyy HH:mm") : '-'}</p>}
                                            {transaction.releasedBy && <p>Pago/Liberado por: {userNames[transaction.releasedBy] || transaction.releasedBy} em {transaction.releasedAt ? format(transaction.releasedAt, "dd/MM/yyyy HH:mm") : '-'}</p>}
                                        </div>
                                    </>
                                )}
                            </div>

                            <DialogFooter className="gap-2 sm:gap-2">
                                {canEdit && (
                                    <Button
                                        variant="outline"
                                        onClick={() => setIsEditing(true)}
                                        disabled={isProcessing}
                                    >
                                        <Edit2 className="mr-2 h-4 w-4" />
                                        Editar
                                    </Button>
                                )}

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
                                        onClick={() => setIsPaymentDialogOpen(true)}
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
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <PaymentDialog
                isOpen={isPaymentDialogOpen}
                onClose={() => setIsPaymentDialogOpen(false)}
                onConfirm={handlePaymentConfirm}
                transaction={transaction}
                type={transaction.type === 'payable' ? 'pay' : 'receive'}
            />

            <RecurrenceUpdateDialog
                isOpen={isRecurrenceUpdateDialogOpen}
                onClose={() => setIsRecurrenceUpdateDialogOpen(false)}
                onConfirm={handleRecurrenceConfirm}
                installmentInfo={transaction.installments ? {
                    current: transaction.installments.current,
                    total: transaction.installments.total
                } : undefined}
            />
        </>
    );
}
