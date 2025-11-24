"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/AuthProvider";
import { LogOut, Clock } from "lucide-react";

export default function PendingApprovalPage() {
    const { logout, user } = useAuth();

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
                        Por favor, aguarde ou entre em contato com o suporte se precisar de acesso urgente.
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
