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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Loader2, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, RefreshCw, ExternalLink } from "lucide-react";
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

// Component to render a single change item
function ChangeItem({ change }: { change: FieldChange }) {
    const icon = getChangeIcon(change.field, change.oldValue, change.newValue);

    return (
        <div className="flex items-start gap-2 py-1">
            {icon === 'increase' && (
                <ArrowUpRight className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
            )}
            {icon === 'decrease' && (
                <ArrowDownRight className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            )}
            {icon === 'change' && (
                <RefreshCw className="h-3 w-3 text-blue-600 mt-1 flex-shrink-0" />
            )}
            {!icon && <span className="w-4" />}
            <span
                className="text-sm"
                dangerouslySetInnerHTML={{
                    __html: formatAuditDetails('update', '', { changes: [change] })[0]
                        ?.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') || ''
                }}
            />
        </div>
    );
}

// Component to render audit details
function AuditDetailsDisplay({ log }: { log: AuditLog }) {
    const [isOpen, setIsOpen] = useState(false);
    const details = log.details as AuditDetails;
    const hasChanges = details.changes && Array.isArray(details.changes) && details.changes.length > 0;

    // Get the summary text
    const summary = getActionSummary(log.action, log.entity, details);

    // Format legacy details
    const formattedDetails = formatAuditDetails(log.action, log.entity, details);

    if (!hasChanges && formattedDetails.length === 0) {
        return (
            <div className="text-sm text-muted-foreground">
                {summary}
            </div>
        );
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
                    {hasChanges ? (
                        (details.changes as FieldChange[]).map((change, index) => (
                            <ChangeItem key={index} change={change} />
                        ))
                    ) : (
                        formattedDetails.map((detail, index) => (
                            <div
                                key={index}
                                className="text-sm py-1"
                                dangerouslySetInnerHTML={{
                                    __html: detail.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                }}
                            />
                        ))
                    )}
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
    const [filters, setFilters] = useState({
        action: "all",
        entity: "all",
    });

    useEffect(() => {
        if (!canViewAuditLogs) {
            toast.error("Acesso negado.");
            router.push("/");
        }
    }, [canViewAuditLogs, router]);

    const fetchLogs = useCallback(async () => {
        if (!selectedCompany || !canViewAuditLogs) return;
        try {
            setIsLoading(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filter: any = {};
            if (filters.action !== "all") filter.action = filters.action;
            if (filters.entity !== "all") filter.entity = filters.entity;

            const data = await auditService.getLogs(selectedCompany.id, filter);
            setLogs(data);
        } catch (error) {
            console.error("Error fetching logs:", error);
            toast.error("Erro ao carregar logs de auditoria.");
        } finally {
            setIsLoading(false);
        }
    }, [selectedCompany, filters, canViewAuditLogs]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    if (!canViewAuditLogs) return null;

    const getActionBadge = (action: string) => {
        switch (action) {
            case "create": return <Badge variant="default" className="bg-emerald-600">Criação</Badge>;
            case "update": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Edição</Badge>;
            case "delete": return <Badge variant="destructive">Exclusão</Badge>;
            case "approve": return <Badge className="bg-green-600">Aprovação</Badge>;
            case "reject": return <Badge className="bg-red-600">Rejeição</Badge>;
            case "login": return <Badge variant="outline">Login</Badge>;
            default: return <Badge variant="outline">{action}</Badge>;
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
                <CardContent className="flex gap-4">
                    <div className="w-[200px]">
                        <Select
                            value={filters.action}
                            onValueChange={(v) => setFilters(prev => ({ ...prev, action: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Ação" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Ações</SelectItem>
                                <SelectItem value="create">Criação</SelectItem>
                                <SelectItem value="update">Edição</SelectItem>
                                <SelectItem value="delete">Exclusão</SelectItem>
                                <SelectItem value="approve">Aprovação</SelectItem>
                                <SelectItem value="reject">Rejeição</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-[200px]">
                        <Select
                            value={filters.entity}
                            onValueChange={(v) => setFilters(prev => ({ ...prev, entity: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Entidade" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Entidades</SelectItem>
                                <SelectItem value="transaction">Transação</SelectItem>
                                <SelectItem value="user">Usuário</SelectItem>
                                <SelectItem value="company">Empresa</SelectItem>
                                <SelectItem value="entity">Entidade</SelectItem>
                                <SelectItem value="cost_center">Centro de Custo</SelectItem>
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
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
                                                        {format(log.createdAt, "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
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
                                                <span className="text-sm">{getEntityLabel(log.entity)}</span>
                                            </TableCell>
                                            <TableCell>
                                                <AuditDetailsDisplay log={log} />
                                            </TableCell>
                                            <TableCell>
                                                {entityLink && (
                                                    <Link href={entityLink}>
                                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
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
            </Card>
        </div>
    );
}
