import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Inbox,
  Wallet,
  Receipt,
  RefreshCw,
  Scale,
  Layers,
  FileCheck,
  ReceiptText,
  Users,
  PieChart,
  ListTree,
  Landmark,
  FileText,
  Settings,
  CalendarClock,
  Database,
  UserCog,
  Building2,
  MessageSquare,
  ShieldCheck,
  Key,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Permissions } from "@/hooks/usePermissions";
import { queueStatuses, tabFilter } from "@/lib/transactionTabs";
import { transactionService } from "@/lib/services/transactionService";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { feedbackService } from "@/lib/services/feedbackService";
import { startOfDay } from "date-fns";

/**
 * Navegação única do app: sidebar, menu mobile e atalhos "g + tecla" leem
 * daqui. Duas listas paralelas já divergiram uma vez (mobile sem Reembolsos).
 */

export type NavBadge = "queue" | "overdue" | "comprovantes" | "feedbacks";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  visible?: (p: Permissions) => boolean;
  /** Segunda tecla do atalho: "p" = g p. */
  shortcut?: string;
  badge?: NavBadge;
}

export interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

const hasQueue = (p: Permissions) => queueStatuses(p.currentRole).length > 0;

export const NAV: NavEntry[] = [
  {
    title: "Início",
    href: "/dashboard",
    icon: LayoutDashboard,
    visible: (p) => p.canViewDashboard,
    shortcut: "i",
  },
  {
    title: "Minha fila",
    href: "/financeiro/contas-pagar?tab=queue",
    icon: Inbox,
    visible: hasQueue,
    shortcut: "f",
    badge: "queue",
  },
  {
    title: "Contas a Pagar",
    href: "/financeiro/contas-pagar",
    icon: Wallet,
    visible: (p) => p.canViewPayables,
    shortcut: "p",
    badge: "overdue",
  },
  {
    title: "Contas a Receber",
    href: "/financeiro/contas-receber",
    icon: Receipt,
    visible: (p) => p.canViewReceivables,
    shortcut: "r",
  },
  {
    title: "Rotinas",
    icon: CalendarClock,
    items: [
      {
        title: "Lotes de Pagamento",
        href: "/financeiro/lotes",
        icon: Layers,
        visible: (p) => p.canViewBatches,
        shortcut: "l",
      },
      {
        title: "Comprovantes",
        href: "/financeiro/comprovantes",
        icon: FileCheck,
        visible: (p) => p.canViewPayables,
        shortcut: "c",
        badge: "comprovantes",
      },
      {
        title: "Conciliação Bancária",
        href: "/financeiro/conciliacao",
        icon: Scale,
        visible: (p) => p.canViewReconciliation,
        shortcut: "b",
      },
      {
        title: "Recorrências",
        href: "/financeiro/recorrencias",
        icon: RefreshCw,
        visible: (p) => p.canViewRecurrences,
      },
      {
        title: "Reembolsos",
        href: "/financeiro/reembolsos",
        icon: ReceiptText,
        visible: (p) => p.canViewPayables,
      },
    ],
  },
  {
    title: "Cadastros",
    icon: Database,
    items: [
      {
        title: "Fornecedores e Clientes",
        href: "/cadastros/entidades",
        icon: Users,
        visible: (p) => p.canViewEntities,
        shortcut: "e",
      },
      {
        title: "Centros de Custo",
        href: "/centros-custo",
        icon: PieChart,
        visible: (p) => p.canViewCostCenters,
      },
      {
        title: "Plano de Contas",
        href: "/cadastros/plano-de-contas",
        icon: ListTree,
        visible: (p) => p.canViewChartOfAccounts,
      },
      {
        title: "Contas Bancárias",
        href: "/cadastros/contas-bancarias",
        icon: Landmark,
        visible: (p) => p.canViewBankAccounts,
      },
    ],
  },
  {
    title: "Relatórios",
    href: "/relatorios",
    icon: FileText,
    visible: (p) => p.canViewReports,
  },
  {
    title: "Configurações",
    icon: Settings,
    items: [
      {
        title: "Usuários",
        href: "/configuracoes/usuarios",
        icon: UserCog,
        visible: (p) => p.canManageUsers,
      },
      {
        title: "Empresas",
        href: "/configuracoes/empresas",
        icon: Building2,
        visible: (p) => p.canManageCompanies,
      },
      {
        title: "Feedbacks",
        href: "/configuracoes/feedbacks",
        icon: MessageSquare,
        visible: (p) => p.canManageFeedback,
        badge: "feedbacks",
      },
      {
        title: "Auditoria",
        href: "/configuracoes/auditoria",
        icon: ShieldCheck,
        visible: (p) => p.canViewAuditLogs,
      },
      {
        title: "Chaves de API",
        href: "/configuracoes/api-keys",
        icon: Key,
        visible: (p) => p.canManageCompanies,
      },
      {
        title: "Documentos Legais",
        href: "/configuracoes/documentos-legais",
        icon: FileText,
        visible: (p) => p.canAccessSettings,
      },
      {
        title: "Sistema",
        href: "/configuracoes/sistema",
        icon: Wrench,
        visible: (p) => p.canManageCompanies,
      },
    ],
  },
];

/** NAV sem o que o papel não vê; grupo sem item visível some. */
export function visibleNav(p: Permissions): NavEntry[] {
  const ok = (i: NavItem) => !i.visible || i.visible(p);
  return NAV.flatMap((e): NavEntry[] => {
    if (!isGroup(e)) return ok(e) ? [e] : [];
    const items = e.items.filter(ok);
    return items.length ? [{ ...e, items }] : [];
  });
}

export const flatNav = (entries: NavEntry[]): NavItem[] =>
  entries.flatMap((e) => (isGroup(e) ? e.items : [e]));

/**
 * Item ativo = o de caminho mais longo que é prefixo da rota. Assim
 * /centros-custo/abc acende Centros de Custo, e /cadastros/plano-de-contas não
 * acende um eventual /cadastros. Links com query (Minha fila) são atalhos e
 * nunca ficam ativos.
 */
export function activeHref(pathname: string, items: NavItem[]) {
  let best: string | null = null;
  for (const { href } of items) {
    if (href.includes("?")) continue;
    const hit = pathname === href || pathname.startsWith(href + "/");
    if (hit && (!best || href.length > best.length)) best = href;
  }
  return best;
}

/** Contagens que pedem ação de quem está logado. Ausente = sem selo. */
export function useNavBadges(
  p: Permissions,
): Partial<Record<NavBadge, number>> {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const queue = queueStatuses(p.currentRole);
  const canPay = p.canPayPayables;

  // Mesmos filtros das abas da lista; a chave começa com ["tx-tabs",
  // "payable"] para refreshTransactionList recontar junto.
  const tx = useQuery({
    queryKey: ["tx-tabs", "payable", companyId, "nav", queue.join(), canPay],
    queryFn: async () => {
      const ctx = {
        type: "payable" as const,
        today: startOfDay(new Date()),
        status: "all",
        queue,
      };
      const [q, overdue] = await transactionService.getTabTotals(companyId!, [
        tabFilter("queue", ctx),
        canPay ? tabFilter("overdue", ctx) : null,
      ]);
      return { queue: q.count, overdue: overdue.count };
    },
    enabled: !!companyId && !!user && (queue.length > 0 || canPay),
    staleTime: 60_000,
  });

  const comprovantes = useQuery({
    queryKey: ["comprovantes-pending-count", companyId],
    queryFn: () =>
      comprovanteService.count(companyId!, { statuses: ["pending_review"] }),
    enabled: !!companyId && !!user && canPay,
    staleTime: 60_000,
  });

  const feedbacks = useQuery({
    queryKey: ["feedbacks-unread-count"],
    queryFn: () => feedbackService.getUnreadCount(),
    enabled: !!user && p.canManageFeedback,
    staleTime: 60_000,
  });

  return {
    queue: queue.length ? tx.data?.queue : undefined,
    overdue: canPay ? tx.data?.overdue : undefined,
    comprovantes: canPay ? comprovantes.data : undefined,
    feedbacks: p.canManageFeedback ? feedbacks.data : undefined,
  };
}
