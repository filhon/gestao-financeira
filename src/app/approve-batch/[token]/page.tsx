"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { transactionService } from "@/lib/services/transactionService";
import { PaymentBatch, Transaction, CostCenter } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import { Loader2, CheckCircle2, XCircle, ChevronRight, Undo2, Edit2, X, Check, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

// Types for grouped transactions
interface TransactionEdit {
    id: string;
    adjustedAmount?: number;
}

interface SupplierGroup {
    supplier: string;
    transactions: Transaction[];
    totalAmount: number;
}

interface CostCenterGroup {
    costCenterId: string;
    breadcrumb: string[];
    highlightedName: string;
    suppliers: SupplierGroup[];
    totalAmount: number;
}

export default function BatchApprovalPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;

    const [batch, setBatch] = useState<PaymentBatch | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [status, setStatus] = useState<'loading' | 'ready' | 'success' | 'error'>('loading');
    const [errorMessage, setErrorMessage] = useState("");
    
    // Editing state
    const [edits, setEdits] = useState<Map<string, TransactionEdit>>(new Map());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [comment, setComment] = useState("");
    
    // Reject transaction state
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    
    // Return to manager state
    const [showReturnDialog, setShowReturnDialog] = useState(false);
    const [returnReason, setReturnReason] = useState("");
    
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Load batch and transactions
    useEffect(() => {
        const loadData = async () => {
            try {
                const batchData = await paymentBatchService.getByApprovalToken(token);
                if (!batchData) {
                    setStatus('error');
                    setErrorMessage("Link inválido ou expirado.");
                    return;
                }
                
                if (batchData.status !== 'pending_approval') {
                    setStatus('error');
                    setErrorMessage(`Este lote não está aguardando aprovação (status: ${batchData.status}).`);
                    return;
                }
                
                setBatch(batchData);
                
                // Load transactions
                const txns = await transactionService.getAll({ batchId: batchData.id });
                setTransactions(txns);
                
                // Load cost centers for this company
                const ccQuery = query(collection(db, "cost_centers"), where("companyId", "==", batchData.companyId));
                const ccSnapshot = await getDocs(ccQuery);
                const ccData = ccSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CostCenter[];
                setCostCenters(ccData);
                
                setStatus('ready');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (error: any) {
                console.error("Error loading batch:", error);
                setStatus('error');
                setErrorMessage(error.message || "Erro ao carregar o lote.");
            }
        };
        
        loadData();
    }, [token]);

    // Build cost center breadcrumb
    const buildBreadcrumb = (costCenterId: string): string[] => {
        const result: string[] = [];
        let currentId: string | undefined = costCenterId;
        
        while (currentId) {
            const cc = costCenters.find(c => c.id === currentId);
            if (cc) {
                result.unshift(cc.name);
                currentId = cc.parentId;
            } else {
                break;
            }
        }
        
        return result;
    };

    // Group transactions by cost center and supplier
    const groupedTransactions = useMemo((): CostCenterGroup[] => {
        const ccMap = new Map<string, SupplierGroup[]>();
        
        transactions.forEach(t => {
            const ccId = t.costCenterId || 'uncategorized';
            if (!ccMap.has(ccId)) {
                ccMap.set(ccId, []);
            }
            
            const supplierGroups = ccMap.get(ccId)!;
            const supplier = t.supplierOrClient || 'Sem Fornecedor';
            let group = supplierGroups.find(sg => sg.supplier === supplier);
            
            if (!group) {
                group = { supplier, transactions: [], totalAmount: 0 };
                supplierGroups.push(group);
            }
            
            const amount = edits.get(t.id)?.adjustedAmount ?? t.amount;
            group.transactions.push(t);
            group.totalAmount += amount;
        });
        
        // Build result with breadcrumbs
        const result: CostCenterGroup[] = [];
        ccMap.forEach((suppliers, ccId) => {
            const breadcrumb = ccId === 'uncategorized' ? ['Sem Centro de Custo'] : buildBreadcrumb(ccId);
            const cc = costCenters.find(c => c.id === ccId);
            
            // Sort suppliers by total (highest first)
            suppliers.sort((a, b) => b.totalAmount - a.totalAmount);
            
            // Sort transactions within each supplier by amount (highest first)
            suppliers.forEach(sg => {
                sg.transactions.sort((a, b) => {
                    const amountA = edits.get(a.id)?.adjustedAmount ?? a.amount;
                    const amountB = edits.get(b.id)?.adjustedAmount ?? b.amount;
                    return amountB - amountA;
                });
            });
            
            result.push({
                costCenterId: ccId,
                breadcrumb,
                highlightedName: cc?.name || 'Sem Centro de Custo',
                suppliers,
                totalAmount: suppliers.reduce((sum, sg) => sum + sg.totalAmount, 0)
            });
        });
        
        // Sort cost center groups by total (highest first)
        result.sort((a, b) => b.totalAmount - a.totalAmount);
        
        return result;
    }, [transactions, costCenters, edits]);

    // Calculate totals
    const totalAmount = useMemo(() => {
        return transactions.reduce((sum, t) => {
            const amount = edits.get(t.id)?.adjustedAmount ?? t.amount;
            return sum + amount;
        }, 0);
    }, [transactions, edits]);

    // Check if transaction is new (created within last 30 days)
    const isNewTransaction = (t: Transaction): boolean => {
        return differenceInDays(new Date(), t.createdAt) <= 30;
    };

    // Edit amount handlers
    const handleStartEdit = (t: Transaction) => {
        setEditingId(t.id);
        const current = edits.get(t.id)?.adjustedAmount ?? t.amount;
        setEditValue(String(current));
    };

    const handleSaveEdit = () => {
        if (!editingId) return;
        const newAmount = parseFloat(editValue);
        if (isNaN(newAmount) || newAmount < 0) {
            toast.error("Valor inválido");
            return;
        }
        
        const t = transactions.find(tx => tx.id === editingId);
        if (t) {
            const newEdits = new Map(edits);
            if (newAmount !== t.amount) {
                newEdits.set(editingId, { id: editingId, adjustedAmount: newAmount });
            } else {
                newEdits.delete(editingId);
            }
            setEdits(newEdits);
        }
        
        setEditingId(null);
        setEditValue("");
    };

    // Reject transaction
    const handleRejectTransaction = async () => {
        if (!rejectingId || !batch || !rejectReason.trim()) {
            toast.error("Informe o motivo da rejeição");
            return;
        }
        
        try {
            await paymentBatchService.rejectTransaction(batch.id, rejectingId, rejectReason, 'magic-link');
            setTransactions(transactions.filter(t => t.id !== rejectingId));
            edits.delete(rejectingId);
            setEdits(new Map(edits));
            toast.success("Transação rejeitada");
        } catch (error) {
            console.error("Error rejecting:", error);
            toast.error("Erro ao rejeitar transação");
        } finally {
            setRejectingId(null);
            setRejectReason("");
        }
    };

    // Return to manager
    const handleReturnToManager = async () => {
        if (!batch || !returnReason.trim()) {
            toast.error("Informe o motivo da devolução");
            return;
        }
        
        setIsSubmitting(true);
        try {
            await paymentBatchService.returnToManager(batch.id, returnReason);
            toast.success("Lote devolvido ao gestor");
            setStatus('success');
        } catch (error) {
            console.error("Error returning:", error);
            toast.error("Erro ao devolver lote");
        } finally {
            setIsSubmitting(false);
            setShowReturnDialog(false);
        }
    };

    // Approve batch
    const handleApprove = async () => {
        if (!batch) return;
        
        if (transactions.length === 0) {
            toast.error("Não há transações para aprovar");
            return;
        }
        
        setIsSubmitting(true);
        try {
            const adjustments = Array.from(edits.values()).filter(e => e.adjustedAmount !== undefined);
            await paymentBatchService.approveByToken(token, comment || undefined, adjustments.length > 0 ? adjustments : undefined);
            setStatus('success');
        } catch (error) {
            console.error("Error approving:", error);
            toast.error("Erro ao aprovar lote");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Loading state
    if (status === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <Loader2 className="h-12 w-12 animate-spin text-gray-400" />
            </div>
        );
    }

    // Error state
    if (status === 'error') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                <Card className="w-full max-w-md text-center border-red-200">
                    <CardHeader>
                        <div className="mx-auto bg-red-100 p-3 rounded-full w-fit mb-4">
                            <XCircle className="h-8 w-8 text-red-600" />
                        </div>
                        <CardTitle className="text-red-700">Erro</CardTitle>
                        <CardDescription>{errorMessage}</CardDescription>
                    </CardHeader>
                    <CardFooter className="justify-center">
                        <Button variant="outline" onClick={() => router.push('/login')}>
                            Ir para Login
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    // Success state
    if (status === 'success') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                <Card className="w-full max-w-md text-center">
                    <CardHeader>
                        <div className="mx-auto bg-emerald-100 p-3 rounded-full w-fit mb-4">
                            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                        </div>
                        <CardTitle className="text-emerald-700">Ação Concluída!</CardTitle>
                        <CardDescription>
                            O lote foi processado com sucesso.
                        </CardDescription>
                    </CardHeader>
                    <CardFooter className="justify-center">
                        <Button onClick={() => router.push('/login')}>
                            Ir para o Sistema
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-4 py-4">
                    <h1 className="text-xl font-bold">Aprovar Lote: {batch?.name}</h1>
                    <p className="text-sm text-muted-foreground">
                        Revise as transações abaixo e aprove ou devolva o lote.
                    </p>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                {/* Balance Counters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Saldo Atual</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold text-gray-900">
                                {formatCurrency(0)}
                            </p>
                            <p className="text-xs text-muted-foreground">Receitas - Despesas confirmadas</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Saldo Projetado (Fim do Ano)</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold text-gray-900">
                                {formatCurrency(0)}
                            </p>
                            <p className="text-xs text-muted-foreground">Projeção ao final do exercício</p>
                        </CardContent>
                    </Card>
                    <Card className="border-amber-200 bg-amber-50/50">
                        <CardHeader className="pb-2">
                            <CardDescription>Saldo Após Pagamento</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-2xl font-bold text-amber-700">
                                {formatCurrency(0 - totalAmount)}
                            </p>
                            <p className="text-xs text-muted-foreground">Após pagar este lote</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Summary Bar */}
                <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
                    <div>
                        <span className="text-sm text-muted-foreground">Transações: </span>
                        <span className="font-semibold">{transactions.length}</span>
                    </div>
                    <div>
                        <span className="text-sm text-muted-foreground">Total: </span>
                        <span className="font-bold text-lg">{formatCurrency(totalAmount)}</span>
                    </div>
                </div>

                {/* Transactions grouped by Cost Center */}
                <div className="space-y-4">
                    {groupedTransactions.map((ccGroup) => (
                        <Card key={ccGroup.costCenterId}>
                            <CardHeader className="pb-2">
                                {/* Breadcrumb */}
                                <div className="flex items-center gap-1 text-sm">
                                    {ccGroup.breadcrumb.map((name, idx) => (
                                        <span key={idx} className="flex items-center gap-1">
                                            {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                            <span className={idx === ccGroup.breadcrumb.length - 1 ? "font-semibold text-primary" : "text-muted-foreground"}>
                                                {name}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    Total: {formatCurrency(ccGroup.totalAmount)}
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <Accordion type="multiple" className="space-y-2">
                                    {ccGroup.suppliers.map((sg) => (
                                        <AccordionItem key={sg.supplier} value={sg.supplier} className="border rounded-lg">
                                            <AccordionTrigger className="px-4 hover:no-underline">
                                                <div className="flex justify-between w-full mr-4">
                                                    <span className="font-medium">{sg.supplier}</span>
                                                    <span className="text-muted-foreground">
                                                        {sg.transactions.length} transações • {formatCurrency(sg.totalAmount)}
                                                    </span>
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-4 pb-4">
                                                <div className="space-y-2">
                                                    {sg.transactions.map((t) => {
                                                        const isNew = isNewTransaction(t);
                                                        const amount = edits.get(t.id)?.adjustedAmount ?? t.amount;
                                                        const isEdited = edits.has(t.id);
                                                        
                                                        return (
                                                            <div 
                                                                key={t.id} 
                                                                className={`flex items-center justify-between p-3 rounded-lg border ${isNew ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50'}`}
                                                            >
                                                                <div className="flex-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-medium">{t.description}</span>
                                                                        {isNew && (
                                                                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">
                                                                                Novo
                                                                            </Badge>
                                                                        )}
                                                                        {isEdited && (
                                                                            <Badge variant="secondary" className="text-xs">
                                                                                Editado
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-xs text-muted-foreground">
                                                                        Vencimento: {format(t.dueDate, "dd/MM/yyyy")}
                                                                    </p>
                                                                </div>
                                                                
                                                                <div className="flex items-center gap-2">
                                                                    {editingId === t.id ? (
                                                                        <div className="flex items-center gap-1">
                                                                            <Input
                                                                                type="number"
                                                                                value={editValue}
                                                                                onChange={e => setEditValue(e.target.value)}
                                                                                className="w-28 h-8"
                                                                                autoFocus
                                                                            />
                                                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveEdit}>
                                                                                <Check className="h-4 w-4 text-green-600" />
                                                                            </Button>
                                                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}>
                                                                                <X className="h-4 w-4" />
                                                                            </Button>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <span className="font-semibold">{formatCurrency(amount)}</span>
                                                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleStartEdit(t)}>
                                                                                <Edit2 className="h-4 w-4" />
                                                                            </Button>
                                                                            <Button 
                                                                                size="icon" 
                                                                                variant="ghost" 
                                                                                className="h-8 w-8 text-red-500 hover:text-red-700"
                                                                                onClick={() => setRejectingId(t.id)}
                                                                            >
                                                                                <X className="h-4 w-4" />
                                                                            </Button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Rejection inline form */}
                {rejectingId && (
                    <Card className="border-red-200">
                        <CardHeader>
                            <CardTitle className="text-red-700 text-lg">Rejeitar Transação</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div>
                                <Label>Motivo da rejeição</Label>
                                <Textarea
                                    placeholder="Descreva o motivo..."
                                    value={rejectReason}
                                    onChange={e => setRejectReason(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setRejectingId(null)}>
                                    Cancelar
                                </Button>
                                <Button variant="destructive" onClick={handleRejectTransaction}>
                                    Confirmar Rejeição
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Comment section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Comentário (opcional)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Textarea
                            placeholder="Adicione um comentário sobre a aprovação..."
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                        />
                    </CardContent>
                </Card>

                {/* Actions */}
                <div className="flex justify-between sticky bottom-0 bg-white border-t p-4 -mx-4">
                    <Button 
                        variant="outline" 
                        onClick={() => setShowReturnDialog(true)}
                        disabled={isSubmitting}
                    >
                        <Undo2 className="mr-2 h-4 w-4" />
                        Devolver ao Gestor
                    </Button>
                    <Button 
                        onClick={handleApprove}
                        disabled={isSubmitting || transactions.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700"
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Aprovar Lote
                    </Button>
                </div>
            </div>

            {/* Return to Manager Dialog */}
            <AlertDialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Devolver Lote ao Gestor</AlertDialogTitle>
                        <AlertDialogDescription>
                            O lote será devolvido para que o gestor financeiro faça os ajustes necessários.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4">
                        <Label>Motivo da devolução</Label>
                        <Textarea
                            placeholder="Descreva os ajustes necessários..."
                            value={returnReason}
                            onChange={e => setReturnReason(e.target.value)}
                            className="mt-2"
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleReturnToManager} disabled={!returnReason.trim()}>
                            Confirmar Devolução
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
