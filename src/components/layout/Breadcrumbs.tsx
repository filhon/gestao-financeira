"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";

// Map of paths to display names
const pathNames: Record<string, string> = {
    "financeiro": "Financeiro",
    "contas-pagar": "Contas a Pagar",
    "contas-receber": "Contas a Receber",
    "lotes": "Lotes de Pagamento",
    "recorrencias": "Recorrências",
    "cadastros": "Cadastros",
    "entidades": "Entidades",
    "centros-custo": "Centros de Custo",
    "configuracoes": "Configurações",
    "empresas": "Empresas",
    "usuarios": "Usuários",
    "auditoria": "Auditoria",
    "relatorios": "Relatórios",
    "busca": "Busca",
    "notificacoes": "Notificações",
    "perfil": "Perfil",
};

export function Breadcrumbs() {
    const pathname = usePathname();

    // Don't show breadcrumbs on root
    if (pathname === "/" || pathname === "/login") {
        return null;
    }

    const segments = pathname.split("/").filter(Boolean);

    // Build breadcrumb items
    const breadcrumbs = segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;

        // Skip dynamic segments like [id] - show them as the previous segment's detail
        if (segment.match(/^[a-f0-9-]{20,}$/i)) {
            return null;
        }

        const displayName = pathNames[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);

        return {
            href,
            label: displayName,
            isLast,
        };
    }).filter(Boolean);

    if (breadcrumbs.length === 0) {
        return null;
    }

    return (
        <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex items-center gap-1 text-sm text-muted-foreground">
                <li>
                    <Link
                        href="/"
                        className="flex items-center hover:text-foreground transition-colors"
                    >
                        <Home className="h-4 w-4" />
                    </Link>
                </li>
                {breadcrumbs.map((crumb, index) => (
                    <Fragment key={index}>
                        <li>
                            <ChevronRight className="h-4 w-4" />
                        </li>
                        <li>
                            {crumb!.isLast ? (
                                <span className="font-medium text-foreground">
                                    {crumb!.label}
                                </span>
                            ) : (
                                <Link
                                    href={crumb!.href}
                                    className="hover:text-foreground transition-colors"
                                >
                                    {crumb!.label}
                                </Link>
                            )}
                        </li>
                    </Fragment>
                ))}
            </ol>
        </nav>
    );
}
