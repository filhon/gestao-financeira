"use client";

import Link from "next/link";
import {
  Users,
  Building2,
  ChevronRight,
  ShieldCheck,
  MessageSquare,
  FileText,
  Wrench,
  Key,
} from "lucide-react";

import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface SettingsItem {
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  show: boolean;
  color: string;
  iconBg: string;
  iconBgDark: string;
}

interface SettingsGroup {
  label: string;
  items: SettingsItem[];
}

export default function SettingsPage() {
  const router = useRouter();
  const {
    canAccessSettings,
    canManageUsers,
    canManageCompanies,
    canViewAuditLogs,
    canManageFeedback,
  } = usePermissions();

  useEffect(() => {
    if (!canAccessSettings) {
      router.push("/dashboard");
    }
  }, [canAccessSettings, router]);

  if (!canAccessSettings) return null;

  const groups: SettingsGroup[] = [
    {
      label: "Gestão",
      items: [
        {
          title: "Usuários",
          description: "Gerencie usuários, funções e permissões de acesso.",
          href: "/configuracoes/usuarios",
          icon: Users,
          show: canManageUsers,
          color: "text-blue-600 dark:text-blue-400",
          iconBg: "bg-blue-50 dark:bg-blue-950/60",
          iconBgDark: "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/60",
        },
        {
          title: "Empresas",
          description: "Gerencie as empresas do grupo (Holding).",
          href: "/configuracoes/empresas",
          icon: Building2,
          show: canManageCompanies,
          color: "text-violet-600 dark:text-violet-400",
          iconBg: "bg-violet-50 dark:bg-violet-950/60",
          iconBgDark:
            "group-hover:bg-violet-100 dark:group-hover:bg-violet-900/60",
        },
        {
          title: "Feedbacks",
          description: "Visualize e responda aos feedbacks dos usuários.",
          href: "/configuracoes/feedbacks",
          icon: MessageSquare,
          show: canManageFeedback,
          color: "text-emerald-600 dark:text-emerald-400",
          iconBg: "bg-emerald-50 dark:bg-emerald-950/60",
          iconBgDark:
            "group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/60",
        },
      ],
    },
    {
      label: "Segurança & Conformidade",
      items: [
        {
          title: "Auditoria",
          description: "Visualize logs de segurança e ações críticas.",
          href: "/configuracoes/auditoria",
          icon: ShieldCheck,
          show: canViewAuditLogs,
          color: "text-amber-600 dark:text-amber-400",
          iconBg: "bg-amber-50 dark:bg-amber-950/60",
          iconBgDark:
            "group-hover:bg-amber-100 dark:group-hover:bg-amber-900/60",
        },
        {
          title: "Documentos Legais",
          description: "Edite os Termos de Uso e Política de Privacidade.",
          href: "/configuracoes/documentos-legais",
          icon: FileText,
          show: canAccessSettings,
          color: "text-slate-600 dark:text-slate-400",
          iconBg: "bg-slate-100 dark:bg-slate-800/60",
          iconBgDark:
            "group-hover:bg-slate-200 dark:group-hover:bg-slate-700/60",
        },
      ],
    },
    {
      label: "Infraestrutura",
      items: [
        {
          title: "Sistema",
          description: "Ferramentas de manutenção e recalibração de dados.",
          href: "/configuracoes/sistema",
          icon: Wrench,
          show: canManageCompanies,
          color: "text-orange-600 dark:text-orange-400",
          iconBg: "bg-orange-50 dark:bg-orange-950/60",
          iconBgDark:
            "group-hover:bg-orange-100 dark:group-hover:bg-orange-900/60",
        },
        {
          title: "Chaves de API",
          description: "Gerencie as chaves de acesso à API externa do sistema.",
          href: "/configuracoes/api-keys",
          icon: Key,
          show: canManageCompanies,
          color: "text-rose-600 dark:text-rose-400",
          iconBg: "bg-rose-50 dark:bg-rose-950/60",
          iconBgDark: "group-hover:bg-rose-100 dark:group-hover:bg-rose-900/60",
        },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Gerencie usuários, segurança e infraestrutura do sistema.
        </p>
      </div>

      {/* Groups */}
      <div className="flex flex-col gap-8">
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              {group.label}
            </h2>
            <div className="rounded-xl border bg-card divide-y overflow-hidden">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
                      item.iconBg,
                      item.iconBgDark,
                    )}
                  >
                    <item.icon className={cn("h-4 w-4", item.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-none mb-1">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.description}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
