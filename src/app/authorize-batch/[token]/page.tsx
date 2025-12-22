"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { PaymentBatch } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "sonner";

export default function BatchAuthorizationPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;

    const [batch, setBatch] = useState<PaymentBatch | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'success' | 'error'>('loading');
    const [errorMessage, setErrorMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            try {
                const batchData = await paymentBatchService.getByApprovalToken(token);
                if (!batchData) {
                    setStatus('error');
                    setErrorMessage("Link inválido ou expirado.");
                    return;
                }
                
                if (batchData.status !== 'pending_authorization') {
                    setStatus('error');
                    setErrorMessage(`Este lote não está aguardando autorização (status: ${batchData.status}).`);
                    return;
                }
                
                setBatch(batchData);
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

    const handleAuthorize = async () => {
        if (!batch) return;
        
        setIsSubmitting(true);
        try {
            await paymentBatchService.authorizeByToken(token);
            setStatus('success');
        } catch (error) {
            console.error("Error authorizing:", error);
            toast.error("Erro ao autorizar lote");
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
                        <CardTitle className="text-emerald-700">Autorização Confirmada!</CardTitle>
                        <CardDescription>
                            O lote foi autorizado para processamento bancário.
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

    // Ready state - show authorization form
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
            <Card className="w-full max-w-lg">
                <CardHeader className="text-center">
                    <div className="mx-auto bg-sky-100 p-3 rounded-full w-fit mb-4">
                        <Building2 className="h-8 w-8 text-sky-600" />
                    </div>
                    <CardTitle>Autorização Bancária</CardTitle>
                    <CardDescription>
                        Confirme a autorização para processamento no banco.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Batch Summary */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Lote:</span>
                            <span className="font-semibold">{batch?.name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Transações:</span>
                            <span className="font-semibold">{batch?.transactionIds.length}</span>
                        </div>
                        <div className="flex justify-between border-t pt-2">
                            <span className="text-muted-foreground">Valor Total:</span>
                            <span className="font-bold text-lg text-sky-700">
                                {formatCurrency(batch?.totalAmount || 0)}
                            </span>
                        </div>
                    </div>

                    {/* Warning */}
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 flex gap-3 text-amber-800 text-sm">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <p>
                            Ao confirmar, você está autorizando o processamento deste lote no sistema bancário. 
                            Esta ação não pode ser desfeita.
                        </p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between">
                    <Button variant="ghost" onClick={() => router.push('/login')}>
                        Cancelar
                    </Button>
                    <Button 
                        onClick={handleAuthorize} 
                        disabled={isSubmitting}
                        className="bg-sky-600 hover:bg-sky-700"
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar Autorização
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
