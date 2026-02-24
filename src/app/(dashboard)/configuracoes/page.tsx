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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useEffect } from "react";

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

  const allItems = [
    {
      title: "Usuários",
      description: "Gerencie os usuários, funções e permissões de acesso.",
      href: "/configuracoes/usuarios",
      icon: Users,
      show: canManageUsers,
    },
    {
      title: "Empresas",
      description: "Gerencie as empresas do grupo (Holding).",
      href: "/configuracoes/empresas",
      icon: Building2,
      show: canManageCompanies,
    },
    {
      title: "Auditoria",
      description: "Visualize logs de segurança e ações críticas.",
      href: "/configuracoes/auditoria",
      icon: ShieldCheck,
      show: canViewAuditLogs,
    },
    {
      title: "Feedbacks",
      description: "Visualize e responda aos feedbacks dos usuários.",
      href: "/configuracoes/feedbacks",
      icon: MessageSquare,
      show: canManageFeedback,
    },
    {
      title: "Documentos Legais",
      description: "Edite os Termos de Uso e Política de Privacidade.",
      href: "/configuracoes/documentos-legais",
      icon: FileText,
      show: canAccessSettings,
    },
    {
      title: "Sistema",
      description: "Ferramentas de manutenção e recalibração de dados.",
      href: "/configuracoes/sistema",
      icon: Wrench,
      show: canManageCompanies,
    },
    {
      title: "Chaves de API",
      description: "Gerencie as chaves de acesso à API externa do sistema.",
      href: "/configuracoes/api-keys",
      icon: Key,
      show: canManageCompanies,
    },
  ];

  const settingsItems = allItems.filter((item) => item.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Gerencie as configurações gerais do sistema.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {settingsItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">
                  {item.title}
                </CardTitle>
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <CardDescription>{item.description}</CardDescription>
                <div className="mt-4 flex items-center text-sm text-primary font-medium">
                  Acessar <ChevronRight className="ml-1 h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
