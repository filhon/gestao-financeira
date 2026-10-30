"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  ChevronRight,
  Star,
  PanelLeftClose,
  PanelLeftOpen,
  Megaphone,
  Map as MapIcon,
  MessageSquare,
  ChevronsUpDown,
} from "lucide-react";
import { useGlobalStore } from "@/lib/store/useGlobalStore";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect, useMemo } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import {
  activeHref,
  flatNav,
  isGroup,
  useNavBadges,
  visibleNav,
  type NavBadge,
  type NavGroup,
  type NavItem,
} from "@/components/layout/navItems";

// Preferências locais de quem usa (só conveniência; vazio = padrão).
const COLLAPSED_KEY = "fincontrol:nav:collapsed";
const PINS_KEY = "fincontrol:nav:pins";

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // armazenamento indisponível: vale só nesta aba
  }
}

const BADGE_TONE: Record<NavBadge, string> = {
  overdue: "bg-destructive/10 text-destructive",
  queue: "bg-primary/10 text-primary",
  comprovantes: "bg-muted text-muted-foreground",
  feedbacks: "bg-muted text-muted-foreground",
};

// Ponto do rail e do grupo: só vencidas e fila pedem ação agora; o resto é aviso quieto.
const DOT_TONE: Record<NavBadge, string> = {
  overdue: "bg-destructive",
  queue: "bg-primary",
  comprovantes: "bg-muted-foreground",
  feedbacks: "bg-muted-foreground",
};
const DOT_ORDER: NavBadge[] = ["overdue", "queue", "comprovantes", "feedbacks"];

const ACTIVE = "bg-primary/12 text-foreground";
const IDLE = "text-muted-foreground hover:bg-muted hover:text-foreground";

const BADGE_LABEL: Record<NavBadge, string> = {
  overdue: "vencidas",
  queue: "na sua fila",
  comprovantes: "para revisar",
  feedbacks: "não lidos",
};

/** Ponto de pendência; no rail fica sobre o ícone, com anel para destacar. */
function Dot({ tone, inline }: { tone: string; inline?: boolean }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full ring-2 ring-card",
        tone,
        !inline && "absolute right-1 top-1",
      )}
    />
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const permissions = usePermissions();
  const setNovidadesOpen = useGlobalStore((s) => s.setNovidadesOpen);
  const novidadesNew = useGlobalStore((s) => s.novidadesNew);

  // Sidebar só monta no cliente (DashboardShell espera hidratar).
  const [collapsed, setCollapsed] = useState(() =>
    readPref(COLLAPSED_KEY, false),
  );
  const [pins, setPins] = useState<string[]>(() => readPref(PINS_KEY, []));
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  const nav = useMemo(() => visibleNav(permissions), [permissions]);
  const flat = useMemo(() => flatNav(nav), [nav]);
  const settings = nav.find((e): e is NavGroup => isGroup(e) && !!e.footer);
  const main = useMemo(
    () => nav.filter((e) => e !== settings),
    [nav, settings],
  );
  const current = activeHref(pathname, flat);
  const badges = useNavBadges(permissions);
  const groupDot = (items: NavItem[]) =>
    DOT_ORDER.find((b) => items.some((i) => i.badge === b && badges[b]));
  const pinned = pins
    .map((href) => flat.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writePref(COLLAPSED_KEY, !c);
      return !c;
    });

  const togglePin = (href: string) =>
    setPins((prev) => {
      const next = prev.includes(href)
        ? prev.filter((h) => h !== href)
        : [...prev, href];
      writePref(PINS_KEY, next);
      return next;
    });

  // Grupo da rota atual abre sozinho (inclusive em sub-rotas).
  const activeGroup = main.find(
    (e) => isGroup(e) && e.items.some((i) => i.href === current),
  )?.title;
  const [seenGroup, setSeenGroup] = useState<string | undefined>();
  if (activeGroup !== seenGroup) {
    setSeenGroup(activeGroup);
    if (activeGroup && !openGroups.includes(activeGroup)) {
      setOpenGroups([...openGroups, activeGroup]);
    }
  }

  // "\" recolhe ("[" já troca de conta na conciliação); "g" + tecla navega
  // (g p = Contas a Pagar). Escuta no document para chegar antes da lista
  // (window) e marcar a tecla como usada.
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']",
        )
      ) {
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => {
          writePref(COLLAPSED_KEY, !c);
          return !c;
        });
      } else if (e.key === "g") {
        gAt = Date.now();
      } else if (Date.now() - gAt < 1000) {
        gAt = 0;
        const item = flat.find((i) => i.shortcut === e.key);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flat, router]);

  const toggleGroup = (title: string) =>
    setOpenGroups((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );

  const link = (item: NavItem, opts: { pinnable?: boolean } = {}) => {
    const isActive = item.href === current;
    const count = item.badge ? badges[item.badge] : undefined;
    const hint = [
      item.title,
      count ? `${count} ${BADGE_LABEL[item.badge!]}` : null,
      item.shortcut ? `g ${item.shortcut}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    if (collapsed) {
      return (
        <Link
          key={item.href}
          href={item.href}
          title={hint}
          aria-label={hint}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors",
            isActive ? ACTIVE : IDLE,
          )}
        >
          <item.icon className="h-4 w-4" />
          {!!count && <Dot tone={DOT_TONE[item.badge!]} />}
        </Link>
      );
    }

    const isPinned = pins.includes(item.href);
    return (
      <div key={item.href} className="group/item relative">
        <Link
          href={item.href}
          title={item.shortcut ? `g ${item.shortcut}` : undefined}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
            isActive ? cn(ACTIVE, "font-medium") : IDLE,
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{item.title}</span>
          {!!count && (
            <span
              aria-label={`${count} ${BADGE_LABEL[item.badge!]}`}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums transition-opacity",
                opts.pinnable && "group-hover/item:opacity-0",
                BADGE_TONE[item.badge!],
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Link>
        {opts.pinnable && (
          <button
            type="button"
            onClick={() => togglePin(item.href)}
            aria-label={
              isPinned ? `Desafixar ${item.title}` : `Fixar ${item.title}`
            }
            title={isPinned ? "Desafixar" : "Fixar no topo"}
            className={cn(
              "absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", isPinned && "fill-current")} />
          </button>
        )}
      </div>
    );
  };

  // Itens de um grupo em menu (flyout do rail e Configurações): rótulo, selo e atalho.
  const menuItems = (items: NavItem[]) =>
    items.map((item) => {
      const count = item.badge ? badges[item.badge] : undefined;
      return (
        <DropdownMenuItem key={item.href} asChild>
          <Link
            href={item.href}
            aria-current={item.href === current ? "page" : undefined}
            className={cn(item.href === current && "bg-muted font-medium")}
          >
            <item.icon className="mr-2 h-3.5 w-3.5" />
            <span className="flex-1">{item.title}</span>
            {!!count && (
              <span
                aria-label={`${count} ${BADGE_LABEL[item.badge!]}`}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums",
                  BADGE_TONE[item.badge!],
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
            {item.shortcut && (
              <kbd className="ml-2 font-sans text-xs text-muted-foreground">
                g {item.shortcut}
              </kbd>
            )}
          </Link>
        </DropdownMenuItem>
      );
    });

  const groupFlyout = (g: NavGroup) => {
    const dot = groupDot(g.items);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={g.title}
            aria-label={g.title}
            className={cn(
              "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              g.items.some((i) => i.href === current) ? ACTIVE : IDLE,
            )}
          >
            <g.icon className="h-4 w-4" />
            {dot && <Dot tone={DOT_TONE[dot]} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-64"
        >
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            {g.title}
          </DropdownMenuLabel>
          {menuItems(g.items)}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const footerButton =
    "relative flex items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div
      className={cn(
        "hidden md:flex h-full flex-col border-r bg-card transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-64",
      )}
    >
      {/* Marca + recolher */}
      <div
        className={cn(
          "flex h-14 items-center border-b",
          collapsed ? "justify-center" : "gap-2.5 pl-5 pr-2",
        )}
      >
        {!collapsed && (
          <>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <TrendingUp className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="flex-1 text-base font-semibold tracking-tight">
              Fin Control
            </span>
          </>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={`${collapsed ? "Expandir" : "Recolher"} menu ( \\ )`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Empresa: recolhido, a sigla abre a lista ao lado (sem expandir o menu) */}
      <div
        className={cn("pt-3 pb-1", collapsed ? "flex justify-center" : "px-3")}
      >
        <CompanySwitcher compact={collapsed} />
      </div>

      <nav
        aria-label="Navegação principal"
        className={cn(
          "flex-1 overflow-y-auto py-2",
          collapsed ? "flex flex-col items-center gap-0.5 px-2" : "px-3",
        )}
      >
        {collapsed ? (
          main.map((e, i) => {
            // Divisor entre seções: grupo, ou item solto logo depois de grupo.
            const divided = i > 0 && (isGroup(e) || isGroup(main[i - 1]));
            return (
              <div
                key={isGroup(e) ? e.title : e.href}
                className={cn(divided && "mt-1 border-t pt-1")}
              >
                {isGroup(e) ? groupFlyout(e) : link(e)}
              </div>
            );
          })
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="mb-3">
                <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  Fixados
                </p>
                <div className="space-y-0.5">
                  {pinned.map((item) => link(item, { pinnable: true }))}
                </div>
              </div>
            )}
            <div className="space-y-0.5">
              {main.map((e) => {
                if (!isGroup(e)) return link(e, { pinnable: true });
                const isOpen = openGroups.includes(e.title);
                const dot = groupDot(e.items);
                return (
                  <Collapsible
                    key={e.title}
                    open={isOpen}
                    onOpenChange={() => toggleGroup(e.title)}
                    className="pt-2"
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                          activeGroup === e.title
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <e.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 text-left">{e.title}</span>
                        {/* Fechado, o grupo avisa que tem pendência dentro. */}
                        {!isOpen && dot && (
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              DOT_TONE[dot],
                            )}
                          />
                        )}
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 transition-transform duration-200",
                            isOpen && "rotate-90",
                          )}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-4.25 mt-0.5 space-y-0.5 border-l pl-2">
                        {e.items.map((item) => link(item, { pinnable: true }))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </>
        )}
      </nav>

      {/* Configurações, novidades, roadmap e documentos: fora do caminho do trabalho */}
      <div
        className={cn(
          "space-y-0.5 border-t py-2",
          collapsed ? "flex flex-col items-center px-2" : "px-3",
        )}
      >
        {settings && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={collapsed ? settings.title : undefined}
                aria-label={settings.title}
                className={cn(
                  footerButton,
                  settings.items.some((i) => i.href === current)
                    ? ACTIVE
                    : IDLE,
                  collapsed
                    ? "h-9 w-9 justify-center"
                    : "w-full gap-2.5 px-2.5 py-1.5",
                )}
              >
                <settings.icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <span className="flex-1 text-left">{settings.title}</span>
                )}
                {groupDot(settings.items) && (
                  <Dot
                    tone={DOT_TONE[groupDot(settings.items)!]}
                    inline={!collapsed}
                  />
                )}
                {!collapsed && <ChevronsUpDown className="h-3.5 w-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={collapsed ? "right" : "top"}
              align={collapsed ? "end" : "start"}
              sideOffset={8}
              className="w-60"
            >
              {menuItems(settings.items)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={collapsed ? "Novidades e roadmap" : undefined}
              aria-label="Novidades e roadmap"
              className={cn(
                footerButton,
                IDLE,
                collapsed
                  ? "h-9 w-9 justify-center"
                  : "w-full gap-2.5 px-2.5 py-1.5",
              )}
            >
              <Megaphone className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <span className="flex-1 text-left">Novidades e roadmap</span>
              )}
              {novidadesNew && (
                <Dot tone="bg-muted-foreground" inline={!collapsed} />
              )}
              {!collapsed && <ChevronsUpDown className="h-3.5 w-3.5" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem onClick={() => setNovidadesOpen(true)}>
              <Megaphone className="mr-2 h-3.5 w-3.5" />
              Novidades
              {novidadesNew && (
                <span className="ml-auto text-xs font-medium text-primary">
                  nova versão
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/roadmap">
                <MapIcon className="mr-2 h-3.5 w-3.5" />
                Roadmap e sugestões
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/feedback">
                <MessageSquare className="mr-2 h-3.5 w-3.5" />
                Enviar feedback
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/politica-privacidade" className="text-xs">
                Privacidade
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/termos-uso" className="text-xs">
                Termos de uso
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
