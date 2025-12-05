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
    Users,
    RefreshCw,
    FileText,
    ChevronRight,
    DollarSign,
    Database,
    Layers,
} from "lucide-react";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useEffect } from "react";

const menuItems = [
    {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
    },
    {
        title: "Financeiro",
        icon: DollarSign,
        items: [
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
                title: "Recorrências",
                href: "/financeiro/recorrencias",
                icon: RefreshCw,
            },
            {
                title: "Lotes de Pagamento",
                href: "/financeiro/lotes",
                icon: Layers,
            },
        ],
    },
    {
        title: "Cadastros",
        icon: Database,
        items: [
            {
                title: "Centros de Custo",
                href: "/centros-custo",
                icon: Building2,
            },
            {
                title: "Outros Cadastros",
                href: "/cadastros",
                icon: Users,
            },
        ],
    },
    {
        title: "Relatórios",
        href: "/relatorios",
        icon: FileText,
    },
    {
        title: "Configurações",
        href: "/configuracoes",
        icon: Settings,
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const [openGroups, setOpenGroups] = useState<string[]>([]);

    // Automatically open groups if a child is active
    useEffect(() => {
        const activeGroup = menuItems.find(item =>
            item.items?.some(subItem => subItem.href === pathname)
        );
        if (activeGroup && !openGroups.includes(activeGroup.title)) {
            setOpenGroups(prev => [...prev, activeGroup.title]);
        }
    }, [pathname]);

    const toggleGroup = (title: string) => {
        setOpenGroups(prev =>
            prev.includes(title)
                ? prev.filter(t => t !== title)
                : [...prev, title]
        );
    };

    return (
        <div className="flex h-full w-64 flex-col border-r bg-card px-4 py-6">
            <div className="mb-6 flex items-center gap-2 px-2">

                <span className="text-xl font-bold">Fin Control</span>
            </div>

            <CompanySwitcher />

            <nav className="flex-1 space-y-1 mt-4">
                {menuItems.map((item) => {
                    if (item.items) {
                        const isOpen = openGroups.includes(item.title);
                        const isActiveGroup = item.items.some(subItem => subItem.href === pathname);

                        return (
                            <Collapsible
                                key={item.title}
                                open={isOpen}
                                onOpenChange={() => toggleGroup(item.title)}
                                className="w-full"
                            >
                                <CollapsibleTrigger asChild>
                                    <button
                                        className={cn(
                                            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground",
                                            isActiveGroup ? "text-primary" : "text-muted-foreground"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon className="h-4 w-4" />
                                            {item.title}
                                        </div>
                                        <ChevronRight
                                            className={cn(
                                                "h-4 w-4 transition-transform duration-200",
                                                isOpen && "rotate-90"
                                            )}
                                        />
                                    </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="space-y-1 pt-1">
                                    {item.items.map((subItem) => {
                                        const isActive = pathname === subItem.href;
                                        return (
                                            <Link
                                                key={subItem.href}
                                                href={subItem.href}
                                                className={cn(
                                                    "flex items-center gap-3 rounded-lg pl-9 pr-3 py-2 text-sm font-medium transition-colors",
                                                    isActive
                                                        ? "bg-primary/10 text-primary"
                                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                                )}
                                            >
                                                <subItem.icon className="h-4 w-4" />
                                                {subItem.title}
                                            </Link>
                                        );
                                    })}
                                </CollapsibleContent>
                            </Collapsible>
                        );
                    }

                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href!}
                            href={item.href!}
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
        </div>
    );
}
