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
    RotateCcw
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

// Quick navigation pages
const navigationPages = [
    { name: "Contas a Pagar", href: "/financeiro/contas-pagar", icon: Receipt, keywords: ["pagar", "despesas", "saidas"] },
    { name: "Contas a Receber", href: "/financeiro/contas-receber", icon: Wallet, keywords: ["receber", "receitas", "entradas"] },
    { name: "Lotes de Pagamento", href: "/financeiro/lotes", icon: FileText, keywords: ["lotes", "batch"] },
    { name: "Recorrências", href: "/financeiro/recorrencias", icon: RotateCcw, keywords: ["recorrencia", "automatico"] },
    { name: "Centros de Custo", href: "/centros-custo", icon: FolderTree, keywords: ["centro", "custo", "departamento"] },
    { name: "Entidades", href: "/cadastros/entidades", icon: Users, keywords: ["fornecedor", "cliente", "entidade"] },
    { name: "Empresas", href: "/configuracoes/empresas", icon: Building2, keywords: ["empresa", "company"] },
    { name: "Usuários", href: "/configuracoes/usuarios", icon: Users, keywords: ["usuario", "user"] },
    { name: "Configurações", href: "/configuracoes", icon: Settings, keywords: ["config", "settings"] },
    { name: "Relatórios", href: "/relatorios", icon: FileText, keywords: ["relatorio", "report"] },
    { name: "Notificações", href: "/notificacoes", icon: Bell, keywords: ["notificacao", "alerta"] },
];

export function GlobalSearch() {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const router = useRouter();

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

    // Filter navigation pages based on query
    const filteredPages = useMemo(() => {
        if (!searchQuery.trim()) return navigationPages;

        const query = searchQuery.toLowerCase().replace(/^\//, "");
        return navigationPages.filter(page =>
            page.name.toLowerCase().includes(query) ||
            page.keywords.some(kw => kw.includes(query))
        );
    }, [searchQuery]);

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
                    {filteredPages.slice(0, 6).map((page) => (
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

