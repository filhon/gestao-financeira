"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Receipt,
  Users,
  Building2,
  Settings,
  FileText,
  Bell,
  Wallet,
  FolderTree,
  RotateCcw,
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  ClipboardList,
  Layers,
  Scale,
  Clock,
  ArrowRight,
  Loader2,
  Plus,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { usePermissions, Permissions } from "@/hooks/usePermissions";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { transactionService } from "@/lib/services/transactionService";
import { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

// ── Recent searches ───────────────────────────────────────────────────────────

function getRecentSearches(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(`recent-searches-${companyId}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(companyId: string, query: string): void {
  try {
    const prev = getRecentSearches(companyId);
    const next = [query, ...prev.filter((q) => q !== query)].slice(0, 5);
    localStorage.setItem(`recent-searches-${companyId}`, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (SSR, private browsing)
  }
}

// ── Matching utilities ────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesQueryPalette(t: Transaction, normalizedQ: string): boolean {
  return [
    t.description,
    t.supplierOrClient ?? "",
    t.requestOrigin?.name ?? "",
  ].some((f) => normalizeText(f).includes(normalizedQ));
}

// ── Navigation pages ──────────────────────────────────────────────────────────

type PermissionKey = keyof Permissions | "always";

interface NavigationPage {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  permission: PermissionKey;
}

const navigationPages: NavigationPage[] = [
  {
    name: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    keywords: ["dashboard", "inicio", "home", "principal"],
    permission: "canViewDashboard",
  },
  {
    name: "Contas a Pagar",
    href: "/financeiro/contas-pagar",
    icon: Receipt,
    keywords: ["pagar", "despesas", "saidas"],
    permission: "canViewPayables",
  },
  {
    name: "Contas a Receber",
    href: "/financeiro/contas-receber",
    icon: Wallet,
    keywords: ["receber", "receitas", "entradas"],
    permission: "canViewReceivables",
  },
  {
    name: "Conciliação Bancária",
    href: "/financeiro/conciliacao",
    icon: Scale,
    keywords: ["conciliacao", "banco", "extrato", "ofx"],
    permission: "canViewPayables",
  },
  {
    name: "Lotes de Pagamento",
    href: "/financeiro/lotes",
    icon: Layers,
    keywords: ["lotes", "batch", "pagamento"],
    permission: "canViewBatches",
  },
  {
    name: "Recorrências",
    href: "/financeiro/recorrencias",
    icon: RotateCcw,
    keywords: ["recorrencia", "automatico", "mensal"],
    permission: "canViewRecurrences",
  },
  {
    name: "Centros de Custo",
    href: "/centros-custo",
    icon: FolderTree,
    keywords: ["centro", "custo", "departamento"],
    permission: "canViewCostCenters",
  },
  {
    name: "Cadastros",
    href: "/cadastros",
    icon: ClipboardList,
    keywords: ["cadastro", "registro"],
    permission: "canViewEntities",
  },
  {
    name: "Entidades",
    href: "/cadastros/entidades",
    icon: Users,
    keywords: ["fornecedor", "cliente", "entidade"],
    permission: "canViewEntities",
  },
  {
    name: "Relatórios",
    href: "/relatorios",
    icon: FileText,
    keywords: ["relatorio", "report", "exportar"],
    permission: "canViewReports",
  },
  {
    name: "Configurações",
    href: "/configuracoes",
    icon: Settings,
    keywords: ["config", "settings", "opcoes"],
    permission: "canAccessSettings",
  },
  {
    name: "Usuários",
    href: "/configuracoes/usuarios",
    icon: Users,
    keywords: ["usuario", "user", "permissao"],
    permission: "canManageUsers",
  },
  {
    name: "Empresas",
    href: "/configuracoes/empresas",
    icon: Building2,
    keywords: ["empresa", "company", "holding"],
    permission: "canManageCompanies",
  },
  {
    name: "Auditoria",
    href: "/configuracoes/auditoria",
    icon: ShieldCheck,
    keywords: ["auditoria", "logs", "seguranca"],
    permission: "canViewAuditLogs",
  },
  {
    name: "Gerenciar Feedbacks",
    href: "/configuracoes/feedbacks",
    icon: MessageSquare,
    keywords: ["feedback", "admin", "gerenciar"],
    permission: "canManageFeedback",
  },
  {
    name: "Notificações",
    href: "/notificacoes",
    icon: Bell,
    keywords: ["notificacao", "alerta", "aviso"],
    permission: "always",
  },
  {
    name: "Feedback",
    href: "/feedback",
    icon: MessageSquare,
    keywords: ["feedback", "sugestao", "bug", "reportar"],
    permission: "always",
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const router = useRouter();
  const permissions = usePermissions();
  const { selectedCompany } = useCompany();
  const { user } = useAuth();

  // Handles open/close: clears query on close, loads recents on open
  const handleOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value);
      if (!value) {
        setSearchQuery("");
        setDebouncedQuery("");
      } else if (selectedCompany?.id) {
        setRecentSearches(getRecentSearches(selectedCompany.id));
      }
    },
    [selectedCompany],
  );

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        handleOpenChange(!open);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenChange, open]);

  // Debounce search query by 250ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // React Query — same queryKey as busca page so cache is shared
  const { data: allTransactions = [], isLoading: isLoadingTx } = useQuery({
    queryKey: [
      "busca-transactions",
      selectedCompany?.id,
      permissions.onlyOwnPayables ? user?.uid : null,
    ],
    queryFn: () =>
      transactionService.getAll({
        companyId: selectedCompany!.id,
        ...(permissions.onlyOwnPayables && user ? { createdBy: user.uid } : {}),
      }),
    enabled: open && !!selectedCompany && !!user,
    staleTime: 60_000,
  });

  // Derived state
  const isTextQuery = debouncedQuery.length > 0 && !searchQuery.startsWith("/");

  const { previewTransactions, totalMatchCount } = useMemo(() => {
    if (!isTextQuery) return { previewTransactions: [], totalMatchCount: 0 };
    const normalizedQ = normalizeText(debouncedQuery);
    const matches = allTransactions.filter((t) =>
      matchesQueryPalette(t, normalizedQ),
    );
    return {
      previewTransactions: matches.slice(0, 5),
      totalMatchCount: matches.length,
    };
  }, [allTransactions, debouncedQuery, isTextQuery]);

  const filteredPages = useMemo(() => {
    const permitted = navigationPages.filter((page) => {
      if (page.permission === "always") return true;
      return permissions[page.permission as keyof Permissions] === true;
    });
    if (!searchQuery.trim()) return permitted;
    const q = searchQuery.toLowerCase().replace(/^\//, "");
    return permitted.filter(
      (page) =>
        page.name.toLowerCase().includes(q) ||
        page.keywords.some((kw) => kw.includes(q)),
    );
  }, [searchQuery, permissions]);

  const actions = useMemo(() => {
    const items: { label: string; href: string }[] = [];
    if (permissions.canCreatePayables) {
      items.push({
        label: "Nova conta a pagar",
        href: "/financeiro/contas-pagar",
      });
    }
    if (permissions.canCreateReceivables) {
      items.push({
        label: "Novo recebível",
        href: "/financeiro/contas-receber",
      });
    }
    if (permissions.canViewPayables) {
      items.push({ label: "Importar OFX", href: "/financeiro/conciliacao" });
    }
    return items;
  }, [permissions]);

  // Handlers
  const handleSearch = useCallback(
    (q?: string) => {
      const term = (q ?? searchQuery).trim();
      if (!term) return;
      if (selectedCompany?.id) saveRecentSearch(selectedCompany.id, term);
      router.push(`/busca?q=${encodeURIComponent(term)}`);
      setOpen(false);
    },
    [searchQuery, router, selectedCompany],
  );

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
    },
    [router],
  );

  const showRecents = !searchQuery.trim() && recentSearches.length > 0;
  const showTransactions = isTextQuery;
  const showActions = !searchQuery.startsWith("/");

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Busca Global"
      description="Buscar transações ou navegar rapidamente"
    >
      <CommandInput
        placeholder="Buscar ou digite / para navegar..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList className="max-h-[380px]">
        <CommandEmpty>
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum resultado encontrado.
          </div>
        </CommandEmpty>

        {/* Recent searches — empty query only */}
        {showRecents && (
          <CommandGroup heading="Recentes">
            {recentSearches.map((q) => (
              <CommandItem
                key={`recent-${q}`}
                value={`recente ${q}`}
                onSelect={() => handleSearch(q)}
              >
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{q}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Transaction preview — text query only */}
        {showTransactions && (
          <>
            {showRecents && <CommandSeparator />}
            <CommandGroup heading="Transações">
              {isLoadingTx ? (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Buscando...
                </div>
              ) : previewTransactions.length > 0 ? (
                <>
                  {previewTransactions.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={[
                        t.description,
                        t.supplierOrClient,
                        t.requestOrigin?.name,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onSelect={() =>
                        handleNavigate(
                          t.type === "payable"
                            ? "/financeiro/contas-pagar"
                            : "/financeiro/contas-receber",
                        )
                      }
                    >
                      <span
                        className={cn(
                          "shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          t.type === "payable"
                            ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
                            : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {t.type === "payable" ? "Pagar" : "Receber"}
                      </span>
                      <span className="ml-2 flex-1 truncate text-sm">
                        {t.description}
                      </span>
                      <span
                        className={cn(
                          "ml-auto shrink-0 font-financial tabular-nums text-xs",
                          t.type === "payable"
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {t.type === "payable" ? "−" : "+"}
                        {formatCurrency(t.amount)}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {format(t.dueDate, "dd/MM", { locale: ptBR })}
                      </span>
                    </CommandItem>
                  ))}
                  <CommandItem
                    value={`ver todos ${debouncedQuery}`}
                    onSelect={() => handleSearch()}
                    className="text-muted-foreground"
                  >
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Ver todos os {totalMatchCount} resultado
                    {totalMatchCount !== 1 ? "s" : ""}
                  </CommandItem>
                </>
              ) : (
                <CommandItem
                  value={`buscar ${debouncedQuery}`}
                  onSelect={() => handleSearch()}
                >
                  <Search className="mr-2 h-4 w-4" />
                  Buscar por &quot;{debouncedQuery}&quot;
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Navigation */}
        {filteredPages.length > 0 && (
          <CommandGroup heading="Navegação Rápida">
            {filteredPages.map((page) => (
              <CommandItem
                key={page.href}
                onSelect={() => handleNavigate(page.href)}
              >
                <page.icon className="mr-2 h-4 w-4" />
                <span>{page.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Actions */}
        {showActions && actions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Ações">
              {actions.map(({ label, href }) => (
                <CommandItem
                  key={label}
                  value={label}
                  onSelect={() => handleNavigate(href)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>

      {/* Keyboard shortcuts footer */}
      <div className="flex items-center gap-2 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span>↑↓ navegar</span>
        <span className="opacity-40">·</span>
        <span>↵ abrir</span>
        <span className="opacity-40">·</span>
        <span>esc fechar</span>
      </div>
    </CommandDialog>
  );
}
