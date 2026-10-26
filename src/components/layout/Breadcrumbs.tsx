"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";

// Map of paths to display names
const pathNames: Record<string, string> = {
  financeiro: "Financeiro",
  "contas-pagar": "Contas a Pagar",
  "contas-receber": "Contas a Receber",
  lotes: "Lotes de Pagamento",
  recorrencias: "Recorrências",
  conciliacao: "Conciliação Bancária",
  comprovantes: "Comprovantes",
  regras: "Regras",
  reembolsos: "Reembolsos",
  "contas-bancarias": "Contas Bancárias",
  cadastros: "Cadastros",
  entidades: "Entidades",
  "plano-de-contas": "Plano de Contas",
  "centros-custo": "Centros de Custo",
  configuracoes: "Configurações",
  empresas: "Empresas",
  usuarios: "Usuários",
  auditoria: "Auditoria",
  relatorios: "Relatórios",
  busca: "Busca",
  notificacoes: "Notificações",
  perfil: "Perfil",
  "documentos-legais": "Documentos Legais",
  feedbacks: "Feedbacks",
};

/**
 * Só o caminho até a tela: onde ela está é o h1 dela. Por isso o último
 * segmento (inclusive o id de um registro) nunca aparece, e telas de primeiro
 * nível não têm breadcrumb.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const ancestors = pathname.split("/").filter(Boolean).slice(0, -1);

  if (ancestors.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-1.5">
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        <li>
          <Link
            href="/dashboard"
            aria-label="Início"
            className="flex items-center hover:text-foreground transition-colors"
          >
            <Home className="h-4 w-4" />
          </Link>
        </li>
        {ancestors.map((segment, index) => (
          <Fragment key={segment}>
            <li aria-hidden>
              <ChevronRight className="h-4 w-4" />
            </li>
            <li>
              <Link
                href={"/" + ancestors.slice(0, index + 1).join("/")}
                className="hover:text-foreground transition-colors"
              >
                {pathNames[segment] ||
                  segment.charAt(0).toUpperCase() + segment.slice(1)}
              </Link>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
