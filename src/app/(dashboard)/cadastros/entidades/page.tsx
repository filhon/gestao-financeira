"use client";

import { useEffect, useMemo, useState } from "react";
import {
  entityService,
  matchesEntitySearch,
} from "@/lib/services/entityService";
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
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
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
import { Pagination } from "@/components/ui/pagination";
import {
  Plus,
  Pencil,
  Trash2,
  Building2,
  User,
  Search,
  MoreHorizontal,
  X,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { EntityForm } from "@/components/features/entities/EntityForm";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSortableData } from "@/hooks/useSortableData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

function getEntityInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
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
      className="font-normal text-orange-700 border-orange-300 bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:bg-orange-950/30"
    >
      Fornecedor
    </Badge>
  ),
  client: (
    <Badge
      variant="outline"
      className="font-normal text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:bg-blue-950/30"
    >
      Cliente
    </Badge>
  ),
  both: (
    <Badge
      variant="outline"
      className="font-normal text-violet-700 border-violet-300 bg-violet-50 dark:text-violet-400 dark:border-violet-800 dark:bg-violet-950/30"
    >
      Ambos
    </Badge>
  ),
};

const tabEmptyLabel: Record<string, string> = {
  all: "Nenhuma entidade cadastrada",
  supplier: "Nenhum fornecedor cadastrado",
  client: "Nenhum cliente cadastrado",
};

function SortIcon({
  field,
  sortConfig,
}: {
  field: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
}) {
  if (sortConfig?.key !== field) {
    return (
      <ChevronsUpDown className="inline ml-1 h-3.5 w-3.5 text-muted-foreground/50" />
    );
  }
  return sortConfig.direction === "asc" ? (
    <ChevronUp className="inline ml-1 h-3.5 w-3.5 text-primary" />
  ) : (
    <ChevronDown className="inline ml-1 h-3.5 w-3.5 text-primary" />
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-1 py-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 flex-1 max-w-[180px]" />
              <Skeleton className="h-5 w-20 rounded-full shrink-0" />
            </div>
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-8 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface MobileEntityCardProps {
  entity: Entity;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function MobileEntityCard({
  entity,
  canManage,
  onView,
  onEdit,
  onDelete,
}: MobileEntityCardProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <button
        type="button"
        className="flex-1 text-left min-w-0"
        onClick={onView}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback
                className={`text-xs font-medium ${getAvatarColor(entity.name)}`}
              >
                {getEntityInitials(entity.name)}
              </AvatarFallback>
            </Avatar>
            <p className="text-sm font-medium truncate">{entity.name}</p>
          </div>
          <div className="shrink-0">{categoryBadge[entity.category]}</div>
        </div>
        <div className="flex items-center gap-2 mt-1 ml-10">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {entity.type === "company" ? (
              <Building2 className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
            {entity.type === "company" ? "Pessoa Jurídica" : "Pessoa Física"}
          </span>
          {entity.document && (
            <span className="text-xs text-muted-foreground font-mono">
              · {entity.document}
            </span>
          )}
        </div>
      </button>

      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-11 w-11 p-0 shrink-0 -mr-2"
              aria-label="Ações da entidade"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Ações</DropdownMenuLabel>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Editar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-red-600 focus:text-red-700"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="h-11 w-11 shrink-0 -mr-2" />
      )}
    </div>
  );
}

export default function EntitiesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { canManageEntities, canViewEntities } = usePermissions();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [entityToDelete, setEntityToDelete] = useState<Entity | null>(null);

  useEffect(() => {
    if (!canViewEntities) {
      router.push("/dashboard");
    }
  }, [canViewEntities, router]);

  // ponytail: carrega tudo e pagina no cliente. Entidades por empresa são
  // centenas, não milhares; o serviço já fazia isso na busca. Se um tenant
  // passar de alguns milhares, voltar para cursor no Firestore.
  const {
    data: allEntities = [],
    isLoading,
    isError,
    refetch: fetchEntities,
  } = useQuery({
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

  const filteredEntities = useMemo(
    () =>
      allEntities.filter(
        (e) =>
          (activeTab === "all" ||
            e.category === activeTab ||
            e.category === "both") &&
          matchesEntitySearch(e, searchTerm),
      ),
    [allEntities, activeTab, searchTerm],
  );

  const {
    items: sortedEntities,
    requestSort,
    sortConfig,
  } = useSortableData(filteredEntities, { key: "name", direction: "asc" });

  const totalPages = Math.max(1, Math.ceil(sortedEntities.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageEntities = sortedEntities.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setPage(1);
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setPage(1);
  };

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
    if (!entityToDelete || !user || !selectedCompany) return;
    try {
      await entityService.delete(
        entityToDelete.id,
        { uid: user.uid, email: user.email },
        selectedCompany.id,
      );
      toast.success("Entidade excluída com sucesso!");
      fetchEntities();
    } catch (error) {
      console.error("Error deleting entity:", error);
      toast.error("Erro ao excluir entidade.");
    } finally {
      setEntityToDelete(null);
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

  const resultCount = !isLoading && !isError && (
    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
      {sortedEntities.length} resultado
      {sortedEntities.length !== 1 ? "s" : ""}
    </span>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Building2 className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="font-medium">
        {searchTerm
          ? `Nenhum resultado para "${searchTerm}"`
          : tabEmptyLabel[activeTab]}
      </p>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs">
        {searchTerm
          ? "Verifique a grafia ou tente buscar pelo CNPJ/CPF."
          : "Cadastre fornecedores e clientes para usá-los nas contas a pagar e a receber."}
      </p>
      {searchTerm ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => handleSearch("")}
        >
          Limpar busca
        </Button>
      ) : (
        canManageEntities && (
          <Button size="sm" className="mt-4" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" /> Criar entidade
          </Button>
        )
      )}
    </div>
  );

  const errorState = (
    <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
      <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
        <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
      </div>
      <div>
        <p className="font-medium">Erro ao carregar entidades</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Não foi possível buscar os dados. Tente novamente.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => fetchEntities()}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Tentar novamente
      </Button>
    </div>
  );

  const pagination = (
    <Pagination
      page={currentPage}
      totalItems={sortedEntities.length}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Entidades
          </h1>
          {isLoading ? (
            <Skeleton className="h-4 w-56 mt-2" />
          ) : (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground tabular-nums">
                  {totalEntities}
                </span>{" "}
                {totalEntities === 1 ? "entidade" : "entidades"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span>
                <span className="font-medium text-foreground tabular-nums">
                  {totalSuppliers}
                </span>{" "}
                {totalSuppliers === 1 ? "fornecedor" : "fornecedores"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span>
                <span className="font-medium text-foreground tabular-nums">
                  {totalClients}
                </span>{" "}
                {totalClients === 1 ? "cliente" : "clientes"}
              </span>
            </div>
          )}
        </div>
        {canManageEntities && (
          <Button
            size="sm"
            className="h-9"
            onClick={openCreateDialog}
            aria-label="Nova entidade"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">Nova Entidade</span>
          </Button>
        )}
      </div>

      {/* Table card */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Fornecedores e Clientes</CardTitle>
            {resultCount}
            <CardDescription className="sr-only">
              Lista de pessoas e empresas cadastradas.
            </CardDescription>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative flex-1 md:flex-initial md:w-[260px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou CNPJ/CPF..."
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9 pr-8 h-10 md:h-9"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => handleSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList className="w-full md:w-auto">
                <TabsTrigger value="all" className="flex-1 md:flex-initial">
                  Todos
                </TabsTrigger>
                <TabsTrigger
                  value="supplier"
                  className="flex-1 md:flex-initial"
                >
                  Fornecedores
                </TabsTrigger>
                <TabsTrigger value="client" className="flex-1 md:flex-initial">
                  Clientes
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isError ? (
            errorState
          ) : isLoading ? (
            <>
              <div className="hidden md:block px-6 py-2">
                <TableSkeleton />
              </div>
              <div className="md:hidden">
                <MobileCardSkeleton />
              </div>
            </>
          ) : sortedEntities.length === 0 ? (
            emptyState
          ) : (
            <>
              {/* ── Desktop: Table ─────────────────────────────────────── */}
              <div className="hidden md:block px-6 pb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer hover:text-primary select-none"
                        onClick={() => requestSort("name")}
                      >
                        Nome
                        <SortIcon field="name" sortConfig={sortConfig} />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary select-none"
                        onClick={() => requestSort("type")}
                      >
                        Tipo
                        <SortIcon field="type" sortConfig={sortConfig} />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary select-none"
                        onClick={() => requestSort("category")}
                      >
                        Categoria
                        <SortIcon field="category" sortConfig={sortConfig} />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:text-primary select-none"
                        onClick={() => requestSort("document")}
                      >
                        Documento
                        <SortIcon field="document" sortConfig={sortConfig} />
                      </TableHead>
                      {canManageEntities && (
                        <TableHead className="text-right">Ações</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageEntities.map((entity) => (
                      <TableRow
                        key={entity.id}
                        className="group"
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
                            <span>{entity.name}</span>
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
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {entity.document || "-"}
                        </TableCell>
                        {canManageEntities && (
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEditDialog(entity)}
                                aria-label={`Editar ${entity.name}`}
                                title="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:text-red-700"
                                onClick={() => setEntityToDelete(entity)}
                                aria-label={`Excluir ${entity.name}`}
                                title="Excluir"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="pt-4">{pagination}</div>
              </div>

              {/* ── Mobile: Card list ───────────────────────────────────── */}
              <div className="md:hidden divide-y">
                {pageEntities.map((entity) => (
                  <MobileEntityCard
                    key={entity.id}
                    entity={entity}
                    canManage={canManageEntities}
                    onView={() =>
                      router.push(`/cadastros/entidades/${entity.id}`)
                    }
                    onEdit={() => openEditDialog(entity)}
                    onDelete={() => setEntityToDelete(entity)}
                  />
                ))}

                <div className="px-4 py-3">{pagination}</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ResponsiveModal open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <ResponsiveModalContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              {selectedEntity ? "Editar Entidade" : "Nova Entidade"}
            </ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {selectedEntity
                ? "Atualize os dados da entidade."
                : "Preencha os dados para criar um novo fornecedor ou cliente."}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <EntityForm
            defaultValues={selectedEntity || {}}
            onSubmit={selectedEntity ? handleUpdate : handleCreate}
            isLoading={isSubmitting}
            onCancel={() => setIsDialogOpen(false)}
          />
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ConfirmDialog
        open={!!entityToDelete}
        onOpenChange={(open) => !open && setEntityToDelete(null)}
        title="Excluir Entidade"
        description={`Excluir "${entityToDelete?.name ?? ""}"? Esta ação não pode ser desfeita.`}
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
