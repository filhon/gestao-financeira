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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Gerencie usuários, segurança e infraestrutura do sistema.
        </p>
      </div>

      {/* Groups */}
      <div className="space-y-8">
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              {group.label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item, idx) => (
                <div
                  key={item.href}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{
                    animationDelay: `${idx * 60}ms`,
                    animationFillMode: "both",
                  }}
                >
                  <Link
                    href={item.href}
                    className="group outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl block h-full"
                  >
                    <div
                      className={cn(
                        "relative flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5",
                        "transition-all duration-200",
                        "hover:border-border/80 hover:shadow-md hover:-translate-y-0.5",
                        "active:translate-y-0 active:shadow-sm",
                      )}
                    >
                      {/* Icon */}
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200",
                          item.iconBg,
                          item.iconBgDark,
                        )}
                      >
                        <item.icon className={cn("h-5 w-5", item.color)} />
                      </div>

                      {/* Text */}
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none text-foreground">
                          {item.title}
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                      </div>

                      {/* CTA */}
                      <div
                        className={cn(
                          "flex items-center gap-1 text-xs font-medium transition-colors duration-200",
                          item.color,
                        )}
                      >
                        Acessar
                        <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
