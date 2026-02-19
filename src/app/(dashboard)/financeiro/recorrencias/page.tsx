"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Trash2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Pencil,
  Search,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditRecurrenceDialog } from "@/components/features/finance/EditRecurrenceDialog";

import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce";
import { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

export default function RecorrenciasPage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const router = useRouter();
  const { canViewRecurrences, canManageRecurrences } = usePermissions();

  const [templates, setTemplates] = useState<RecurringTransactionTemplate[]>(
    [],
  );
  // Ref to access current templates without adding to useEffect deps
  const templatesRef = useRef(templates);
  templatesRef.current = templates;

  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [itemsPerPage] = useState(25);

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [isLoading, setIsLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] =
    useState<RecurringTransactionTemplate | null>(null);

  // Guard: redirect if no permission
  useEffect(() => {
    if (!canViewRecurrences) {
      router.push("/dashboard");
    }
  }, [canViewRecurrences, router]);

  const fetchTemplates = useCallback(
    async (isLoadMore = false) => {
      if (!selectedCompany || !canViewRecurrences) return;

      // If searching, prevent standard fetch
      if (debouncedSearchTerm) return;

      try {
        setIsLoading(true);

        const filter = {
          active:
            statusFilter === "all" ? undefined : statusFilter === "active",
        };

        const currentLastDoc = isLoadMore ? lastDocRef.current : null;

        const { templates: newTemplates, lastDoc: newLastDoc } =
          await recurrenceService.getPaginated(
            selectedCompany.id,
            itemsPerPage,
            currentLastDoc,
            filter,
          );

        if (isLoadMore) {
          setTemplates((prev) => [...prev, ...newTemplates]);
        } else {
          setTemplates(newTemplates);
        }

        lastDocRef.current = newLastDoc;
        setHasMore(newTemplates.length === itemsPerPage);
      } catch (error) {
        console.error("Error fetching templates:", error);
        toast.error("Erro ao carregar recorrências.");
      } finally {
        setIsLoading(false);
      }
    },
    [
      selectedCompany,
      canViewRecurrences,
      statusFilter,
      itemsPerPage,
      debouncedSearchTerm,
    ],
  );

  // Initial load and filter changes
  useEffect(() => {
    if (!debouncedSearchTerm) {
      // Reset pagination when filters change (except load more)
      lastDocRef.current = null;
      fetchTemplates();
    }
  }, [fetchTemplates, debouncedSearchTerm, statusFilter]);

  // Client-side search logic
  useEffect(() => {
    if (debouncedSearchTerm && selectedCompany) {
      const performSearch = async () => {
        setIsLoading(true);
        try {
          // Try local filter first
          const search = debouncedSearchTerm
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");

          const matchLocal = (t: RecurringTransactionTemplate) => {
            const description = t.description
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
            return description.includes(search);
          };

          const localResults = templatesRef.current.filter(matchLocal);

          if (localResults.length > 0) {
            setTemplates(localResults);
            setHasMore(false);
          } else {
            // Fetch limited set from server if no local results
            const filter = {
              active:
                statusFilter === "all" ? undefined : statusFilter === "active",
              limit: 100,
            };

            const all = await recurrenceService.getTemplates(
              selectedCompany.id,
              filter,
            );

            setTemplates(all.filter(matchLocal));
            setHasMore(false);
          }
        } catch (e) {
          console.error(e);
          toast.error("Erro na busca");
        } finally {
          setIsLoading(false);
        }
      };
      performSearch();
    }
  }, [debouncedSearchTerm, selectedCompany, statusFilter]);

  if (!canViewRecurrences) return null;

  const handleToggleActive = async (template: RecurringTransactionTemplate) => {
    try {
      await recurrenceService.updateTemplate(template.id, {
        active: !template.active,
      });
      toast.success(
        `Recorrência ${template.active ? "pausada" : "ativada"} com sucesso!`,
      );
      fetchTemplates();
    } catch {
      toast.error("Erro ao atualizar recorrência.");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await recurrenceService.deleteTemplate(deleteId);
      toast.success("Recorrência excluída com sucesso!");
      fetchTemplates();
    } catch {
      toast.error("Erro ao excluir recorrência.");
    } finally {
      setDeleteId(null);
    }
  };

  const handleProcessNow = async () => {
    if (!selectedCompany || !user) return;
    try {
      const count = await recurrenceService.processDueTemplates(
        selectedCompany.id,
        { uid: user.uid, email: user.email },
      );
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
      case "daily":
        return `${intervalLabel}${interval > 1 ? "dias" : "Diário"}`;
      case "weekly":
        return `${intervalLabel}${interval > 1 ? "semanas" : "Semanal"}`;
      case "monthly":
        return `${intervalLabel}${interval > 1 ? "meses" : "Mensal"}`;
      case "yearly":
        return `${intervalLabel}${interval > 1 ? "anos" : "Anual"}`;
      default:
        return freq;
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
        {canManageRecurrences && (
          <Button onClick={handleProcessNow} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Verificar Pendências
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Modelos de Recorrência</CardTitle>
              <CardDescription>
                Lista de transações que são geradas automaticamente.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por descrição..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-[250px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="paused">Pausados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
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
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhuma recorrência encontrada.
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((t) => (
                  <TableRow
                    key={t.id}
                    className={!t.active ? "opacity-60" : ""}
                  >
                    <TableCell className="font-medium">
                      {t.description}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.type === "payable" ? "destructive" : "default"
                        }
                        className={
                          t.type === "payable"
                            ? "bg-red-100 text-red-800 hover:bg-red-200"
                            : "bg-green-100 text-green-800 hover:bg-green-200"
                        }
                      >
                        {t.type === "payable" ? "Despesa" : "Receita"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(t.amount)}</TableCell>
                    <TableCell>
                      {getFrequencyLabel(t.frequency, t.interval)}
                    </TableCell>
                    <TableCell>{format(t.nextDueDate, "dd/MM/yyyy")}</TableCell>
                    <TableCell>
                      <Badge variant={t.active ? "default" : "secondary"}>
                        {t.active ? "Ativo" : "Pausado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManageRecurrences && (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditTemplate(t)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleActive(t)}
                            title={t.active ? "Pausar" : "Ativar"}
                          >
                            {t.active ? (
                              <PauseCircle className="h-4 w-4" />
                            ) : (
                              <PlayCircle className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => setDeleteId(t.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {hasMore && !debouncedSearchTerm && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                onClick={() => fetchTemplates(true)}
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
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Desativar Recorrência"
        description="Tem certeza que deseja desativar esta recorrência? Ela parará de gerar transações, mas poderá ser reativada depois."
        confirmText="Desativar"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <EditRecurrenceDialog
        open={!!editTemplate}
        onOpenChange={(open) => !open && setEditTemplate(null)}
        template={editTemplate}
        onSuccess={fetchTemplates}
      />
    </div>
  );
}
