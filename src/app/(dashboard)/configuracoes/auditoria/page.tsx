"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
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
import { Loader2 } from "lucide-react";
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

import { usePermissions } from "@/hooks/usePermissions";

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
        if (!selectedCompany) return;
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
    }, [selectedCompany, filters]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const getActionBadge = (action: string) => {
        switch (action) {
            case "create": return <Badge variant="default" className="bg-emerald-600">Criação</Badge>;
            case "update": return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Edição</Badge>;
            case "delete": return <Badge variant="destructive">Exclusão</Badge>;
            case "approve": return <Badge className="bg-green-600">Aprovação</Badge>;
            case "reject": return <Badge className="bg-red-600">Rejeição</Badge>;
            case "login": return <Badge variant="outline">Login</Badge>;
            default: return <Badge variant="outline">{action}</Badge>;
        }
    };

    const getEntityLabel = (entity: string) => {
        switch (entity) {
            case "transaction": return "Transação";
            case "user": return "Usuário";
            case "company": return "Empresa";
            case "cost_center": return "Centro de Custo";
            default: return entity;
        }
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
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Data/Hora</TableHead>
                                <TableHead>Usuário</TableHead>
                                <TableHead>Ação</TableHead>
                                <TableHead>Entidade</TableHead>
                                <TableHead>ID da Entidade</TableHead>
                                <TableHead>Detalhes</TableHead>
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
                                logs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell className="whitespace-nowrap">
                                            {format(log.createdAt, "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-xs">{log.userEmail}</span>
                                                <span className="text-[10px] text-muted-foreground">{log.userId}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>{getActionBadge(log.action)}</TableCell>
                                        <TableCell>{getEntityLabel(log.entity)}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {log.entityId}
                                        </TableCell>
                                        <TableCell className="max-w-[300px]">
                                            <pre className="text-[10px] bg-muted p-1 rounded overflow-x-auto">
                                                {JSON.stringify(log.details, null, 2)}
                                            </pre>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
