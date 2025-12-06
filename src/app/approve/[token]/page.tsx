"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { transactionService } from "@/lib/services/transactionService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";

export default function ApprovalPage() {
    const params = useParams();
    const router = useRouter();
    const { user } = useAuth();
    const token = params.token as string;

    const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'idle'>('idle');
    const [errorMessage, setErrorMessage] = useState("");

    const handleApprove = async () => {
        try {
            setStatus('loading');
            // Use logged user ID or a placeholder 'magic-link'
            const approverId = user?.uid || 'magic-link';
            await transactionService.approveByToken(token, approverId);
            setStatus('success');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            console.error("Approval error:", error);
            setStatus('error');
            setErrorMessage(error.message || "Erro ao processar aprovação.");
        }
    };

    if (status === 'success') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                <Card className="w-full max-w-md text-center">
                    <CardHeader>
                        <div className="mx-auto bg-emerald-100 p-3 rounded-full w-fit mb-4">
                            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                        </div>
                        <CardTitle className="text-emerald-700">Aprovação Confirmada!</CardTitle>
                        <CardDescription>
                            A transação foi aprovada com sucesso.
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

    if (status === 'error') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                <Card className="w-full max-w-md text-center border-red-200">
                    <CardHeader>
                        <div className="mx-auto bg-red-100 p-3 rounded-full w-fit mb-4">
                            <XCircle className="h-8 w-8 text-red-600" />
                        </div>
                        <CardTitle className="text-red-700">Erro na Aprovação</CardTitle>
                        <CardDescription>
                            {errorMessage}
                        </CardDescription>
                    </CardHeader>
                    <CardFooter className="justify-center">
                        <Button variant="outline" onClick={() => router.push('/login')}>
                            Voltar
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Confirmação de Aprovação</CardTitle>
                    <CardDescription>
                        Você está prestes a aprovar uma transação via Link Seguro.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="bg-amber-50 border border-amber-200 rounded p-4 flex gap-3 text-amber-800 text-sm">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        <p>
                            Ao clicar em confirmar, a transação será movida para o status <strong>Aprovado</strong> e estará pronta para pagamento.
                        </p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between">
                    <Button variant="ghost" onClick={() => router.push('/login')}>
                        Cancelar
                    </Button>
                    <Button onClick={handleApprove} disabled={status === 'loading'} className="bg-emerald-600 hover:bg-emerald-700">
                        {status === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar Aprovação
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
