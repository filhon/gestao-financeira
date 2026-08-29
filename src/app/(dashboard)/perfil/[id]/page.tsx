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
import {
  UserProfile,
  CostCenter,
  CostCenterBalance,
  Transaction,
  UserRole,
} from "@/lib/types";
import {
  costCenterLedgerService,
  buildCostCenterTree,
  type CostCenterTree,
} from "@/lib/services/costCenterLedgerService";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  Loader2,
  Calendar,
  ShieldCheck,
  Building2,
  Banknote,
  UserCircle2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
import { cn } from "@/lib/utils";

// ─── Role Config ────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<
  UserRole | "none",
  {
    label: string;
    description: string;
    badgeClass: string;
    icon: React.ReactNode;
  }
> = {
  admin: {
    label: "Administrador",
    description:
      "Acesso total a todas as funcionalidades e configurações, incluindo gerenciamento de usuários e empresas.",
    badgeClass:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-800",
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  financial_manager: {
    label: "Gerente Financeiro",
    description:
      "Gerencia transações, contas e relatórios financeiros da empresa. Pode criar e aprovar transações de qualquer centro de custo.",
    badgeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800",
    icon: <Banknote className="h-4 w-4" />,
  },
  approver: {
    label: "Aprovador",
    description:
      "Responsável por aprovar solicitações e despesas dentro do seu limite e centros de custo atribuídos.",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  releaser: {
    label: "Pagador/Baixador",
    description:
      "Responsável por realizar pagamentos (baixas) de transações já aprovadas.",
    badgeClass:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
    icon: <Banknote className="h-4 w-4" />,
  },
  auditor: {
    label: "Auditor",
    description:
      "Acesso apenas para visualização de dados, relatórios e auditoria. Não pode realizar alterações.",
    badgeClass:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800",
    icon: <AlertCircle className="h-4 w-4" />,
  },
  user: {
    label: "Usuário",
    description:
      "Pode criar transações nos centros de custo autorizados e visualizar apenas suas próprias transações.",
    badgeClass:
      "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700",
    icon: <UserCircle2 className="h-4 w-4" />,
  },
  none: {
    label: "Sem Acesso",
    description: "Sem acesso a esta empresa.",
    badgeClass:
      "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800",
    icon: <AlertCircle className="h-4 w-4" />,
  },
};

const STATUS_CONFIG: Record<
  string,
  { label: string; badgeClass: string; icon: React.ReactNode }
> = {
  pending_approval: {
    label: "Pendente",
    badgeClass:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
    icon: <Clock className="h-3 w-3" />,
  },
  approved: {
    label: "Aprovado",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  pending_authorization: {
    label: "Aguard. Autorização",
    badgeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800",
    icon: <Clock className="h-3 w-3" />,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

function formatCurrencyBR(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  className,
  valueClassName,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4",
        className,
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm font-semibold", valueClassName)}>
          {value}
        </p>
      </div>
    </div>
  );
}

function CostCenterCard({
  cc,
  userEmail,
  currentRole,
  balance,
  year,
}: {
  cc: CostCenter;
  userEmail: string;
  currentRole: string;
  balance?: CostCenterBalance;
  year: number;
}) {
  const isApprover = cc.approverEmail === userEmail;
  const isReleaser = cc.releaserEmail === userEmail;
  const isAdmin =
    !isApprover &&
    !isReleaser &&
    ["admin", "financial_manager"].includes(currentRole);

  // Envelope do exercício e quanto dele já saiu — distribuído a filhos ou gasto
  // direto. A barra antes era decorativa: `usagePercent` estava fixo em zero.
  const envelope = (balance?.received ?? 0) + (balance?.carryIn ?? 0);
  const committed =
    (balance?.allocatedToChildren ?? 0) + (balance?.spentDirect ?? 0);
  const usagePercent =
    envelope > 0 ? Math.min((committed / envelope) * 100, 100) : 0;

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <div
        className={cn(
          "h-1 w-full",
          isApprover
            ? "bg-emerald-500"
            : isReleaser
              ? "bg-amber-500"
              : "bg-primary/20",
        )}
      />
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle
            className="line-clamp-2 text-sm font-semibold leading-tight"
            title={cc.name}
          >
            {cc.name}
          </CardTitle>
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {/* Budget bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Envelope {year}</span>
            <span className="font-medium font-financial text-foreground">
              {formatCurrencyBR(envelope)}
            </span>
          </div>
          <Progress
            value={usagePercent}
            className={cn(
              "h-1.5",
              usagePercent >= 90 && "[&>div]:bg-red-500",
              usagePercent >= 75 && usagePercent < 90 && "[&>div]:bg-amber-500",
            )}
          />
          {envelope > 0 && (
            <p className="text-right text-xs text-muted-foreground">
              {usagePercent.toFixed(0)}% comprometido
            </p>
          )}
        </div>

        {/* Role indicators */}
        <div className="space-y-1 text-xs">
          {isApprover && (
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              <span>Responsável por Aprovação</span>
            </div>
          )}
          {isReleaser && (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <Banknote className="h-3 w-3" />
              <span>Responsável por Pagamentos</span>
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
              <ShieldCheck className="h-3 w-3" />
              <span>Acesso Administrativo</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: userId } = use(params);
  const { selectedCompany } = useCompany();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [balances, setBalances] = useState<Record<string, CostCenterBalance>>(
    {},
  );
  const [tree, setTree] = useState<CostCenterTree | null>(null);
  const year = new Date().getFullYear();
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
        const user = await userService.getById(userId);
        setUserProfile(user);

        const allCostCenters = await costCenterService.getAll(
          selectedCompany.id,
        );
        const role = user?.companyRoles?.[selectedCompany.id];
        let visibleCostCenters = allCostCenters;

        if (
          !role ||
          !["admin", "financial_manager", "auditor"].includes(role)
        ) {
          visibleCostCenters = allCostCenters.filter(
            (cc) =>
              cc.approverEmail === user?.email ||
              cc.releaserEmail === user?.email,
          );
        }

        setCostCenters(visibleCostCenters);

        // Saldos vêm do razão. A árvore inteira é necessária para montá-los,
        // mesmo quando o usuário só enxerga alguns centros.
        try {
          setBalances(
            await costCenterLedgerService.getBalances(
              selectedCompany.id,
              allCostCenters,
              year,
            ),
          );
          setTree(buildCostCenterTree(allCostCenters));
        } catch (error) {
          console.error("Error loading cost center balances:", error);
          setBalances({});
          setTree(null);
        }

        const upcoming = await transactionService.getUpcomingByUser(
          userId,
          user?.email,
          selectedCompany.id,
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
  }, [userId, selectedCompany, year]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!userProfile) {
    return <div className="p-8">Usuário não encontrado.</div>;
  }

  const currentRole =
    (userProfile.companyRoles?.[selectedCompany?.id || ""] as
      | UserRole
      | undefined) || "none";
  const roleConfig = ROLE_CONFIG[currentRole];

  // Soma só o topo de cada ramo visível. Quando pai e filho aparecem juntos na
  // lista, somar os dois envelopes contaria o mesmo dinheiro duas vezes — a
  // alocação do pai para o filho é transferência, não recurso novo.
  const visibleIds = new Set(costCenters.map((cc) => cc.id));
  const totalBudget = costCenters
    .filter(
      (cc) => !tree?.ancestorsOf(cc.id).some((parent) => visibleIds.has(parent)),
    )
    .reduce((sum, cc) => {
      const b = balances[cc.id];
      return sum + (b ? b.received + b.carryIn : 0);
    }, 0);
  const approverCount = costCenters.filter(
    (cc) => cc.approverEmail === userProfile.email,
  ).length;
  const releaserCount = costCenters.filter(
    (cc) => cc.releaserEmail === userProfile.email,
  ).length;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <Avatar className="h-20 w-20 shrink-0 ring-2 ring-border">
          <AvatarImage src={userProfile.photoURL || ""} />
          <AvatarFallback className="text-xl font-semibold">
            {userProfile.displayName
              ? getInitials(userProfile.displayName)
              : "U"}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h1 className="truncate text-2xl font-bold tracking-tight">
              {userProfile.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">{userProfile.email}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "flex items-center gap-1.5 text-xs",
                roleConfig.badgeClass,
              )}
            >
              {roleConfig.icon}
              {roleConfig.label}
            </Badge>
            {selectedCompany && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {selectedCompany.name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick stats ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Centros de Custo"
          value={costCenters.length}
          icon={<Building2 className="h-4 w-4" />}
        />
        <StatCard
          label="Orçamento Total"
          value={formatCurrencyBR(totalBudget)}
          icon={<Banknote className="h-4 w-4" />}
          valueClassName="font-financial"
        />
        <StatCard
          label="Aprovador em"
          value={`${approverCount} CC`}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatCard
          label="Pagador em"
          value={`${releaserCount} CC`}
          icon={<Banknote className="h-4 w-4" />}
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="cost-centers">
            Centros de Custo
            {costCenters.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium">
                {costCenters.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Access level card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Nível de Acesso</CardTitle>
              <CardDescription>
                Permissões do usuário na empresa atual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4",
                  currentRole === "none"
                    ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
                    : "border-border bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    currentRole === "none"
                      ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {roleConfig.icon}
                </div>
                <div>
                  <h4 className="text-sm font-semibold">{roleConfig.label}</h4>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {roleConfig.description}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Upcoming payables card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    Próximas Contas a Pagar
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Vencimentos nos próximos 7 dias vinculados a este usuário.
                  </CardDescription>
                </div>
                {upcomingTransactions.length > 0 && (
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {upcomingTransactions.length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Descrição</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" />
                          <span>Nenhuma conta próxima encontrada.</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    upcomingTransactions.map((t) => {
                      const statusConf = STATUS_CONFIG[t.status] || null;
                      return (
                        <TableRow
                          key={t.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedTransaction(t)}
                        >
                          <TableCell className="pl-6 font-medium">
                            {t.description}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              {format(t.dueDate, "dd/MM/yyyy", {
                                locale: ptBR,
                              })}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold font-financial">
                            {formatCurrencyBR(t.amount)}
                          </TableCell>
                          <TableCell className="pr-6">
                            {statusConf ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "flex w-fit items-center gap-1 text-xs",
                                  statusConf.badgeClass,
                                )}
                              >
                                {statusConf.icon}
                                {statusConf.label}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-xs capitalize"
                              >
                                {t.status}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cost Centers tab ── */}
        <TabsContent value="cost-centers" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Centros de Custo Autorizados
              </CardTitle>
              <CardDescription>
                Centros onde o usuário possui responsabilidades diretas ou
                acesso total.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {costCenters.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <Building2 className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum centro de custo associado diretamente.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {costCenters.map((cc) => (
                    <CostCenterCard
                      key={cc.id}
                      cc={cc}
                      userEmail={userProfile.email}
                      currentRole={currentRole}
                      balance={balances[cc.id]}
                      year={year}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <TransactionDetailsDialog
        isOpen={!!selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        transaction={selectedTransaction}
        costCenters={costCenters}
        onUpdate={() => {
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
