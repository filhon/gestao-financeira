"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/AuthProvider";
import { LogOut, Clock, CheckCircle, Loader2 } from "lucide-react";
import Cookies from "js-cookie";

export default function PendingApprovalPage() {
    const { logout, user } = useAuth();
    const router = useRouter();
    const [isApproved, setIsApproved] = useState(false);

    // Real-time listener for user status changes
    useEffect(() => {
        if (!user?.uid) return;

        const unsubscribe = onSnapshot(
            doc(db, "users", user.uid),
            (docSnapshot) => {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    const effectiveStatus = data.status || (data.active ? 'active' : 'pending');

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
            const effectiveStatus = user.status || (user.active ? 'active' : 'pending');
            if (effectiveStatus === 'active') {
                Cookies.set("user_status", 'active', { expires: 1 / 24 });
                router.push('/');
            }
        }
    }, [user, router]);

    if (isApproved) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
                <div className="max-w-md w-full space-y-8 text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                    <div className="flex justify-center">
                        <div className="h-24 w-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                            <CheckCircle className="h-12 w-12 text-green-600 dark:text-green-500" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                            Acesso Aprovado!
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400">
                            Redirecionando para o sistema...
                        </p>
                    </div>
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
            <div className="max-w-md w-full space-y-8 text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
                <div className="flex justify-center">
                    <div className="h-24 w-24 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                        <Clock className="h-12 w-12 text-yellow-600 dark:text-yellow-500" />
                    </div>
                </div>

                <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                        Aguardando Aprovação
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400">
                        Olá, <span className="font-medium text-gray-900 dark:text-gray-200">{user?.displayName}</span>!
                    </p>
                    <p className="text-gray-500 dark:text-gray-400">
                        Sua conta foi criada com sucesso, mas precisa ser aprovada por um administrador antes de você acessar o sistema.
                    </p>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-md text-sm text-blue-700 dark:text-blue-300">
                    <p>
                        Esta página será atualizada automaticamente quando sua conta for aprovada.
                    </p>
                </div>

                <div className="pt-4">
                    <Button variant="outline" onClick={logout} className="w-full">
                        <LogOut className="mr-2 h-4 w-4" />
                        Sair da conta
                    </Button>
                </div>
            </div>
        </div>
    );
}
