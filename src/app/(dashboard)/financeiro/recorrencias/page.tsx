"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { RecurringTransactionTemplate } from "@/lib/types";
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
import { Loader2, Trash2, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

export default function RecorrenciasPage() {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();
    const [templates, setTemplates] = useState<RecurringTransactionTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchTemplates = async () => {
        if (!selectedCompany) return;
        try {
            setIsLoading(true);
            const data = await recurrenceService.getTemplates(selectedCompany.id);
            setTemplates(data);
        } catch (error) {
            console.error("Error fetching templates:", error);
            toast.error("Erro ao carregar recorrências.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, [selectedCompany]);

    const handleToggleActive = async (template: RecurringTransactionTemplate) => {
        try {
            await recurrenceService.updateTemplate(template.id, { active: !template.active });
            toast.success(`Recorrência ${template.active ? 'pausada' : 'ativada'} com sucesso!`);
            fetchTemplates();
        } catch (error) {
            toast.error("Erro ao atualizar recorrência.");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Tem certeza que deseja excluir esta recorrência?")) return;
        try {
            await recurrenceService.deleteTemplate(id);
            toast.success("Recorrência excluída com sucesso!");
            fetchTemplates();
        } catch (error) {
            toast.error("Erro ao excluir recorrência.");
        }
    };

    const handleProcessNow = async () => {
        if (!selectedCompany || !user) return;
        try {
            const count = await recurrenceService.processDueTemplates(selectedCompany.id, { uid: user.uid, email: user.email });
            if (count > 0) {
                toast.success(`${count} transações geradas com sucesso!`);
                fetchTemplates();
            } else {
                toast.info("Nenhuma recorrência pendente para hoje.");
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao processar recorrências.");
        }
    };

    const getFrequencyLabel = (freq: string, interval: number) => {
        const intervalLabel = interval > 1 ? `A cada ${interval} ` : "";
        switch (freq) {
            case "daily": return `${intervalLabel}${interval > 1 ? "dias" : "Diário"}`;
            case "weekly": return `${intervalLabel}${interval > 1 ? "semanas" : "Semanal"}`;
            case "monthly": return `${intervalLabel}${interval > 1 ? "meses" : "Mensal"}`;
            case "yearly": return `${intervalLabel}${interval > 1 ? "anos" : "Anual"}`;
            default: return freq;
        }
    };

    if (isLoading && templates.length === 0) {
        return (
            <div className="flex justify-center items-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Recorrências</h1>
                    <p className="text-muted-foreground">
                        Gerencie suas assinaturas e transações recorrentes.
                    </p>
                </div>
                <Button onClick={handleProcessNow} variant="outline">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Verificar Pendências
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Modelos Ativos</CardTitle>
                    <CardDescription>
                        Lista de transações que são geradas automaticamente.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Descrição</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Valor</TableHead>
                                <TableHead>Frequência</TableHead>
                                <TableHead>Próx. Vencimento</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {templates.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                        Nenhuma recorrência encontrada.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                templates.map((t) => (
                                    <TableRow key={t.id} className={!t.active ? "opacity-60" : ""}>
                                        <TableCell className="font-medium">{t.description}</TableCell>
                                        <TableCell>
                                            <Badge variant={t.type === 'payable' ? 'destructive' : 'default'} className={t.type === 'payable' ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'bg-green-100 text-green-800 hover:bg-green-200'}>
                                                {t.type === 'payable' ? 'Despesa' : 'Receita'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{formatCurrency(t.amount)}</TableCell>
                                        <TableCell>{getFrequencyLabel(t.frequency, t.interval)}</TableCell>
                                        <TableCell>{format(t.nextDueDate, "dd/MM/yyyy")}</TableCell>
                                        <TableCell>
                                            <Badge variant={t.active ? "default" : "secondary"}>
                                                {t.active ? "Ativo" : "Pausado"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleToggleActive(t)}
                                                    title={t.active ? "Pausar" : "Ativar"}
                                                >
                                                    {t.active ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-red-500 hover:text-red-700"
                                                    onClick={() => handleDelete(t.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
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
