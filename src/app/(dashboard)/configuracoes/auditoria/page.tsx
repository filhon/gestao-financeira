"use client";

import { useEffect, useState, useCallback } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { auditService } from "@/lib/services/auditService";
import { AuditLog } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { usePermissions } from "@/hooks/usePermissions";
import {
  formatAuditDetails,
  getActionSummary,
  formatRelativeTime,
  getChangeIcon,
  getEntityLink,
  ENTITY_LABELS,
  AuditDetails,
  FieldChange,
} from "@/lib/auditFormatter";
import { formatTextWithBold } from "@/lib/sanitizer";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// Component to render a single change item
function ChangeItem({ change }: { change: FieldChange }) {
  const icon = getChangeIcon(change.field, change.oldValue, change.newValue);
  const formattedText =
    formatAuditDetails("update", "", { changes: [change] })[0] || "";

  return (
    <div className="flex items-start gap-2 py-1">
      {icon === "increase" && (
        <ArrowUpRight className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
      )}
      {icon === "decrease" && (
        <ArrowDownRight className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
      )}
      {icon === "change" && (
        <RefreshCw className="h-3 w-3 text-blue-600 mt-1 shrink-0" />
      )}
      {!icon && <span className="w-4" />}
      <span
        className="text-sm"
        dangerouslySetInnerHTML={{
          __html: formatTextWithBold(formattedText),
        }}
      />
    </div>
  );
}

// Component to render audit details
function AuditDetailsDisplay({ log }: { log: AuditLog }) {
  const [isOpen, setIsOpen] = useState(false);
  const details = log.details as AuditDetails;
  const hasChanges =
    details.changes &&
    Array.isArray(details.changes) &&
    details.changes.length > 0;

  const summary = getActionSummary(log.action, log.entity, details);
  const formattedDetails = formatAuditDetails(log.action, log.entity, details);

  if (!hasChanges && formattedDetails.length === 0) {
    return <div className="text-sm text-muted-foreground">{summary}</div>;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-2">
        <span className="text-sm">{summary}</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0">
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 pl-2 border-l-2 border-muted space-y-1">
          {hasChanges
            ? (details.changes as FieldChange[]).map((change, index) => (
                <ChangeItem key={index} change={change} />
              ))
            : formattedDetails.map((detail, index) => (
                <div
                  key={index}
                  className="text-sm py-1"
                  dangerouslySetInnerHTML={{
                    __html: formatTextWithBold(detail),
                  }}
                />
              ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  create: {
    label: "Criação",
    className: "bg-emerald-600 text-white hover:bg-emerald-600",
  },
  update: {
    label: "Edição",
    className:
      "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-200",
  },
  delete: {
    label: "Exclusão",
    className:
      "bg-destructive text-destructive-foreground hover:bg-destructive",
  },
  approve: {
    label: "Aprovação",
    className: "bg-green-600 text-white hover:bg-green-600",
  },
  reject: {
    label: "Rejeição",
    className: "bg-red-600 text-white hover:bg-red-600",
  },
  login: {
    label: "Login",
    className: "border border-border bg-transparent text-foreground",
  },
  pay: {
    label: "Pagamento",
    className: "bg-violet-600 text-white hover:bg-violet-600",
  },
  authorize: {
    label: "Autorização",
    className: "bg-indigo-600 text-white hover:bg-indigo-600",
  },
  release: {
    label: "Liberação",
    className: "bg-cyan-600 text-white hover:bg-cyan-600",
  },
};

function ActionBadge({ action }: { action: string }) {
  const config = ACTION_CONFIG[action];
  if (!config) return <Badge variant="outline">{action}</Badge>;
  return (
    <Badge className={cn("text-xs font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}

export default function AuditLogsPage() {
  const { selectedCompany, isLoading: isCompanyLoading } = useCompany();
  const router = useRouter();
  const { canViewAuditLogs } = usePermissions();
  const statsQueryClient = useQueryClient();

  const { data: stats = { users: [], entities: [], actions: [] } } = useQuery({
    queryKey: ["audit-stats", selectedCompany?.id],
    queryFn: () => auditService.getAggregatedStats(selectedCompany!.id),
    enabled: !!selectedCompany && canViewAuditLogs,
  });

  const [filters, setFilters] = useState({
    action: "all",
    entity: "all",
    userId: "all",
    timeRange: "all",
  });

  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== "all",
  ).length;

  useEffect(() => {
    if (!isCompanyLoading && !canViewAuditLogs) {
      toast.error("Acesso negado.");
      router.push("/dashboard");
    }
  }, [canViewAuditLogs, router, isCompanyLoading]);

  const refreshStats = useCallback(() => {
    statsQueryClient.invalidateQueries({
      queryKey: ["audit-stats", selectedCompany?.id],
    });
  }, [statsQueryClient, selectedCompany?.id]);

  const getStartDate = useCallback(() => {
    const now = new Date();
    if (filters.timeRange === "1h")
      return new Date(now.getTime() - 60 * 60 * 1000);
    if (filters.timeRange === "24h")
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (filters.timeRange === "7d")
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (filters.timeRange === "30d")
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return undefined;
  }, [filters.timeRange]);

  const {
    items: logs,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
  } = usePaginatedQuery<AuditLog>({
    queryKey: [
      "audit-logs",
      selectedCompany?.id,
      filters.action,
      filters.entity,
      filters.userId,
      filters.timeRange,
    ],
    queryFn: async (pageSize, lastDoc) => {
      const filter: Record<string, string | Date | undefined> = {};
      if (filters.action !== "all") filter.action = filters.action;
      if (filters.entity !== "all") filter.entity = filters.entity;
      if (filters.userId !== "all") filter.userId = filters.userId;
      const startDate = getStartDate();
      if (startDate) filter.startDate = startDate;

      const { logs: items, lastDoc: newLastDoc } =
        await auditService.getPaginated(
          selectedCompany!.id,
          pageSize,
          lastDoc,
          filter,
        );

      return { items, lastDoc: newLastDoc };
    },
    pageSize: 20,
    enabled: !!selectedCompany && canViewAuditLogs,
  });

  if (!canViewAuditLogs) return null;

  const getActionLabel = (action: string): string =>
    ACTION_CONFIG[action]?.label ?? action;

  const getEntityLabel = (entity: string) => ENTITY_LABELS[entity] || entity;

  if (isLoading && logs.length === 0) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 shrink-0">
            <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Logs de Auditoria
            </h1>
            <p className="text-sm text-muted-foreground">
              Histórico de ações críticas no sistema.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Filtros</CardTitle>
              {activeFilterCount > 0 && (
                <Badge
                  variant="secondary"
                  className="h-5 px-1.5 text-xs tabular-nums"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                  onClick={() =>
                    setFilters({
                      action: "all",
                      entity: "all",
                      userId: "all",
                      timeRange: "all",
                    })
                  }
                >
                  <X className="h-3 w-3" />
                  Limpar
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={refreshStats}
                title="Atualizar opções dos filtros"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          <div className="flex-1 min-w-[150px] max-w-[220px]">
            <Select
              value={filters.timeRange}
              onValueChange={(v) =>
                setFilters((prev) => ({ ...prev, timeRange: v }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo o período</SelectItem>
                <SelectItem value="1h">Última hora</SelectItem>
                <SelectItem value="24h">Últimas 24 horas</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[260px]">
            <Select
              value={filters.userId}
              onValueChange={(v) =>
                setFilters((prev) => ({ ...prev, userId: v }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Usuário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os usuários</SelectItem>
                {stats.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}{" "}
                    <span className="text-muted-foreground">
                      ({user.count})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[220px]">
            <Select
              value={filters.action}
              onValueChange={(v) =>
                setFilters((prev) => ({ ...prev, action: v }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Ação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as ações</SelectItem>
                {stats.actions.map((action) => (
                  <SelectItem key={action.name} value={action.name}>
                    {getActionLabel(action.name)}{" "}
                    <span className="text-muted-foreground">
                      ({action.count})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[220px]">
            <Select
              value={filters.entity}
              onValueChange={(v) =>
                setFilters((prev) => ({ ...prev, entity: v }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Entidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as entidades</SelectItem>
                {stats.entities.map((entity) => (
                  <SelectItem key={entity.name} value={entity.name}>
                    {getEntityLabel(entity.name)}{" "}
                    <span className="text-muted-foreground">
                      ({entity.count})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[160px] pl-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Data/Hora
                </TableHead>
                <TableHead className="w-[200px] text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Usuário
                </TableHead>
                <TableHead className="w-[110px] text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Ação
                </TableHead>
                <TableHead className="w-[130px] text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Entidade
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Detalhes
                </TableHead>
                <TableHead className="w-[52px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-16 text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <ShieldCheck className="h-8 w-8 text-muted-foreground/30" />
                      <span className="text-sm">
                        Nenhum registro encontrado.
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  const entityLink = getEntityLink(log.entity, log.entityId);

                  return (
                    <TableRow key={log.id} className="group align-top">
                      <TableCell className="pl-6 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium leading-tight">
                            {formatRelativeTime(log.createdAt)}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {format(log.createdAt, "dd/MM/yy HH:mm", {
                              locale: ptBR,
                            })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="text-sm font-medium truncate block max-w-[180px]">
                          {log.userEmail}
                        </span>
                      </TableCell>
                      <TableCell className="py-3">
                        <ActionBadge action={log.action} />
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="text-sm text-muted-foreground">
                          {getEntityLabel(log.entity)}
                        </span>
                      </TableCell>
                      <TableCell className="py-3">
                        <AuditDetailsDisplay log={log} />
                      </TableCell>
                      <TableCell className="py-3">
                        {entityLink && (
                          <Link href={entityLink}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Abrir registro"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
        {hasMore && logs.length > 0 && (
          <div className="flex justify-center p-4 border-t">
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={isFetchingNextPage}
              className="min-w-[140px]"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Carregando...
                </>
              ) : (
                "Carregar mais"
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
