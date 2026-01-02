"use client";

import Link from "next/link";
import {
  Users,
  Building2,
  ChevronRight,
  ShieldCheck,
  MessageSquare,
  RefreshCw,
  Database,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRecalculateStats } from "@/hooks/useDashboardData";

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

  const { mutateAsync: recalculateStats, isPending: isRecalculating } =
    useRecalculateStats();

  useEffect(() => {
    if (!canAccessSettings) {
      router.push("/");
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

      {canManageCompanies && (
        <div className="space-y-4 pt-6 border-t">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Database className="h-5 w-5" />
              Manutenção de Dados
            </h2>
            <p className="text-sm text-muted-foreground">
              Ferramentas para manutenção e correção de dados do sistema.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Sincronização de Saldo
              </CardTitle>
              <CardDescription>
                Recalcula o saldo atual da empresa baseando-se em todo o
                histórico de transações pagas. Use isso se notar divergências no
                dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                onClick={() => {
                  toast.promise(recalculateStats(), {
                    loading: "Recalculando saldo...",
                    success: "Saldo atualizado com sucesso!",
                    error: "Erro ao atualizar saldo.",
                  });
                }}
                disabled={isRecalculating}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    isRecalculating ? "animate-spin" : ""
                  }`}
                />
                Recalcular Saldo Agora
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
