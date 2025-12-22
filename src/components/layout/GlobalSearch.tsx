"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
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

// Quick navigation pages with permission requirements
type PermissionKey = keyof Permissions | 'always';

interface NavigationPage {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    keywords: string[];
    permission: PermissionKey;
}

const navigationPages: NavigationPage[] = [
    // Dashboard - everyone can see
    { name: "Dashboard", href: "/", icon: LayoutDashboard, keywords: ["dashboard", "inicio", "home", "principal"], permission: "canViewDashboard" },
    
    // Financeiro
    { name: "Contas a Pagar", href: "/financeiro/contas-pagar", icon: Receipt, keywords: ["pagar", "despesas", "saidas"], permission: "canViewPayables" },
    { name: "Contas a Receber", href: "/financeiro/contas-receber", icon: Wallet, keywords: ["receber", "receitas", "entradas"], permission: "canViewReceivables" },
    { name: "Lotes de Pagamento", href: "/financeiro/lotes", icon: Layers, keywords: ["lotes", "batch", "pagamento"], permission: "canViewBatches" },
    { name: "Recorrências", href: "/financeiro/recorrencias", icon: RotateCcw, keywords: ["recorrencia", "automatico", "mensal"], permission: "canViewRecurrences" },
    
    // Centros de Custo
    { name: "Centros de Custo", href: "/centros-custo", icon: FolderTree, keywords: ["centro", "custo", "departamento"], permission: "canViewCostCenters" },
    
    // Cadastros
    { name: "Cadastros", href: "/cadastros", icon: ClipboardList, keywords: ["cadastro", "registro"], permission: "canViewEntities" },
    { name: "Entidades", href: "/cadastros/entidades", icon: Users, keywords: ["fornecedor", "cliente", "entidade"], permission: "canViewEntities" },
    
    // Relatórios
    { name: "Relatórios", href: "/relatorios", icon: FileText, keywords: ["relatorio", "report", "exportar"], permission: "canViewReports" },
    
    // Configurações
    { name: "Configurações", href: "/configuracoes", icon: Settings, keywords: ["config", "settings", "opcoes"], permission: "canAccessSettings" },
    { name: "Usuários", href: "/configuracoes/usuarios", icon: Users, keywords: ["usuario", "user", "permissao"], permission: "canManageUsers" },
    { name: "Empresas", href: "/configuracoes/empresas", icon: Building2, keywords: ["empresa", "company", "holding"], permission: "canManageCompanies" },
    { name: "Auditoria", href: "/configuracoes/auditoria", icon: ShieldCheck, keywords: ["auditoria", "logs", "seguranca"], permission: "canViewAuditLogs" },
    { name: "Gerenciar Feedbacks", href: "/configuracoes/feedbacks", icon: MessageSquare, keywords: ["feedback", "admin", "gerenciar"], permission: "canManageFeedback" },
    
    // Sistema - always visible
    { name: "Notificações", href: "/notificacoes", icon: Bell, keywords: ["notificacao", "alerta", "aviso"], permission: "always" },
    { name: "Feedback", href: "/feedback", icon: MessageSquare, keywords: ["feedback", "sugestao", "bug", "reportar"], permission: "always" },
];

export function GlobalSearch() {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const router = useRouter();
    const permissions = usePermissions();

    // Handle Ctrl+K / Cmd+K keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Filter navigation pages based on permissions and query
    const filteredPages = useMemo(() => {
        // First filter by permissions
        const permittedPages = navigationPages.filter(page => {
            if (page.permission === 'always') return true;
            return permissions[page.permission] === true;
        });

        // Then filter by search query
        if (!searchQuery.trim()) return permittedPages;

        const query = searchQuery.toLowerCase().replace(/^\//, "");
        return permittedPages.filter(page =>
            page.name.toLowerCase().includes(query) ||
            page.keywords.some(kw => kw.includes(query))
        );
    }, [searchQuery, permissions]);

    const handleSearch = useCallback(() => {
        if (searchQuery.trim()) {
            router.push(`/busca?q=${encodeURIComponent(searchQuery.trim())}`);
            setOpen(false);
            setSearchQuery("");
        }
    }, [searchQuery, router]);

    const handleNavigate = useCallback((href: string) => {
        router.push(href);
        setOpen(false);
        setSearchQuery("");
    }, [router]);

    // Only trigger search if Enter is pressed with text and no navigation item is selected
    // The cmdk library handles Enter for selected items via onSelect
    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        // If pressing Enter with search text, check if user explicitly wants to search
        // This happens when there's text but the user hasn't selected a navigation item
        if (e.key === "Enter" && searchQuery.trim() && !searchQuery.startsWith("/")) {
            // Get the currently selected item from cmdk
            const selectedItem = document.querySelector('[cmdk-item][data-selected="true"]');

            // Only perform search if no item is selected OR the search item is selected
            if (!selectedItem || selectedItem.textContent?.includes(`Buscar por`)) {
                e.preventDefault();
                handleSearch();
            }
            // Otherwise, let cmdk handle the navigation to the selected item
        }
    };

    return (
        <CommandDialog
            open={open}
            onOpenChange={setOpen}
            title="Busca Global"
            description="Buscar transações ou navegar rapidamente"
        >
            <CommandInput
                placeholder="Buscar ou digite / para navegar..."
                value={searchQuery}
                onValueChange={setSearchQuery}
                onKeyDown={handleInputKeyDown}
            />
            <CommandList>
                <CommandEmpty>
                    <div className="py-6 text-center text-sm text-muted-foreground">
                        Nenhum resultado encontrado.
                    </div>
                </CommandEmpty>

                {/* Quick Navigation */}
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

                {/* Search action */}
                {searchQuery.trim() && !searchQuery.startsWith("/") && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Buscar">
                            <CommandItem onSelect={handleSearch}>
                                <Search className="mr-2 h-4 w-4" />
                                <span>Buscar por &quot;{searchQuery}&quot;</span>
                            </CommandItem>
                        </CommandGroup>
                    </>
                )}
            </CommandList>
        </CommandDialog>
    );
}

