"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    LayoutDashboard,
    Wallet,
    Receipt,
    Building2,
    Settings,
    LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/AuthProvider";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";

const menuItems = [
    {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
    },
    {
        title: "Contas a Pagar",
        href: "/financeiro/contas-pagar",
        icon: Wallet,
    },
    {
        title: "Contas a Receber",
        href: "/financeiro/contas-receber",
        icon: Receipt,
    },
    {
        title: "Centros de Custo",
        href: "/centros-custo",
        icon: Building2,
    },
    {
        title: "Configurações",
        href: "/configuracoes/usuarios",
        icon: Settings,
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const { logout } = useAuth();

    return (
        <div className="flex h-full w-64 flex-col border-r bg-card px-4 py-6">
            <div className="mb-6 flex items-center gap-2 px-2">
                <div className="h-8 w-8 rounded-lg bg-primary" />
                <span className="text-xl font-bold">Fin Control</span>
            </div>

            <CompanySwitcher />

            <nav className="flex-1 space-y-1">
                {menuItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            <item.icon className="h-4 w-4" />
                            {item.title}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-auto border-t pt-4">
                <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
                    onClick={logout}
                >
                    <LogOut className="h-4 w-4" />
                    Sair
                </Button>
            </div>
        </div>
    );
}
