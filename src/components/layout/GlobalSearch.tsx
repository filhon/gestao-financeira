"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Receipt,
  ReceiptText,
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
  ListTree,
  Landmark,
  ClipboardList,
  Layers,
  Scale,
  Clock,
  Bookmark,
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
import {
  recentSearches,
  savedSearches,
  useSearch,
  type SavedSearch,
} from "@/hooks/useSearch";
import { normalizeText, statusKey, statusLabel } from "@/lib/search/query";
import { useTransactionDetailStore } from "@/lib/store/useTransactionDetailStore";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
    permission: "canViewReconciliation",
  },
  {
    name: "Lotes de Pagamento",
    href: "/financeiro/lotes",
    icon: Layers,
    keywords: ["lotes", "batch", "pagamento"],
    permission: "canViewBatches",
  },
  {
    name: "Reembolsos",
    href: "/financeiro/reembolsos",
    icon: ReceiptText,
    keywords: ["reembolso", "rd", "despesa", "relatorio de despesa"],
    permission: "canViewPayables",
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
    name: "Plano de Contas",
    href: "/cadastros/plano-de-contas",
    icon: ListTree,
    keywords: [
      "plano",
      "contas",
      "contabil",
      "categoria",
      "dre",
      "classificacao",
    ],
    permission: "canViewChartOfAccounts",
  },
  {
    name: "Contas Bancárias",
    href: "/cadastros/contas-bancarias",
    icon: Landmark,
    keywords: ["banco", "conta corrente", "saldo", "agência"],
    permission: "canViewBankAccounts",
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

const matches = (q: string, ...texts: string[]) =>
  texts.some((t) => normalizeText(t).includes(q));

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);

  const router = useRouter();
  const permissions = usePermissions();
  const { selectedCompany } = useCompany();
  const { openTransaction } = useTransactionDetailStore();

  // Abrir carrega recentes e salvas; fechar limpa o campo.
  const handleOpenChange = useCallback(
    (value: boolean) => {
      setOpen(value);
      if (!value) {
        setSearchQuery("");
        setDebouncedQuery("");
      } else if (selectedCompany?.id) {
        setRecent(recentSearches.get(selectedCompany.id));
        setSaved(savedSearches.get(selectedCompany.id));
      }
    },
    [selectedCompany],
  );

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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isNav = searchQuery.startsWith("/");
  const textQuery = !isNav && debouncedQuery.length >= 2 ? debouncedQuery : "";
  const q = normalizeText(searchQuery.replace(/^\//, "").trim());

  // Mesma rota e mesma linguagem da página /busca: o que aparece aqui é um
  // recorte do que "Ver todos" vai mostrar.
  const { data, isFetching } = useSearch(textQuery, {
    limit: 5,
    enabled: open,
  });
  const result = textQuery && data ? data : null;

  const filteredPages = useMemo(() => {
    const permitted = navigationPages.filter(
      (page) =>
        page.permission === "always" ||
        permissions[page.permission as keyof Permissions] === true,
    );
    if (!q) return permitted;
    return permitted.filter((page) => matches(q, page.name, ...page.keywords));
  }, [q, permissions]);

  const actions = useMemo(() => {
    const items: { label: string; href: string }[] = [];
    if (permissions.canCreatePayables)
      items.push({
        label: "Nova conta a pagar",
        href: "/financeiro/contas-pagar?novo=1",
      });
    if (permissions.canCreateReceivables)
      items.push({
        label: "Nova conta a receber",
        href: "/financeiro/contas-receber?novo=1",
      });
    if (permissions.canManageReconciliation)
      items.push({
        label: "Importar extrato (OFX)",
        href: "/financeiro/conciliacao",
      });
    return q ? items.filter((a) => matches(q, a.label)) : items;
  }, [permissions, q]);

  const close = () => setOpen(false);

  const handleSearch = useCallback(
    (term: string) => {
      const t = term.trim();
      if (!t) return;
      if (selectedCompany?.id) recentSearches.add(selectedCompany.id, t);
      router.push(`/busca?q=${encodeURIComponent(t)}`);
      setOpen(false);
    },
    [router, selectedCompany],
  );

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
    },
    [router],
  );

  const empty = !searchQuery.trim();
  const today = new Date();

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      title="Busca global"
      description="Buscar transações, cadastros, lotes e RDs, ou navegar"
    >
      <CommandInput
        placeholder="Buscar, ou / para ir a uma tela"
        className="pr-8"
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nenhum resultado.
          </div>
        </CommandEmpty>

        {empty && saved.length > 0 && (
          <CommandGroup heading="Buscas salvas">
            {saved.map((s) => (
              <CommandItem
                key={`saved-${s.name}`}
                value={`salva ${s.name}`}
                onSelect={() => handleNavigate(`/busca?${s.params}`)}
              >
                <Bookmark className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{s.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {empty && recent.length > 0 && (
          <CommandGroup heading="Recentes">
            {recent.map((r) => (
              <CommandItem
                key={`recent-${r}`}
                value={`recente ${r}`}
                onSelect={() => handleSearch(r)}
              >
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{r}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {textQuery && (
          <CommandGroup heading="Transações">
            <CommandItem
              value={`buscar ${textQuery}`}
              onSelect={() => handleSearch(searchQuery)}
            >
              <Search className="mr-2 h-4 w-4" />
              <span className="flex-1 truncate">
                Buscar “{searchQuery.trim()}”
              </span>
              <span className="text-xs text-muted-foreground">
                {isFetching && !result ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : result ? (
                  `${result.total.toLocaleString("pt-BR")} resultado${result.total !== 1 ? "s" : ""}`
                ) : null}
              </span>
            </CommandItem>
            {result?.rows.map(({ tx }) => {
              const late = statusKey(tx, today) === "late";
              return (
                <CommandItem
                  key={tx.id}
                  value={`tx ${tx.id}`}
                  onSelect={() => {
                    openTransaction(tx);
                    close();
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {tx.description}
                    </span>
                    {tx.supplierOrClient && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {tx.supplierOrClient}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      late
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {statusLabel(tx, today)}
                  </span>
                  <span
                    className={cn(
                      "ml-3 shrink-0 font-financial text-xs tabular-nums",
                      tx.type === "receivable" &&
                        "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {tx.type === "payable" ? "−" : "+"}
                    {formatCurrency(tx.amount)}
                  </span>
                  <span className="ml-3 w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {format(tx.dueDate, "dd/MM/yy")}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {result && result.entities.length > 0 && (
          <CommandGroup heading="Cadastros">
            {result.entities.map((e) => (
              <CommandItem
                key={e.id}
                value={`entidade ${e.id}`}
                onSelect={() => handleNavigate(`/cadastros/entidades/${e.id}`)}
              >
                <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{e.name}</span>
                {e.document && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {e.document}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {result && result.batches.length > 0 && (
          <CommandGroup heading="Lotes de pagamento">
            {result.batches.map((b) => (
              <CommandItem
                key={b.id}
                value={`lote ${b.id}`}
                onSelect={() => handleNavigate(`/financeiro/lotes/${b.id}`)}
              >
                <Layers className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{b.name}</span>
                <span className="font-financial text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(b.totalAmount)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {result && result.reimbursements.length > 0 && (
          <CommandGroup heading="Reembolsos">
            {result.reimbursements.map((r) => (
              <CommandItem
                key={r.id}
                value={`rd ${r.id}`}
                onSelect={() => handleNavigate("/financeiro/reembolsos")}
              >
                <ReceiptText className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">
                  {r.rdNumber} · {r.employeeName}
                </span>
                <span className="font-financial text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(r.totalAmount)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredPages.length > 0 && (
          <>
            {!empty && <CommandSeparator />}
            <CommandGroup heading="Ir para">
              {filteredPages.map((page) => (
                <CommandItem
                  key={page.href}
                  value={`pagina ${page.href}`}
                  onSelect={() => handleNavigate(page.href)}
                >
                  <page.icon className="mr-2 h-4 w-4" />
                  <span>{page.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {!isNav && actions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Ações">
              {actions.map(({ label, href }) => (
                <CommandItem
                  key={label}
                  value={`acao ${label}`}
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

      <div className="flex items-center gap-2 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span>↑↓ navegar</span>
        <span className="opacity-40">·</span>
        <span>↵ abrir</span>
        <span className="opacity-40">·</span>
        <span>/ telas</span>
        <span className="opacity-40">·</span>
        <span>esc fechar</span>
      </div>
    </CommandDialog>
  );
}
