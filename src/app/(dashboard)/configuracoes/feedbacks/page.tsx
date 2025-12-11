"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminFeedbackTable } from "@/components/features/feedback/AdminFeedbackTable";
import { feedbackService } from "@/lib/services/feedbackService";
import { Feedback } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { Loader2, MessageSquare, Clock, CheckCircle, AlertCircle } from "lucide-react";

export default function AdminFeedbacksPage() {
    const router = useRouter();
    const { canManageFeedback } = usePermissions();
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Route protection
    useEffect(() => {
        if (canManageFeedback === false) {
            router.push("/");
        }
    }, [canManageFeedback, router]);

    const loadFeedbacks = async () => {
        try {
            setIsLoading(true);
            const data = await feedbackService.getAll();
            setFeedbacks(data);
        } catch (error) {
            console.error("Error loading feedbacks:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (canManageFeedback) {
            loadFeedbacks();
        }
    }, [canManageFeedback]);

    // Stats
    const totalFeedbacks = feedbacks.length;
    const pendingFeedbacks = feedbacks.filter(f => f.status === 'pending').length;
    const resolvedFeedbacks = feedbacks.filter(f => f.status === 'resolved').length;
    const unreadFeedbacks = feedbacks.filter(f => !f.read).length;

    if (canManageFeedback === undefined) {
        return (
            <div className="flex justify-center items-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!canManageFeedback) {
        return null; // Will redirect
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Gerenciamento de Feedbacks</h1>
                <p className="text-muted-foreground">
                    Visualize e responda aos feedbacks enviados pelos usuários do sistema.
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total</CardTitle>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalFeedbacks}</div>
                        <p className="text-xs text-muted-foreground">feedbacks recebidos</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Não Lidos</CardTitle>
                        <AlertCircle className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{unreadFeedbacks}</div>
                        <p className="text-xs text-muted-foreground">aguardando visualização</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
                        <Clock className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">{pendingFeedbacks}</div>
                        <p className="text-xs text-muted-foreground">aguardando resposta</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Resolvidos</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{resolvedFeedbacks}</div>
                        <p className="text-xs text-muted-foreground">feedbacks concluídos</p>
                    </CardContent>
                </Card>
            </div>

            {/* Feedback Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Todos os Feedbacks</CardTitle>
                    <CardDescription>
                        Clique em um feedback para ver os detalhes ou responder ao usuário.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <AdminFeedbackTable 
                        feedbacks={feedbacks} 
                        onUpdate={loadFeedbacks}
                        isLoading={isLoading}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
