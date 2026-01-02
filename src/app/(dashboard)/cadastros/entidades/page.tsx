"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import {
  Plus,
  Pencil,
  Trash2,
  Building2,
  User,
  Loader2,
  Eye,
  Search,
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
import { DocumentData } from "firebase/firestore";

export default function EntitiesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { canManageEntities, canViewEntities } = usePermissions();
  const [entities, setEntities] = useState<Entity[]>([]);
  const lastDocRef = useRef<DocumentData | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [itemsPerPage] = useState(25);
  const [searchTerm, setSearchTerm] = useState("");

  const {
    items: sortedEntities,
    requestSort,
    sortConfig,
  } = useSortableData(entities);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewEntities) {
      router.push("/");
    }
  }, [canViewEntities, router]);

  const fetchEntities = useCallback(
    async (isLoadMore = false) => {
      if (!selectedCompany || !canViewEntities) return;
      setIsLoading(true);
      try {
        const category =
          activeTab === "all"
            ? undefined
            : (activeTab as "supplier" | "client");

        const currentLastDoc = isLoadMore ? lastDocRef.current : null;

        const { entities: newEntities, lastDoc: newLastDoc } =
          await entityService.getPaginated(
            selectedCompany.id,
            itemsPerPage,
            currentLastDoc,
            {
              category,
              search: searchTerm || undefined,
            }
          );

        if (isLoadMore) {
          setEntities((prev) => [...prev, ...newEntities]);
        } else {
          setEntities(newEntities);
        }

        lastDocRef.current = newLastDoc;
        setHasMore(newEntities.length === itemsPerPage);
      } catch (error) {
        console.error("Error fetching entities:", error);
        toast.error("Erro ao carregar entidades.");
      } finally {
        setIsLoading(false);
      }
    },
    [selectedCompany, canViewEntities, activeTab, itemsPerPage, searchTerm]
  );

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      fetchEntities();
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchEntities]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreate = async (data: any) => {
    if (!selectedCompany || !user) return;
    try {
      await entityService.create(
        { ...data, companyId: selectedCompany.id },
        { uid: user.uid, email: user.email }
      );
      toast.success("Entidade criada com sucesso!");
      setIsDialogOpen(false);
      fetchEntities();
    } catch (error) {
      console.error("Error creating entity:", error);
      toast.error("Erro ao criar entidade.");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdate = async (data: any) => {
    if (!selectedEntity || !user || !selectedCompany) return;
    try {
      await entityService.update(
        selectedEntity.id,
        data,
        { uid: user.uid, email: user.email },
        selectedCompany.id
      );
      toast.success("Entidade atualizada com sucesso!");
      setIsDialogOpen(false);
      setSelectedEntity(null);
      fetchEntities();
    } catch (error) {
      console.error("Error updating entity:", error);
      toast.error("Erro ao atualizar entidade.");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    if (!user || !selectedCompany) return;
    try {
      await entityService.delete(
        deleteId,
        { uid: user.uid, email: user.email },
        selectedCompany.id
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

      <Tabs
        defaultValue="all"
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="supplier">Fornecedores</TabsTrigger>
          <TabsTrigger value="client">Clientes</TabsTrigger>
        </TabsList>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
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
          </CardHeader>
          <CardContent>
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
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : sortedEntities.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">
                        Nenhuma entidade encontrada.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedEntities.map((entity) => (
                      <TableRow
                        key={entity.id}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell
                          className="font-medium flex items-center gap-2"
                          onClick={() =>
                            router.push(`/cadastros/entidades/${entity.id}`)
                          }
                        >
                          {entity.type === "company" ? (
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="hover:underline">{entity.name}</span>
                        </TableCell>
                        <TableCell>
                          {entity.type === "company"
                            ? "Pessoa Jurídica"
                            : "Pessoa Física"}
                        </TableCell>
                        <TableCell>
                          {entity.category === "supplier" && "Fornecedor"}
                          {entity.category === "client" && "Cliente"}
                          {entity.category === "both" && "Ambos"}
                        </TableCell>
                        <TableCell>{entity.document || "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(
                                  `/cadastros/entidades/${entity.id}`
                                );
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

            {hasMore && entities.length > 0 && (
              <div className="flex justify-center mt-4">
                <Button
                  variant="outline"
                  onClick={() => fetchEntities(true)}
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
      </Tabs>

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
