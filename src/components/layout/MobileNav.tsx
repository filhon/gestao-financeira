"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Scale,
  Layers,
  FileCheck,
  Building2,
  Users,
  Settings,
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";

interface NavTab {
  title: string;
  href: string;
  icon: LucideIcon;
  permission?: keyof ReturnType<typeof usePermissions>;
}

const mainTabs: NavTab[] = [
  {
    title: "Início",
    href: "/dashboard",
    icon: LayoutDashboard,
    permission: "canViewDashboard",
  },
  {
    title: "A Pagar",
    href: "/financeiro/contas-pagar",
    icon: Wallet,
    permission: "canViewPayables",
  },
  {
    title: "A Receber",
    href: "/financeiro/contas-receber",
    icon: Receipt,
    permission: "canViewReceivables",
  },
  {
    title: "Relatórios",
    href: "/relatorios",
    icon: FileText,
    permission: "canViewReports",
  },
];

const moreItems: NavTab[] = [
  {
    title: "Recorrências",
    href: "/financeiro/recorrencias",
    icon: RefreshCw,
    permission: "canViewRecurrences",
  },
  {
    title: "Conciliação",
    href: "/financeiro/conciliacao",
    icon: Scale,
    permission: "canViewPayables",
  },
  {
    title: "Lotes",
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
    title: "Centros de Custo",
    href: "/centros-custo",
    icon: Building2,
    permission: "canViewCostCenters",
  },
  {
    title: "Outros Cadastros",
    href: "/cadastros",
    icon: Users,
    permission: "canViewEntities",
  },
  {
    title: "Configurações",
    href: "/configuracoes",
    icon: Settings,
    permission: "canAccessSettings",
  },
  {
    title: "Roadmap",
    href: "/roadmap",
    icon: MapIcon,
  },
];

export function MobileNav() {
  const pathname = usePathname();
  const permissions = usePermissions();
  const [moreOpen, setMoreOpen] = useState(false);

  const visibleTabs = useMemo(() => {
    return mainTabs.filter((tab) => {
      if (!tab.permission) return true;
      return permissions[tab.permission as keyof typeof permissions] === true;
    });
  }, [permissions]);

  const visibleMoreItems = useMemo(() => {
    return moreItems.filter((item) => {
      if (!item.permission) return true;
      return permissions[item.permission as keyof typeof permissions] === true;
    });
  }, [permissions]);

  const isMoreActive = visibleMoreItems.some((item) => pathname === item.href);

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-card/95 backdrop-blur-sm border-t">
        <div
          className="flex w-full"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {visibleTabs.map((tab) => {
            const isActive =
              pathname === tab.href || pathname.startsWith(tab.href + "/");
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors min-w-0",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center rounded-full px-4 h-7 transition-all duration-200",
                    isActive && "bg-primary/10",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                </div>
                <span className="text-[10px] font-medium leading-none truncate max-w-full px-1">
                  {tab.title}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 transition-colors min-w-0",
              isMoreActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center rounded-full px-4 h-7 transition-all duration-200",
                isMoreActive && "bg-primary/10",
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-medium leading-none">Mais</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl max-h-[80vh] overflow-y-auto border-t border-x border-border shadow-2xl px-4 pb-6 pt-0"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
          </div>

          {/* Header */}
          <div className="flex items-center py-3 mb-1">
            <span className="text-base font-semibold tracking-tight">Menu</span>
          </div>

          {/* Nav grid */}
          <div className="grid grid-cols-2 gap-2 mb-5">
            {visibleMoreItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3.5 py-3.5 transition-all duration-150 active:scale-[0.98]",
                    isActive
                      ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                      : "bg-muted/40 text-foreground hover:bg-muted",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl shrink-0 transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <span className="text-sm font-medium leading-tight">
                    {item.title}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Company section */}
          <div className="relative flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Empresa
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <CompanySwitcher />
        </SheetContent>
      </Sheet>
    </>
  );
}
