"use client";

import Link from "next/link";
import { Users, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CadastrosPage() {
    const items = [
        {
            title: "Entidades",
            description: "Gerencie fornecedores e clientes.",
            href: "/cadastros/entidades",
            icon: Users,
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Cadastros</h1>
                <p className="text-muted-foreground">
                    Gerencie os cadastros do sistema.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
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
