"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/providers/AuthProvider";
import { companyService } from "@/lib/services/companyService";
import { ROLE_DESCRIPTIONS } from "@/lib/constants/roleDescriptions";
import { Company } from "@/lib/types";
import { LogOut, Clock, CheckCircle, Loader2, Building2, Briefcase } from "lucide-react";
import Cookies from "js-cookie";

export default function PendingApprovalPage() {
    const { logout, user } = useAuth();
    const router = useRouter();
    const [isApproved, setIsApproved] = useState(false);
    const [pendingCompany, setPendingCompany] = useState<Company | null>(null);

    // Fetch pending company name
    useEffect(() => {
        const fetchPendingCompany = async () => {
            if (user?.pendingCompanyId) {
                try {
                    const company = await companyService.getById(user.pendingCompanyId);
                    setPendingCompany(company);
                } catch (error) {
                    console.error("Error fetching pending company:", error);
                }
            }
        };
        fetchPendingCompany();
    }, [user?.pendingCompanyId]);

    // Real-time listener for user status changes
    useEffect(() => {
        if (!user?.uid) return;

        const unsubscribe = onSnapshot(
            doc(db, "users", user.uid),
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    const effectiveStatus = data.status || (data.active ? 'active' : 'pending_approval');

                    if (effectiveStatus === 'active') {
                        setIsApproved(true);
                        // Update cookies
                        Cookies.set("user_status", 'active', { expires: 1 / 24 });
                        // Redirect after a short delay to show the success message
                        setTimeout(() => {
                            router.push('/');
                        }, 1500);
                    }
                }
            },
            (error) => {
                console.error("Error listening to user status:", error);
            }
        );

        return () => unsubscribe();
    }, [user?.uid, router]);

    // If already active on mount, redirect immediately
    useEffect(() => {
        if (user) {
            const effectiveStatus = user.status || (user.active ? 'active' : 'pending_approval');
            if (effectiveStatus === 'active') {
                Cookies.set("user_status", 'active', { expires: 1 / 24 });
                router.push('/');
            }
            // If user hasn't completed company setup, redirect back
            if (effectiveStatus === 'pending_company_setup') {
                router.push('/company-setup');
            }
        }
    }, [user, router]);

    const roleLabel = user?.pendingRole 
        ? ROLE_DESCRIPTIONS[user.pendingRole]?.label || user.pendingRole 
        : null;

    if (isApproved) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
                <Card className="w-full max-w-md">
                    <CardContent className="pt-6">
                        <div className="text-center space-y-4">
                            <div className="flex justify-center">
                                <div className="h-16 w-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                    <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-500" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-bold">Acesso Aprovado!</h2>
                                <p className="text-muted-foreground">
                                    Redirecionando para o sistema...
                                </p>
                            </div>
                            <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1 pb-4">
                    <div className="flex justify-center mb-2">
                        <div className="h-14 w-14 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                            <Clock className="h-7 w-7 text-yellow-600 dark:text-yellow-500" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-bold text-center">
                        Aguardando Aprovação
                    </CardTitle>
                    <CardDescription className="text-center">
                        Olá, {user?.displayName?.split(" ")[0]}! Sua solicitação foi enviada.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Show pending company and role */}
                    {(pendingCompany || roleLabel) && (
                        <div className="space-y-2">
                            {pendingCompany && (
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                                    <Building2 className="h-4 w-4 text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-muted-foreground">Empresa</p>
                                        <p className="text-sm font-medium truncate">{pendingCompany.name}</p>
                                    </div>
                                </div>
                            )}
                            {roleLabel && (
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                                    <Briefcase className="h-4 w-4 text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-muted-foreground">Função solicitada</p>
                                        <p className="text-sm font-medium">{roleLabel}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md text-sm text-blue-700 dark:text-blue-300 text-center">
                        Esta página será atualizada automaticamente quando sua conta for aprovada.
                    </div>

                    <Button variant="outline" onClick={logout} className="w-full">
                        <LogOut className="mr-2 h-4 w-4" />
                        Sair da conta
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
