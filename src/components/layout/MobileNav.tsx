"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MoreHorizontal, Map as MapIcon, Megaphone } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useGlobalStore } from "@/lib/store/useGlobalStore";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import {
  activeHref,
  flatNav,
  useNavBadges,
  visibleNav,
} from "@/components/layout/navItems";

/** Abas fixas da barra inferior, com rótulo curto; o resto vai para "Mais". */
const TAB_LABELS: Record<string, string> = {
  "/dashboard": "Início",
  "/financeiro/contas-pagar": "A Pagar",
  "/financeiro/contas-receber": "A Receber",
  "/relatorios": "Relatórios",
};

export function MobileNav() {
  const pathname = usePathname();
  const permissions = usePermissions();
  const [moreOpen, setMoreOpen] = useState(false);
  const setNovidadesOpen = useGlobalStore((s) => s.setNovidadesOpen);
  const novidadesNew = useGlobalStore((s) => s.novidadesNew);

  const flat = useMemo(() => flatNav(visibleNav(permissions)), [permissions]);
  const visibleTabs = flat.filter((i) => i.href in TAB_LABELS);
  const visibleMoreItems = flat.filter((i) => !(i.href in TAB_LABELS));
  const current = activeHref(pathname, flat);
  const badges = useNavBadges(permissions);

  const isMoreActive =
    visibleMoreItems.some((item) => item.href === current) ||
    pathname.startsWith("/roadmap");

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-card/95 backdrop-blur-sm border-t">
        <div
          className="flex w-full"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {visibleTabs.map((tab) => {
            const isActive = tab.href === current;
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
                  {TAB_LABELS[tab.href]}
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
                "relative flex items-center justify-center rounded-full px-4 h-7 transition-all duration-200",
                isMoreActive && "bg-primary/10",
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              {novidadesNew && (
                <span className="absolute right-2.5 top-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
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
              const isActive = item.href === current;
              const Icon = item.icon;
              const count = item.badge ? badges[item.badge] : undefined;
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
                  {!!count && (
                    <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </Link>
              );
            })}
            <Link
              href="/roadmap"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-xl bg-muted/40 px-3.5 py-3.5 text-foreground transition-all duration-150 hover:bg-muted active:scale-[0.98]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
                <MapIcon className="h-[18px] w-[18px]" />
              </div>
              <span className="text-sm font-medium leading-tight">Roadmap</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setNovidadesOpen(true);
              }}
              className="flex items-center gap-3 rounded-xl bg-muted/40 px-3.5 py-3.5 text-foreground transition-all duration-150 hover:bg-muted active:scale-[0.98]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background text-foreground">
                <Megaphone className="h-[18px] w-[18px]" />
              </div>
              <span className="text-sm font-medium leading-tight">
                Novidades
              </span>
              {novidadesNew && (
                <span
                  aria-label="nova versão"
                  className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                />
              )}
            </button>
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
