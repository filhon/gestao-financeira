"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
  Archive,
  ArchiveRestore,
  Building2,
} from "lucide-react";
import {
  entityService,
  matchesEntitySearch,
} from "@/lib/services/entityService";
import { Entity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  EntityFormSheet,
  entitiesQueryKey,
} from "@/components/features/entities/EntityFormSheet";
import {
  CategoryBadge,
  EntityFlags,
  displayDocument,
  hasBankDetails,
  isActive,
} from "@/components/features/entities/entityDisplay";
import {
  EntityPosition,
  loadEntityPositions,
  positionOf,
} from "@/components/features/entities/entityPositions";
import { exportEntitiesXlsx } from "@/components/features/entities/exportEntities";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSortableData } from "@/hooks/useSortableData";
import { usePermissions } from "@/hooks/usePermissions";
import { cn, formatCurrency, normalizeText } from "@/lib/utils";

type Row = Entity & {
  position: EntityPosition;
  sortName: string;
  open: number;
  overdue: number;
  lastPaidAt: number;
  duplicate: boolean;
};

type Filter = "all" | "pending_bank" | "no_bank" | "overdue" | "duplicate";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Sem filtro",
  pending_bank: "Troca bancária pendente",
  no_bank: "Sem dados bancários",
  overdue: "Com valor vencido",
  duplicate: "Possível duplicado",
};

const tabEmptyLabel: Record<string, string> = {
  all: "Nenhuma entidade cadastrada",
  supplier: "Nenhum fornecedor cadastrado",
  client: "Nenhum cliente cadastrado",
};

/** Erro do serviço escrito para o usuário; o resto vira texto genérico. */
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && !("code" in error) ? error.message : fallback;

function SortIcon({
  field,
  sortConfig,
}: {
  field: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
}) {
  if (sortConfig?.key !== field) {
    return (
      <ChevronsUpDown className="ml-1 inline h-3.5 w-3.5 text-muted-foreground/50" />
    );
  }
  return sortConfig.direction === "asc" ? (
    <ChevronUp className="ml-1 inline h-3.5 w-3.5 text-primary" />
  ) : (
    <ChevronDown className="ml-1 inline h-3.5 w-3.5 text-primary" />
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 px-6 py-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Nome sem acento/caixa e documento só com dígitos: chaves de duplicidade. */
function duplicateIds(entities: Entity[]) {
  const groups = new Map<string, string[]>();
  for (const e of entities) {
    const keys = [`n:${normalizeText(e.name.trim())}`];
    const digits = e.document?.replace(/\D/g, "");
    if (digits) keys.push(`d:${digits}`);
    for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), e.id]);
  }
  return new Set([...groups.values()].filter((g) => g.length > 1).flat());
}

export default function EntitiesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedCompany } = useCompany();
  const {
    canManageEntities,
    canViewEntities,
    canApproveBankChanges,
    onlyOwnPayables,
  } = usePermissions();

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [toDelete, setToDelete] = useState<Entity | null>(null);
  const [toDeactivate, setToDeactivate] = useState<Entity[] | null>(null);
  // Inativar oferecido no lugar de uma exclusão que apagaria referência de lançamentos
  const [blockedDelete, setBlockedDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

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
    queryKey: entitiesQueryKey(selectedCompany?.id),
    queryFn: () => entityService.getAll(selectedCompany!.id),
    enabled: !!selectedCompany && canViewEntities,
    staleTime: 5 * 60 * 1000,
  });

  const ownOnly = onlyOwnPayables ? user?.uid : undefined;
  const { data: positions, isLoading: positionsLoading } = useQuery({
    queryKey: ["entity-positions", selectedCompany?.id, ownOnly],
    queryFn: () =>
      loadEntityPositions(selectedCompany!.id, allEntities, ownOnly),
    enabled: !!selectedCompany && allEntities.length > 0,
    staleTime: 60 * 1000,
  });

  const duplicates = useMemo(() => duplicateIds(allEntities), [allEntities]);

  const rows = useMemo<Row[]>(
    () =>
      allEntities.map((e) => {
        const position = positionOf(positions, e.id);
        return {
          ...e,
          position,
          sortName: normalizeText(e.name.trim()),
          open: position.open,
          overdue: position.overdue,
          lastPaidAt: position.lastPaid?.getTime() ?? 0,
          duplicate: duplicates.has(e.id),
        };
      }),
    [allEntities, positions, duplicates],
  );

  const activeRows = rows.filter(isActive);
  const totalSuppliers = activeRows.filter(
    (e) => e.category === "supplier" || e.category === "both",
  ).length;
  const totalClients = activeRows.filter(
    (e) => e.category === "client" || e.category === "both",
  ).length;
  const pendingBank = rows.filter((e) => e.pendingBankChange);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (e) =>
          (activeTab === "all" ||
            e.category === activeTab ||
            e.category === "both") &&
          (status === "all" || (status === "active") === isActive(e)) &&
          (filter === "all" ||
            (filter === "pending_bank" && !!e.pendingBankChange) ||
            (filter === "no_bank" &&
              e.category !== "client" &&
              !hasBankDetails(e)) ||
            (filter === "overdue" && e.overdue > 0) ||
            (filter === "duplicate" && e.duplicate)) &&
          matchesEntitySearch(e, searchTerm),
      ),
    [rows, activeTab, status, filter, searchTerm],
  );

  const {
    items: sortedRows,
    requestSort,
    sortConfig,
  } = useSortableData(filteredRows, { key: "sortName", direction: "asc" });

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const resetPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
      setSelected(new Set());
    };
  const handleSearch = resetPage(setSearchTerm);

  const selectedRows = sortedRows.filter((r) => selected.has(r.id));
  const allOnPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach((r) =>
        allOnPageSelected ? next.delete(r.id) : next.add(r.id),
      );
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const actor = user ? { uid: user.uid, email: user.email } : null;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["entities-all"] });
    queryClient.invalidateQueries({ queryKey: ["entity-positions"] });
  };

  const setActive = async (entities: Entity[], active: boolean) => {
    if (!actor || !selectedCompany) return;
    try {
      await entityService.setActive(
        entities,
        active,
        actor,
        selectedCompany.id,
      );
      toast.success(
        entities.length === 1
          ? `${entities[0].name} ${active ? "reativada" : "inativada"}.`
          : `${entities.length} entidades ${active ? "reativadas" : "inativadas"}.`,
      );
      setSelected(new Set());
      refresh();
    } catch (error) {
      console.error("Error toggling entity:", error);
      toast.error("Não foi possível alterar a situação.");
    }
  };

  // Com lançamentos, excluir apagaria a referência do histórico: oferece inativar.
  const requestDelete = async (entity: Entity) => {
    if (!selectedCompany) return;
    try {
      const used = await entityService.hasTransactions(
        selectedCompany.id,
        entity,
      );
      if (used) {
        setBlockedDelete(true);
        setToDeactivate([entity]);
      } else setToDelete(entity);
    } catch {
      toast.error("Não foi possível verificar os lançamentos da entidade.");
    }
  };

  const handleDelete = async () => {
    if (!toDelete || !actor || !selectedCompany) return;
    try {
      await entityService.delete(toDelete.id, actor, selectedCompany.id);
      toast.success("Entidade excluída.");
      refresh();
    } catch (error) {
      console.error("Error deleting entity:", error);
      toast.error(messageOf(error, "Erro ao excluir a entidade."));
    } finally {
      setToDelete(null);
    }
  };

  const handleExport = async (list: Row[]) => {
    setExporting(true);
    try {
      await exportEntitiesXlsx(list);
    } catch (error) {
      console.error("Error exporting entities:", error);
      toast.error("Não foi possível gerar a planilha.");
    } finally {
      setExporting(false);
    }
  };

  const openEdit = (entity: Entity) => {
    setEditing(entity);
    setFormOpen(true);
  };
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  if (!canViewEntities) return null;

  const money = (value: number, className?: string) =>
    positionsLoading ? (
      <Skeleton className="ml-auto h-4 w-20" />
    ) : value > 0 ? (
      <span className={cn("font-financial tabular-nums", className)}>
        {formatCurrency(value)}
      </span>
    ) : (
      <span className="text-muted-foreground/50">—</span>
    );

  const rowMenu = (entity: Entity) =>
    canManageEntities && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Ações de ${entity.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(entity)}>
            <Pencil className="mr-2 h-4 w-4" /> Editar
          </DropdownMenuItem>
          {isActive(entity) ? (
            <DropdownMenuItem onClick={() => setToDeactivate([entity])}>
              <Archive className="mr-2 h-4 w-4" /> Inativar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setActive([entity], true)}>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Reativar
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => requestDelete(entity)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const emptyState = (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <Building2 className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">
        {searchTerm
          ? `Nenhum resultado para "${searchTerm}"`
          : filter !== "all" || status !== "active"
            ? "Nenhuma entidade com estes filtros"
            : tabEmptyLabel[activeTab]}
      </p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        {searchTerm
          ? "Busque também pelo nome fantasia ou pelos dígitos do CNPJ/CPF."
          : "Cadastre fornecedores e clientes para usá-los nas contas a pagar e a receber."}
      </p>
      {searchTerm || filter !== "all" || status !== "active" ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            handleSearch("");
            setFilter("all");
            setStatus("active");
          }}
        >
          Limpar filtros
        </Button>
      ) : (
        canManageEntities && (
          <Button size="sm" className="mt-4" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Cadastrar entidade
          </Button>
        )
      )}
    </div>
  );

  const errorState = (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
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
      totalItems={sortedRows.length}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );

  const sortableHead = (key: string, label: string, className?: string) => (
    <TableHead
      className={cn("cursor-pointer select-none hover:text-primary", className)}
      onClick={() => requestSort(key)}
      aria-sort={
        sortConfig?.key === key
          ? sortConfig.direction === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      {label}
      <SortIcon field={key} sortConfig={sortConfig} />
    </TableHead>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 md:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Entidades
          </h1>
          {isLoading ? (
            <Skeleton className="mt-2 h-4 w-56" />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {activeRows.length}
              </span>{" "}
              ativas ·{" "}
              <span className="font-medium text-foreground tabular-nums">
                {totalSuppliers}
              </span>{" "}
              {totalSuppliers === 1 ? "fornecedor" : "fornecedores"} ·{" "}
              <span className="font-medium text-foreground tabular-nums">
                {totalClients}
              </span>{" "}
              {totalClients === 1 ? "cliente" : "clientes"}
              {rows.length > activeRows.length &&
                ` · ${rows.length - activeRows.length} inativas`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => handleExport(sortedRows)}
            loading={exporting}
            disabled={isLoading || sortedRows.length === 0}
          >
            <Download className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Exportar</span>
          </Button>
          {canManageEntities && (
            <Button size="sm" className="h-9" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Nova entidade</span>
            </Button>
          )}
        </div>
      </div>

      {canApproveBankChanges &&
        pendingBank.length > 0 &&
        filter !== "pending_bank" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {pendingBank.length === 1
                ? "1 troca de dados bancários aguarda aprovação."
                : `${pendingBank.length} trocas de dados bancários aguardam aprovação.`}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-background"
              onClick={() => {
                setFilter("pending_bank");
                setStatus("all");
                setPage(1);
              }}
            >
              Revisar
            </Button>
          </div>
        )}

      <Card className="gap-0 py-0">
        <CardHeader className="gap-3 border-b px-4 py-4 md:px-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative flex-1 lg:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Nome, nome fantasia ou CNPJ/CPF"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-10 pl-9 pr-8 md:h-9"
                aria-label="Buscar entidades"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => handleSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Tabs value={activeTab} onValueChange={resetPage(setActiveTab)}>
              <TabsList className="w-full lg:w-auto">
                <TabsTrigger value="all" className="flex-1 lg:flex-initial">
                  Todos
                </TabsTrigger>
                <TabsTrigger
                  value="supplier"
                  className="flex-1 lg:flex-initial"
                >
                  Fornecedores
                </TabsTrigger>
                <TabsTrigger value="client" className="flex-1 lg:flex-initial">
                  Clientes
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex gap-2">
              <Select
                value={status}
                onValueChange={(v) => resetPage(setStatus)(v as typeof status)}
              >
                <SelectTrigger
                  className="h-9 w-full lg:w-32"
                  aria-label="Situação"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativas</SelectItem>
                  <SelectItem value="inactive">Inativas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filter}
                onValueChange={(v) => resetPage(setFilter)(v as Filter)}
              >
                <SelectTrigger
                  className="h-9 w-full lg:w-56"
                  aria-label="Filtro"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FILTER_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isLoading && !isError && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums lg:ml-auto">
                {sortedRows.length} resultado
                {sortedRows.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="font-medium">
                {selectedRows.length} selecionada
                {selectedRows.length !== 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 bg-background"
                onClick={() => handleExport(selectedRows)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar
              </Button>
              {canManageEntities && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 bg-background"
                    onClick={() =>
                      setToDeactivate(selectedRows.filter(isActive))
                    }
                    disabled={!selectedRows.some(isActive)}
                  >
                    <Archive className="mr-1.5 h-3.5 w-3.5" /> Inativar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 bg-background"
                    onClick={() =>
                      setActive(
                        selectedRows.filter((r) => !isActive(r)),
                        true,
                      )
                    }
                    disabled={selectedRows.every(isActive)}
                  >
                    <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Reativar
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => setSelected(new Set())}
              >
                Limpar seleção
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isError ? (
            errorState
          ) : isLoading ? (
            <TableSkeleton />
          ) : sortedRows.length === 0 ? (
            emptyState
          ) : (
            <>
              {/* ── Desktop: Table ─────────────────────────────────────── */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-6">
                        <Checkbox
                          checked={allOnPageSelected}
                          onCheckedChange={togglePage}
                          aria-label="Selecionar todas da página"
                        />
                      </TableHead>
                      {sortableHead("sortName", "Nome")}
                      {sortableHead("document", "CPF/CNPJ", "w-44")}
                      {sortableHead("category", "Categoria", "w-40")}
                      {sortableHead("open", "Em aberto", "w-36 text-right")}
                      {sortableHead("overdue", "Vencido", "w-36 text-right")}
                      {sortableHead("lastPaidAt", "Último pgto.", "w-32")}
                      <TableHead className="w-28">Pagamento</TableHead>
                      <TableHead className="w-12 pr-6">
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((entity) => (
                      <TableRow
                        key={entity.id}
                        className={cn(
                          "cursor-pointer",
                          !isActive(entity) && "text-muted-foreground",
                        )}
                        data-state={
                          selected.has(entity.id) ? "selected" : undefined
                        }
                        onClick={() =>
                          router.push(`/cadastros/entidades/${entity.id}`)
                        }
                      >
                        <TableCell
                          className="pl-6"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected.has(entity.id)}
                            onCheckedChange={() => toggle(entity.id)}
                            aria-label={`Selecionar ${entity.name}`}
                          />
                        </TableCell>
                        <TableCell className="max-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">
                              {entity.name}
                            </span>
                            <EntityFlags entity={entity} />
                            {entity.duplicate && (
                              <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
                                Possível duplicado
                              </span>
                            )}
                          </div>
                          {entity.tradeName && (
                            <p className="truncate text-xs text-muted-foreground">
                              {entity.tradeName}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="font-financial text-xs text-muted-foreground">
                          {displayDocument(entity.document)}
                        </TableCell>
                        <TableCell>
                          <CategoryBadge category={entity.category} />
                        </TableCell>
                        <TableCell className="text-right">
                          {money(entity.open)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(
                            entity.overdue,
                            "font-medium text-destructive",
                          )}
                        </TableCell>
                        <TableCell className="font-financial text-xs text-muted-foreground">
                          {entity.position.lastPaid
                            ? format(entity.position.lastPaid, "dd/MM/yyyy")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {entity.pixKey ? (
                            "PIX"
                          ) : entity.account ? (
                            "Conta"
                          ) : entity.category === "client" ? (
                            <span className="text-muted-foreground/50">—</span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400">
                              Faltando
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="pr-6 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {rowMenu(entity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="px-6 py-4">{pagination}</div>
              </div>

              {/* ── Mobile: lista ───────────────────────────────────────── */}
              <div className="divide-y md:hidden">
                {pageRows.map((entity) => (
                  <div
                    key={entity.id}
                    className="flex items-center gap-3 px-4 py-3.5"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() =>
                        router.push(`/cadastros/entidades/${entity.id}`)
                      }
                    >
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {entity.name}
                        </p>
                        <EntityFlags entity={entity} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-financial">
                          {displayDocument(entity.document)}
                        </span>
                        {entity.open > 0 && (
                          <>
                            {" · "}
                            <span className="font-financial">
                              {formatCurrency(entity.open)} em aberto
                            </span>
                          </>
                        )}
                        {entity.overdue > 0 && (
                          <span className="text-destructive">
                            {" · "}
                            {formatCurrency(entity.overdue)} vencido
                          </span>
                        )}
                      </p>
                    </button>
                    {rowMenu(entity)}
                  </div>
                ))}
                <div className="px-4 py-3">{pagination}</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <EntityFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        entity={editing}
        onSaved={() =>
          queryClient.invalidateQueries({ queryKey: ["entity-positions"] })
        }
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Excluir entidade"
        description={`Excluir "${toDelete?.name ?? ""}"? Ela não tem lançamentos; a exclusão não pode ser desfeita.`}
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!toDeactivate}
        onOpenChange={(open) => {
          if (open) return;
          setToDeactivate(null);
          setBlockedDelete(false);
        }}
        title={
          toDeactivate?.length === 1
            ? `Inativar ${toDeactivate[0].name}?`
            : `Inativar ${toDeactivate?.length ?? 0} entidades?`
        }
        description={`${blockedDelete ? "Esta entidade tem lançamentos e não pode ser excluída sem perder a referência no histórico. " : ""}Inativa sai dos formulários de lançamento e da busca de fornecedor. O histórico continua, e dá para reativar quando quiser.`}
        confirmText="Inativar"
        onConfirm={async () => {
          if (toDeactivate) await setActive(toDeactivate, false);
          setToDeactivate(null);
          setBlockedDelete(false);
        }}
      />
    </div>
  );
}
