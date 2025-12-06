"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt, Wallet, FileText, RotateCcw, ChevronRight } from "lucide-react";

const financialModules = [
    {
        title: "Contas a Pagar",
        description: "Gerencie despesas e pagamentos pendentes.",
        href: "/financeiro/contas-pagar",
        icon: Receipt,
    },
    {
        title: "Contas a Receber",
        description: "Controle receitas e recebimentos.",
        href: "/financeiro/contas-receber",
        icon: Wallet,
    },
    {
        title: "Lotes de Pagamento",
        description: "Organize pagamentos em lotes para processamento.",
        href: "/financeiro/lotes",
        icon: FileText,
    },
    {
        title: "Recorrências",
        description: "Gerencie transações automáticas e assinaturas.",
        href: "/financeiro/recorrencias",
        icon: RotateCcw,
    },
];

export default function FinanceiroPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Financeiro</h1>
                <p className="text-muted-foreground">
                    Acesse os módulos financeiros do sistema.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {financialModules.map((item) => (
                    <Link key={item.href} href={item.href}>
                        <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-base font-medium">
                                    {item.title}
                                </CardTitle>
                                <item.icon className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <CardDescription>{item.description}</CardDescription>
                                <div className="mt-4 flex items-center text-sm text-primary font-medium">
                                    Acessar <ChevronRight className="ml-1 h-4 w-4" />
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );
}

