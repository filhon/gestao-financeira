"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { userService } from "@/lib/services/userService";
import { costCenterService } from "@/lib/services/costCenterService";
import { entityService } from "@/lib/services/entityService";
import { useCompany } from "@/components/providers/CompanyProvider";

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
    const { user } = useAuth();
    const { selectedCompany } = useCompany();
    const [dynamicLabels, setDynamicLabels] = useState<Record<string, string>>({});

    // Memoize segments to prevent infinite loop - segments was being recreated on every render
    const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);

    // Fetch dynamic labels for IDs - hooks must be called before any early returns
    useEffect(() => {
        // Don't fetch for root pages
        if (pathname === "/" || pathname === "/login") return;

        const fetchDynamicLabels = async () => {
            const labels: Record<string, string> = {};

            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                const prevSegment = segments[i - 1];

                // Check if it's a dynamic ID (UUID-like or Firebase ID)
                if (segment.match(/^[a-zA-Z0-9]{20,}$/i)) {
                    // Profile page
                    if (prevSegment === "perfil") {
                        if (user && segment === user.uid) {
                            labels[segment] = "Meu Perfil";
                        } else {
                            // Admin viewing another user's profile
                            try {
                                const profileUser = await userService.getById(segment);
                                labels[segment] = profileUser?.displayName || "Perfil";
                            } catch {
                                labels[segment] = "Perfil";
                            }
                        }
                    }
                    // Cost center page
                    else if (prevSegment === "centros-custo") {
                        if (selectedCompany) {
                            try {
                                const costCenters = await costCenterService.getAll(selectedCompany.id);
                                const cc = costCenters.find(c => c.id === segment);
                                labels[segment] = cc?.name || "Detalhes";
                            } catch {
                                labels[segment] = "Detalhes";
                            }
                        }
                    }
                    // Entity page
                    else if (prevSegment === "entidades") {
                        if (selectedCompany) {
                            try {
                                const entities = await entityService.getAll(selectedCompany.id);
                                const entity = entities.find(e => e.id === segment);
                                labels[segment] = entity?.name || "Detalhes";
                            } catch {
                                labels[segment] = "Detalhes";
                            }
                        }
                    }
                }
            }

            if (Object.keys(labels).length > 0) {
                setDynamicLabels(labels);
            }
        };

        fetchDynamicLabels();
    }, [pathname, user, selectedCompany, segments]);

    // Don't show breadcrumbs on root - this return is now AFTER all hooks
    if (pathname === "/" || pathname === "/login") {
        return null;
    }

    // Build breadcrumb items
    const breadcrumbs = segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;

        // Check if we have a dynamic label for this segment
        if (dynamicLabels[segment]) {
            return {
                href,
                label: dynamicLabels[segment],
                isLast,
            };
        }

        // Skip dynamic segments if no label found yet
        if (segment.match(/^[a-zA-Z0-9]{20,}$/i)) {
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

