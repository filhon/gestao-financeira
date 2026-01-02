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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { logger } from "@/lib/logger";
import { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

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

  // Get the summary text
  const summary = getActionSummary(log.action, log.entity, details);

  // Format legacy details
  const formattedDetails = formatAuditDetails(log.action, log.entity, details);

  if (!hasChanges && formattedDetails.length === 0) {
    return <div className="text-sm text-muted-foreground">{summary}</div>;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-2">
        <span className="text-sm">{summary}</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
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

export default function AuditLogsPage() {
  const { selectedCompany } = useCompany();
  const router = useRouter();
  const { canViewAuditLogs } = usePermissions();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastDoc, setLastDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState<{
    users: { id: string; name: string; count: number }[];
    entities: { name: string; count: number }[];
    actions: { name: string; count: number }[];
  }>({ users: [], entities: [], actions: [] });

  const [filters, setFilters] = useState({
    action: "all",
    entity: "all",
    userId: "all",
    timeRange: "all",
  });

  useEffect(() => {
    if (!canViewAuditLogs) {
      toast.error("Acesso negado.");
      router.push("/");
    }
  }, [canViewAuditLogs, router]);

  // Load stats for filters
  useEffect(() => {
    const loadStats = async () => {
      if (selectedCompany && canViewAuditLogs) {
        try {
          const data = await auditService.getAggregatedStats(
            selectedCompany.id
          );
          setStats(data);
        } catch (error) {
          console.error("Error loading stats:", error);
        }
      }
    };
    loadStats();
  }, [selectedCompany, canViewAuditLogs]);

  const fetchLogs = useCallback(
    async (isLoadMore = false) => {
      if (!selectedCompany || !canViewAuditLogs) return;
      try {
        setIsLoading(true);

        // Calculate date range based on time filter
        let startDate: Date | undefined;
        const now = new Date();

        if (filters.timeRange === "1h") {
          startDate = new Date(now.getTime() - 60 * 60 * 1000);
        } else if (filters.timeRange === "24h") {
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else if (filters.timeRange === "7d") {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (filters.timeRange === "30d") {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filter: any = {};
        if (filters.action !== "all") filter.action = filters.action;
        if (filters.entity !== "all") filter.entity = filters.entity;
        if (filters.userId !== "all") filter.userId = filters.userId;
        if (startDate) filter.startDate = startDate;

        const currentLastDoc = isLoadMore ? lastDoc : null;
        const { logs: newLogs, lastDoc: newLastDoc } =
          await auditService.getPaginated(
            selectedCompany.id,
            20,
            currentLastDoc,
            filter
          );

        if (isLoadMore) {
          setLogs((prev) => [...prev, ...newLogs]);
        } else {
          setLogs(newLogs);
        }

        setLastDoc(newLastDoc);
        setHasMore(newLogs.length === 20); // If we got less than limit, no more pages
      } catch (error) {
        logger.error("Error fetching logs:", error);
        toast.error("Erro ao carregar logs de auditoria.");
      } finally {
        setIsLoading(false);
      }
    },
    [selectedCompany, filters, canViewAuditLogs, lastDoc]
  );

  // Reset pagination when filters change
  useEffect(() => {
    setLastDoc(null);
    setLogs([]);
    fetchLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.action,
    filters.entity,
    filters.userId,
    filters.timeRange,
    selectedCompany,
  ]);

  if (!canViewAuditLogs) return null;

  const getActionBadge = (action: string) => {
    switch (action) {
      case "create":
        return (
          <Badge variant="default" className="bg-emerald-600">
            Criação
          </Badge>
        );
      case "update":
        return (
          <Badge
            variant="secondary"
            className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
          >
            Edição
          </Badge>
        );
      case "delete":
        return <Badge variant="destructive">Exclusão</Badge>;
      case "approve":
        return <Badge className="bg-green-600">Aprovação</Badge>;
      case "reject":
        return <Badge className="bg-red-600">Rejeição</Badge>;
      case "login":
        return <Badge variant="outline">Login</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getEntityLabel = (entity: string) => {
    return ENTITY_LABELS[entity] || entity;
  };

  if (isLoading && logs.length === 0) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs de Auditoria</h1>
        <p className="text-muted-foreground">
          Histórico de ações críticas no sistema.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Refine a busca por logs.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[150px] max-w-[250px]">
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

          <div className="flex-1 min-w-[150px] max-w-[300px]">
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
                <SelectItem value="all">Todos os Usuários</SelectItem>
                {stats.users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} ({user.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[250px]">
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
                <SelectItem value="all">Todas as Ações</SelectItem>
                {stats.actions.map((action) => (
                  <SelectItem key={action.name} value={action.name}>
                    {getActionBadge(action.name)}{" "}
                    <span className="ml-2 text-muted-foreground">
                      ({action.count})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[250px]">
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
                <SelectItem value="all">Todas as Entidades</SelectItem>
                {stats.entities.map((entity) => (
                  <SelectItem key={entity.name} value={entity.name}>
                    {getEntityLabel(entity.name)} ({entity.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[15%] pl-6">Data/Hora</TableHead>
                <TableHead className="w-[18%]">Usuário</TableHead>
                <TableHead className="w-[10%]">Ação</TableHead>
                <TableHead className="w-[12%]">Entidade</TableHead>
                <TableHead className="w-[40%]">Detalhes</TableHead>
                <TableHead className="w-[5%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhum registro encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  const entityLink = getEntityLink(log.entity, log.entityId);

                  return (
                    <TableRow key={log.id}>
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {formatRelativeTime(log.createdAt)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {format(log.createdAt, "dd/MM/yyyy HH:mm:ss", {
                              locale: ptBR,
                            })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm truncate max-w-[180px]">
                            {log.userEmail}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {getEntityLabel(log.entity)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <AuditDetailsDisplay log={log} />
                      </TableCell>
                      <TableCell>
                        {entityLink && (
                          <Link href={entityLink}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
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
              onClick={() => fetchLogs(true)}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Carregando...
                </>
              ) : (
                "Carregar Mais"
              )}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
