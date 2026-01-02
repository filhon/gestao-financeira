"use client";

import { useEffect, useState, use } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { userService } from "@/lib/services/userService";
import { costCenterService } from "@/lib/services/costCenterService";
import { transactionService } from "@/lib/services/transactionService";
import { UserProfile, CostCenter, Transaction, UserRole } from "@/lib/types";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Loader2, Calendar, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { TransactionDetailsDialog } from "@/components/features/finance/TransactionDetailsDialog";

const ROLE_DESCRIPTIONS: Record<UserRole | "none", string> = {
  admin:
    "Acesso total a todas as funcionalidades e configurações, incluindo gerenciamento de usuários e empresas.",
  financial_manager:
    "Gerencia transações, contas e relatórios financeiros da empresa. Pode criar e aprovar transações de qualquer centro de custo.",
  approver:
    "Responsável por aprovar solicitações e despesas dentro do seu limite e centros de custo atribuídos.",
  releaser:
    "Responsável por realizar pagamentos (baixas) de transações já aprovadas.",
  auditor:
    "Acesso apenas para visualização de dados, relatórios e auditoria. Não pode realizar alterações.",
  user: "Pode criar transações nos centros de custo autorizados e visualizar apenas suas próprias transações.",
  none: "Sem acesso a esta empresa.",
};

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  financial_manager: "Gerente Financeiro",
  approver: "Aprovador",
  releaser: "Pagador/Baixador",
  auditor: "Auditor",
  user: "Usuário",
};

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: userId } = use(params);
  const { selectedCompany } = useCompany();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [upcomingTransactions, setUpcomingTransactions] = useState<
    Transaction[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!userId || !selectedCompany) return;
      setIsLoading(true);
      try {
        // 1. Fetch User
        const user = await userService.getById(userId);
        setUserProfile(user);

        // 2. Fetch Cost Centers (filtered by permissions)
        // For MVP: Fetch all and filter client-side if "Authorized" means something specific beyond role.
        // Assuming "Authorized" means "Can View/Use".
        // If Admin/Manager -> All.
        // If Approver -> Can approve.
        // If simple User -> Maybe none or specific ones?
        // Let's assume for now we list ALL cost centers of the company and highlight role.
        // Or better: filter by `allowedRoles` inside CostCenter?
        const allCostCenters = await costCenterService.getAll(
          selectedCompany.id
        );
        // Filter logic could be complex. For now, show ALL and maybe badge "Authorized".
        // Implementation Plan suggested "Cost Center Access: Authorized cost centers".
        // Let's filter: if user is admin/manager, show all. Else, check usage permissions.

        const role = user?.companyRoles?.[selectedCompany.id];
        let visibleCostCenters = allCostCenters;

        if (role && ["admin", "financial_manager", "auditor"].includes(role)) {
          // See all
        } else if (user) {
          // Filter based on `allowedRoles` in Cost Center (if implemented) or `approverEmail` match?
          // Currently CostCenter has `approverEmail` and `releaserEmail`.
          visibleCostCenters = allCostCenters.filter(
            (cc) =>
              cc.approverEmail === user.email || cc.releaserEmail === user.email
          );
        }

        setCostCenters(visibleCostCenters);

        // 3. Fetch Upcoming Transactions
        const upcoming = await transactionService.getUpcomingByUser(
          userId,
          user?.email,
          selectedCompany.id
        );
        setUpcomingTransactions(upcoming);
      } catch (error) {
        console.error("Error loading profile:", error);
        toast.error("Erro ao carregar perfil.");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [userId, selectedCompany]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!userProfile) {
    return <div className="p-8">Usuário não encontrado.</div>;
  }

  const currentRole =
    userProfile.companyRoles?.[selectedCompany?.id || ""] || "none";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6">
        <Avatar className="h-24 w-24">
          <AvatarImage src={userProfile.photoURL || ""} />
          <AvatarFallback className="text-2xl">
            {userProfile.displayName
              ? getInitials(userProfile.displayName)
              : "U"}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {userProfile.displayName}
          </h1>
          <p className="text-muted-foreground">{userProfile.email}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge
              variant={currentRole === "none" ? "secondary" : "default"}
              className="capitalize"
            >
              {currentRole === "none"
                ? "Sem Acesso"
                : ROLE_LABELS[currentRole as UserRole] || currentRole}
            </Badge>
            <span className="text-sm text-muted-foreground">
              em {selectedCompany?.name}
            </span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="cost-centers">
            Centros de Custo ({costCenters.length})
          </TabsTrigger>
          {/* Activity Tab could go here */}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Access Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Nível de Acesso</CardTitle>
              <CardDescription>
                Detalhes das permissões do usuário na empresa atual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
                <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h4 className="font-semibold capitalize mb-1">
                    {currentRole === "none"
                      ? "Sem Função Definida"
                      : ROLE_LABELS[currentRole as UserRole] || currentRole}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {ROLE_DESCRIPTIONS[currentRole as UserRole | "none"]}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming Payables */}
          <Card>
            <CardHeader>
              <CardTitle>Próximas Contas a Pagar</CardTitle>
              <CardDescription>
                Contas com vencimento nos próximos 7 dias vinculadas a este
                usuário.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center py-6 text-muted-foreground"
                      >
                        Nenhuma conta próxima encontrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    upcomingTransactions.map((t) => (
                      <TableRow
                        key={t.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedTransaction(t)}
                      >
                        <TableCell className="font-medium">
                          {t.description}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {format(t.dueDate, "dd/MM/yyyy")}
                          </div>
                        </TableCell>
                        <TableCell className="font-bold">
                          {t.amount.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {t.status === "pending_approval"
                              ? "Pendente"
                              : t.status === "approved"
                                ? "Aprovado"
                                : t.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cost-centers">
          <Card>
            <CardHeader>
              <CardTitle>Centros de Custo Autorizados</CardTitle>
              <CardDescription>
                Centros de custo onde o usuário possui responsabilidades diretas
                (Aprovação/Pagamento) ou acesso total.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {costCenters.map((cc) => (
                  <Card key={cc.id} className="overflow-hidden">
                    <div className="h-2 bg-primary/10 w-full" />
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base truncate" title={cc.name}>
                        {cc.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {/* Budget Simulation - Actual app would need real budget fetching */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">
                              Orçamento Anual
                            </span>
                            <span className="font-medium">
                              {/* Placeholder for now, or fetch if available */}
                              {(cc.budget || 0).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </span>
                          </div>
                          <Progress value={0} className="h-2" />
                        </div>

                        <div className="text-xs text-muted-foreground space-y-1">
                          {cc.approverEmail === userProfile.email && (
                            <div className="flex items-center gap-2 text-amber-600">
                              <span className="w-2 h-2 rounded-full bg-amber-500" />
                              Responsável por Aprovação
                            </div>
                          )}
                          {cc.releaserEmail === userProfile.email && (
                            <div className="flex items-center gap-2 text-green-600">
                              <span className="w-2 h-2 rounded-full bg-green-500" />
                              Responsável por Pagamentos
                            </div>
                          )}
                          {(!cc.approverEmail ||
                            cc.approverEmail !== userProfile.email) &&
                            (!cc.releaserEmail ||
                              cc.releaserEmail !== userProfile.email) &&
                            ["admin", "financial_manager"].includes(
                              currentRole as string
                            ) && (
                              <div className="flex items-center gap-2 text-blue-600">
                                <span className="w-2 h-2 rounded-full bg-blue-500" />
                                Acesso Administrativo
                              </div>
                            )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {costCenters.length === 0 && (
                  <div className="col-span-full text-center py-8 text-muted-foreground">
                    Nenhum centro de custo associado diretamente.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TransactionDetailsDialog
        isOpen={!!selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        transaction={selectedTransaction}
        onUpdate={() => {
          // Refresh upcoming
          if (userId && selectedCompany) {
            transactionService
              .getUpcomingByUser(userId, userProfile?.email, selectedCompany.id)
              .then(setUpcomingTransactions);
          }
        }}
      />
    </div>
  );
}
