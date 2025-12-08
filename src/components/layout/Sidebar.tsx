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
    LucideIcon,
} from "lucide-react";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useEffect, useMemo } from "react";
import { usePermissions } from "@/hooks/usePermissions";

interface MenuItem {
    title: string;
    href?: string;
    icon: LucideIcon;
    items?: MenuItem[];
    // Permission key - if specified, item is only shown if permission is true
    permission?: keyof ReturnType<typeof usePermissions>;
}

const allMenuItems: MenuItem[] = [
    {
        title: "Dashboard",
        href: "/",
        icon: LayoutDashboard,
        permission: "canViewDashboard", // Restricted to Admin/Manager/Approver/Releaser
    },
    {
        title: "Financeiro",
        icon: DollarSign,
        items: [
            {
                title: "Contas a Pagar",
                href: "/financeiro/contas-pagar",
                icon: Wallet,
                permission: "canViewPayables",
            },
            {
                title: "Contas a Receber",
                href: "/financeiro/contas-receber",
                icon: Receipt,
                permission: "canViewReceivables",
            },
            {
                title: "Recorrências",
                href: "/financeiro/recorrencias",
                icon: RefreshCw,
                permission: "canViewRecurrences",
            },
            {
                title: "Lotes de Pagamento",
                href: "/financeiro/lotes",
                icon: Layers,
                permission: "canViewBatches",
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
                permission: "canViewCostCenters",
            },
            {
                title: "Outros Cadastros", // Entities, etc.
                href: "/cadastros",
                icon: Users,
                permission: "canViewEntities",
            },
        ],
    },
    {
        title: "Relatórios",
        href: "/relatorios",
        icon: FileText,
        permission: "canViewReports",
    },
    {
        title: "Configurações",
        href: "/configuracoes",
        icon: Settings,
        permission: "canAccessSettings", // Only managers and admins
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const [openGroups, setOpenGroups] = useState<string[]>([]);
    const permissions = usePermissions();

    // Filter menu items based on permissions
    const menuItems = useMemo(() => {
        const filterItems = (items: MenuItem[]): MenuItem[] => {
            return items
                .filter(item => {
                    // If no permission required, show the item
                    if (!item.permission) return true;
                    // Check if user has the required permission
                    return permissions[item.permission] === true;
                })
                .map(item => {
                    // If item has sub-items, filter them too
                    if (item.items) {
                        const filteredSubItems = filterItems(item.items);
                        // Only include the group if it has visible sub-items
                        if (filteredSubItems.length === 0) return null;
                        return { ...item, items: filteredSubItems };
                    }
                    return item;
                })
                .filter((item): item is MenuItem => item !== null);
        };

        return filterItems(allMenuItems);
    }, [permissions]);

    // Automatically open groups if a child is active
    useEffect(() => {
        const activeGroup = menuItems.find(item =>
            item.items?.some(subItem => subItem.href === pathname)
        );
        if (activeGroup) {
            setOpenGroups(prev => prev.includes(activeGroup.title) ? prev : [...prev, activeGroup.title]);
        }
    }, [pathname, menuItems]);

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
                                                href={subItem.href!}
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
