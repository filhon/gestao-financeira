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
  Map as MapIcon,
  Scale,
  TrendingUp,
  FileCheck,
  ReceiptText,
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
    href: "/dashboard",
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
        title: "Conciliação Bancária",
        href: "/financeiro/conciliacao",
        icon: Scale,
        permission: "canViewReconciliation",
      },
      {
        title: "Lotes de Pagamento",
        href: "/financeiro/lotes",
        icon: Layers,
        permission: "canViewBatches",
      },
      {
        title: "Comprovantes",
        href: "/financeiro/comprovantes",
        icon: FileCheck,
        permission: "canViewPayables",
      },
      {
        title: "Reembolsos",
        href: "/financeiro/reembolsos",
        icon: ReceiptText,
        permission: "canViewPayables",
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
  {
    title: "Roadmap",
    href: "/roadmap",
    icon: MapIcon,
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
        .filter((item) => {
          // If no permission required, show the item
          if (!item.permission) return true;
          // Check if user has the required permission
          return permissions[item.permission] === true;
        })
        .map((item) => {
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
    const activeGroup = menuItems.find((item) =>
      item.items?.some((subItem) => subItem.href === pathname),
    );
    if (activeGroup) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenGroups((prev) =>
        prev.includes(activeGroup.title) ? prev : [...prev, activeGroup.title],
      );
    }
  }, [pathname, menuItems]);

  const toggleGroup = (title: string) => {
    setOpenGroups((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
  };

  return (
    <div className="hidden md:flex h-full w-64 flex-col border-r bg-card">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-base font-semibold tracking-tight">
          Fin Control
        </span>
      </div>

      {/* Company Switcher */}
      <div className="px-3 pt-3 pb-1">
        <CompanySwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-0.5">
          {menuItems.map((item) => {
            if (item.items) {
              const isOpen = openGroups.includes(item.title);
              const isActiveGroup = item.items.some(
                (subItem) => subItem.href === pathname,
              );

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
                        "group flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        isActiveGroup
                          ? "text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                            isActiveGroup
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          <item.icon className="h-3.5 w-3.5" />
                        </div>
                        {item.title}
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                          isOpen && "rotate-90",
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-3 pb-1">
                      {item.items.map((subItem) => {
                        const isActive = pathname === subItem.href;
                        return (
                          <Link
                            key={subItem.href}
                            href={subItem.href!}
                            className={cn(
                              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                              isActive
                                ? "bg-primary/10 font-medium text-primary"
                                : "font-normal text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <subItem.icon
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                isActive
                                  ? "text-primary"
                                  : "text-muted-foreground",
                              )}
                            />
                            {subItem.title}
                          </Link>
                        );
                      })}
                    </div>
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
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                </div>
                {item.title}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t px-5 py-4">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Link
            href="/politica-privacidade"
            className="hover:text-foreground transition-colors"
          >
            Privacidade
          </Link>
          <span className="text-border">·</span>
          <Link
            href="/termos-uso"
            className="hover:text-foreground transition-colors"
          >
            Termos
          </Link>
        </div>
      </div>
    </div>
  );
}
