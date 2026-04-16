"use client";

import { useEffect, useState } from "react";
import { entityService } from "@/lib/services/entityService";
import { Entity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Pencil,
  Trash2,
  Building2,
  User,
  Loader2,
  Eye,
  Search,
  Users,
  TruckIcon,
  HandshakeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EntityForm } from "@/components/features/entities/EntityForm";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSortableData } from "@/hooks/useSortableData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce";
import { usePaginatedQuery } from "@/hooks/usePaginatedQuery";
import { useQuery } from "@tanstack/react-query";

function getEntityInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-orange-100 text-orange-700",
    "bg-violet-100 text-violet-700",
    "bg-rose-100 text-rose-700",
    "bg-cyan-100 text-cyan-700",
    "bg-amber-100 text-amber-700",
    "bg-teal-100 text-teal-700",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

const categoryBadge: Record<string, React.ReactNode> = {
  supplier: (
    <Badge
      variant="outline"
      className="text-orange-600 border-orange-300 bg-orange-50 font-normal"
    >
      Fornecedor
    </Badge>
  ),
  client: (
    <Badge
      variant="outline"
      className="text-blue-600 border-blue-300 bg-blue-50 font-normal"
    >
      Cliente
    </Badge>
  ),
  both: (
    <Badge
      variant="outline"
      className="text-violet-600 border-violet-300 bg-violet-50 font-normal"
    >
      Ambos
    </Badge>
  ),
};

export default function EntitiesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { canManageEntities, canViewEntities } = usePermissions();

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewEntities) {
      router.push("/dashboard");
    }
  }, [canViewEntities, router]);

  // KPI totals
  const { data: allEntities = [] } = useQuery({
    queryKey: ["entities-all", selectedCompany?.id],
    queryFn: () => entityService.getAll(selectedCompany!.id),
    enabled: !!selectedCompany && canViewEntities,
    staleTime: 5 * 60 * 1000,
  });

  const totalEntities = allEntities.length;
  const totalSuppliers = allEntities.filter(
    (e) => e.category === "supplier" || e.category === "both",
  ).length;
  const totalClients = allEntities.filter(
    (e) => e.category === "client" || e.category === "both",
  ).length;

  const {
    items: entities,
    hasMore,
    loadMore,
    isLoading,
    isFetchingNextPage,
    refresh: fetchEntities,
  } = usePaginatedQuery<Entity>({
    queryKey: ["entities", selectedCompany?.id, activeTab, debouncedSearchTerm],
    queryFn: async (pageSize, lastDoc) => {
      const category =
        activeTab === "all" ? undefined : (activeTab as "supplier" | "client");

      const { entities: items, lastDoc: newLastDoc } =
        await entityService.getPaginated(
          selectedCompany!.id,
          pageSize,
          lastDoc,
          {
            category,
            search: debouncedSearchTerm || undefined,
          },
        );

      return { items, lastDoc: newLastDoc };
    },
    pageSize: 25,
    enabled: !!selectedCompany && canViewEntities,
  });

  const {
    items: sortedEntities,
    requestSort,
    sortConfig,
  } = useSortableData(entities);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreate = async (data: any) => {
    if (!selectedCompany || !user) return;
    try {
      setIsSubmitting(true);
      await entityService.create(
        { ...data, companyId: selectedCompany.id },
        { uid: user.uid, email: user.email },
      );
      toast.success("Entidade criada com sucesso!");
      setIsDialogOpen(false);
      fetchEntities();
    } catch (error) {
      console.error("Error creating entity:", error);
      toast.error("Erro ao criar entidade.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdate = async (data: any) => {
    if (!selectedEntity || !user || !selectedCompany) return;
    try {
      setIsSubmitting(true);
      await entityService.update(
        selectedEntity.id,
        data,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Entidade atualizada com sucesso!");
      setIsDialogOpen(false);
      setSelectedEntity(null);
      fetchEntities();
    } catch (error) {
      console.error("Error updating entity:", error);
      toast.error("Erro ao atualizar entidade.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    if (!user || !selectedCompany) return;
    try {
      await entityService.delete(
        deleteId,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Entidade excluída com sucesso!");
      fetchEntities();
    } catch (error) {
      console.error("Error deleting entity:", error);
      toast.error("Erro ao excluir entidade.");
    } finally {
      setDeleteId(null);
    }
  };

  const openEditDialog = (entity: Entity) => {
    setSelectedEntity(entity);
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setSelectedEntity(null);
    setIsDialogOpen(true);
  };

  if (!canViewEntities) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cadastros</h1>
          <p className="text-muted-foreground">
            Gerencie fornecedores e clientes.
          </p>
        </div>
        {canManageEntities && (
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" /> Nova Entidade
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{totalEntities}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-50">
                <TruckIcon className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Fornecedores</p>
                <p className="text-2xl font-bold">{totalSuppliers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <HandshakeIcon className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Clientes</p>
                <p className="text-2xl font-bold">{totalClients}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table Card with integrated Tabs */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Entidades</CardTitle>
              <CardDescription>
                Lista de pessoas e empresas cadastradas.
              </CardDescription>
            </div>
            <div className="w-[300px]">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou CNPJ/CPF..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Tabs defaultValue="all" onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="supplier">Fornecedores</TabsTrigger>
                <TabsTrigger value="client">Clientes</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("name")}
                  >
                    Nome{" "}
                    {sortConfig?.key === "name" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("type")}
                  >
                    Tipo{" "}
                    {sortConfig?.key === "type" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("category")}
                  >
                    Categoria{" "}
                    {sortConfig?.key === "category" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-primary"
                    onClick={() => requestSort("document")}
                  >
                    Documento{" "}
                    {sortConfig?.key === "document" &&
                      (sortConfig.direction === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && entities.length === 0 ? (
                  // Skeleton rows
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-7 w-7 rounded-full" />
                          <Skeleton className="h-4 w-40" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell className="flex justify-end gap-2">
                        <Skeleton className="h-8 w-8 rounded-md" />
                        <Skeleton className="h-8 w-8 rounded-md" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : sortedEntities.length === 0 ? (
                  // Empty state
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Building2 className="h-10 w-10 opacity-20" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            Nenhuma entidade encontrada
                          </p>
                          <p className="text-xs">
                            {debouncedSearchTerm
                              ? `Sem resultados para "${debouncedSearchTerm}"`
                              : "Comece cadastrando seu primeiro fornecedor ou cliente."}
                          </p>
                        </div>
                        {canManageEntities && !debouncedSearchTerm && (
                          <Button size="sm" onClick={openCreateDialog}>
                            <Plus className="h-3 w-3 mr-1" /> Criar entidade
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedEntities.map((entity) => (
                    <TableRow
                      key={entity.id}
                      className="group cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        router.push(`/cadastros/entidades/${entity.id}`)
                      }
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback
                              className={`text-xs font-medium ${getAvatarColor(entity.name)}`}
                            >
                              {getEntityInitials(entity.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="hover:underline">{entity.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          {entity.type === "company" ? (
                            <Building2 className="h-3.5 w-3.5" />
                          ) : (
                            <User className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {entity.type === "company"
                              ? "Pessoa Jurídica"
                              : "Pessoa Física"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {categoryBadge[entity.category] ?? entity.category}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {entity.document || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/cadastros/entidades/${entity.id}`);
                            }}
                            title="Ver detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canManageEntities && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditDialog(entity);
                                }}
                                title="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteId(entity.id);
                                }}
                                title="Excluir"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Footer: load more + result count */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted-foreground">
              {sortedEntities.length > 0 &&
                (hasMore
                  ? `Exibindo ${sortedEntities.length} entidades`
                  : `${sortedEntities.length} ${sortedEntities.length === 1 ? "entidade" : "entidades"} encontrada${sortedEntities.length === 1 ? "" : "s"}`)}
              {debouncedSearchTerm &&
                sortedEntities.length > 0 &&
                ` para "${debouncedSearchTerm}"`}
            </p>
            {hasMore && entities.length > 0 && (
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  "Carregar Mais"
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedEntity ? "Editar Entidade" : "Nova Entidade"}
            </DialogTitle>
            <DialogDescription>
              {selectedEntity
                ? "Atualize os dados da entidade."
                : "Preencha os dados para criar um novo fornecedor ou cliente."}
            </DialogDescription>
          </DialogHeader>
          <EntityForm
            defaultValues={selectedEntity || {}}
            onSubmit={selectedEntity ? handleUpdate : handleCreate}
            isLoading={isSubmitting}
            onCancel={() => setIsDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Excluir Entidade"
        description="Tem certeza que deseja excluir esta entidade?"
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
