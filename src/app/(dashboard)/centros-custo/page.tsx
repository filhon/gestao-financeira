"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  GitBranch,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { budgetService } from "@/lib/services/budgetService";
import { CostCenterForm } from "@/components/features/finance/CostCenterForm";
import { CostCenterFormData } from "@/lib/validations/costCenter";
import { formatCurrency } from "@/lib/utils";

import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import { useCostCenterStore } from "@/lib/store/useCostCenterStore";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

type CostCenterNode = CostCenter & { children: CostCenterNode[] };

function buildTree(items: CostCenter[]): CostCenterNode[] {
  const map = new Map<string, CostCenterNode>();
  const roots: CostCenterNode[] = [];

  items.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  items.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parentId && item.parentId !== "none" && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Removido o sortNodeChildren que quebrava a estrutura ao ordenar primariamente: CC-P03

  return roots;
}

// Agrega recursivamente usages e budget de toda a subárvore de um nó.
// - total: orçamento próprio (se definido) ou soma dos orçamentos dos filhos
// - used: soma dos usages de todos os descendentes folha
function aggregateNode(
  node: CostCenterNode,
  usages: Record<string, number>,
): { used: number; total: number } {
  if (node.children.length === 0) {
    return { used: usages[node.id] || 0, total: node.budget || 0 };
  }

  const childAgg = node.children.reduce(
    (acc, child) => {
      const c = aggregateNode(child, usages);
      return { used: acc.used + c.used, total: acc.total + c.total };
    },
    { used: 0, total: 0 },
  );

  return {
    used: childAgg.used,
    total: (node.budget || 0) > 0 ? node.budget! : childAgg.total,
  };
}

// Mini barra de progresso de orçamento
function BudgetBar({ used, total }: { used: number; total: number }) {
  if (!total || total <= 0) return null;
  const pct = Math.min((used / total) * 100, 100);
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface CostCenterRowProps {
  node: CostCenterNode;
  level: number;
  isLast: boolean;
  onEdit: (cc: CostCenter) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
  usages: Record<string, number>;
}

function CostCenterRow({
  node,
  level,
  isLast,
  onEdit,
  onDelete,
  canManage,
  usages,
}: CostCenterRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  // Cada "segmento" de nível pai contribui com 24px de largura para os conectores
  const INDENT = 24;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="group grid grid-cols-12 gap-4 py-3 border-b items-center hover:bg-muted/50 transition-colors text-sm">
        <div className="col-span-2 font-medium pl-4 truncate">
          <Link
            href={`/centros-custo/${node.id}`}
            className="hover:underline text-primary"
          >
            {node.code}
          </Link>
        </div>

        {/* Coluna Nome — conectores da árvore ficam aqui */}
        <div className="col-span-3 flex items-center">
          {Array.from({ length: level }).map((_, i) => {
            const isLastSegment = i === level - 1;
            return (
              <div
                key={i}
                className="relative flex-shrink-0 self-stretch"
                style={{ width: INDENT }}
              >
                {isLastSegment ? (
                  /* Cotovelo └ (último filho) ou ├ (tem irmãos abaixo) */
                  <>
                    {/* Vertical: topo até meio; se não é último, continua até o fundo */}
                    <div
                      className="absolute w-px bg-border"
                      style={{
                        left: 11,
                        top: 0,
                        height: isLast ? "50%" : "100%",
                      }}
                    />
                    {/* Horizontal: meio da linha até a direita */}
                    <div
                      className="absolute h-px bg-border"
                      style={{ left: 11, top: "50%", right: 0 }}
                    />
                  </>
                ) : (
                  /* Linha vertical passante para níveis ancestrais */
                  <div
                    className="absolute top-0 bottom-0 w-px bg-border"
                    style={{ left: 11 }}
                  />
                )}
              </div>
            );
          })}

          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 p-0 shrink-0"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-6 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
          {hasChildren && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 py-0 h-4 ml-1 shrink-0"
            >
              {node.children.length}
            </Badge>
          )}
        </div>

        {(() => {
          const agg = aggregateNode(node, usages);
          return (
            <div className="col-span-2 flex flex-col justify-center">
              {agg.total > 0 ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span>
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(agg.total)}
                    </span>
                    {node.budgetYear && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 h-5"
                      >
                        {node.budgetYear}
                      </Badge>
                    )}
                  </div>
                  <BudgetBar used={agg.used} total={agg.total} />
                </>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </div>
          );
        })()}

        <div
          className="col-span-2 text-muted-foreground truncate"
          title={node.approverEmail}
        >
          {node.approverEmail || "-"}
        </div>
        <div
          className="col-span-2 text-muted-foreground truncate"
          title={node.releaserEmail}
        >
          {node.releaserEmail || "-"}
        </div>

        <div className="col-span-1 text-right pr-4">
          {canManage && (
            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onEdit(node)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-600"
                onClick={() => onDelete(node.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <CollapsibleContent>
        <div className={isOpen ? "bg-muted/20" : ""}>
          {node.children.map((child, idx) => (
            <CostCenterRow
              key={child.id}
              node={child}
              level={level + 1}
              isLast={idx === node.children.length - 1}
              onEdit={onEdit}
              onDelete={onDelete}
              canManage={canManage}
              usages={usages}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Skeleton para loading da tabela
function TableSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-4 py-3 px-0 items-center">
          <div className="col-span-2 pl-4">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="col-span-3 flex items-center gap-2">
            <div className="w-6 shrink-0" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="col-span-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-1 w-full mt-1.5 rounded-full" />
          </div>
          <div className="col-span-2">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="col-span-2">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="col-span-1" />
        </div>
      ))}
    </div>
  );
}

// Ícone de sort
function SortIcon({
  columnKey,
  sortConfig,
}: {
  columnKey: string;
  sortConfig: { key: string; direction: "asc" | "desc" } | null;
}) {
  if (sortConfig?.key !== columnKey)
    return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />;
  return sortConfig.direction === "asc" ? (
    <ArrowUp className="h-3 w-3 ml-1" />
  ) : (
    <ArrowDown className="h-3 w-3 ml-1" />
  );
}

function MobileCardSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2 px-4 py-3.5">
          <div className="w-8 shrink-0 mt-1" />
          <div className="flex-1 space-y-2 min-w-0">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-9 w-9 rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

function MobileCostCenterCard({
  node,
  level = 0,
  onEdit,
  onDelete,
  canManage,
  usages,
}: {
  node: CostCenterNode;
  level?: number;
  onEdit: (cc: CostCenter) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
  usages: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const agg = aggregateNode(node, usages);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={[
          "flex items-start gap-2 py-3 border-b transition-colors",
          level > 0 ? "bg-muted/20" : "",
        ].join(" ")}
        style={{ paddingLeft: `${level * 16 + 16}px`, paddingRight: "16px" }}
      >
        {/* Expand toggle — min 44×44 touch area */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-center h-11 w-8 shrink-0 -ml-1 mt-0.5"
          aria-label={expanded ? "Recolher filhos" : "Expandir filhos"}
          disabled={!hasChildren}
        >
          {hasChildren && (
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </button>

        {/* Main content — tap navigates to detail */}
        <Link
          href={`/centros-custo/${node.id}`}
          className="flex-1 min-w-0 py-0.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[11px] font-mono text-muted-foreground">
                {node.code}
              </span>
              <p className="text-sm font-medium leading-snug truncate">
                {node.name}
              </p>
            </div>
            {hasChildren && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] py-0 h-4 align-middle"
              >
                {node.children.length}
              </Badge>
            )}
          </div>
          {agg.total > 0 && (
            <div className="mt-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-financial">
                  {formatCurrency(agg.used)}
                </span>
                <span className="font-financial">
                  {formatCurrency(agg.total)}
                </span>
              </div>
              <BudgetBar used={agg.used} total={agg.total} />
            </div>
          )}
          {node.approverEmail && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {node.approverEmail}
            </p>
          )}
        </Link>

        {/* Actions menu — min 44×44 touch area */}
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-11 w-11 p-0 shrink-0 -mr-2"
                aria-label="Ações do centro de custo"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Ações</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEdit(node)}>
                <Pencil className="mr-2 h-4 w-4" /> Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(node.id)}
                className="text-red-600 focus:text-red-700"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Recursive children */}
      {hasChildren &&
        expanded &&
        node.children.map((child) => (
          <MobileCostCenterCard
            key={child.id}
            node={child}
            level={level + 1}
            onEdit={onEdit}
            onDelete={onDelete}
            canManage={canManage}
            usages={usages}
          />
        ))}
    </>
  );
}

export default function CostCentersPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canManageCostCenters, onlyOwnPayables } = usePermissions();
  const { costCenters, usages, isLoading, fetchCostCenters } =
    useCostCenterStore();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadData = useCallback(
    async (forceRefresh = false) => {
      if (!selectedCompany) {
        return;
      }
      const forUserId = onlyOwnPayables ? user?.uid : undefined;
      await fetchCostCenters(selectedCompany.id, forUserId, forceRefresh);
    },
    [selectedCompany, onlyOwnPayables, user, fetchCostCenters],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (data: CostCenterFormData) => {
    if (!selectedCompany) return;
    try {
      setIsSubmitting(true);
      let ccId = editingId;

      if (editingId) {
        await costCenterService.update(editingId, data);
      } else {
        const ref = await costCenterService.create(data, selectedCompany.id);
        ccId = ref.id;
      }

      if (ccId && data.budget !== undefined && data.budgetYear) {
        await budgetService.setBudget(
          ccId,
          data.budgetYear,
          data.budget,
          selectedCompany.id,
        );
      }

      await loadData(true);
      setIsDialogOpen(false);
      setEditingId(null);
    } catch (error) {
      console.error("Error saving cost center:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const children = await costCenterService.getChildren(deleteId);
      if (children.length > 0) {
        toast.error(
          "Não é possível excluir: este centro de custo possui filhos. Remova-os primeiro.",
        );
        return;
      }
      await costCenterService.delete(deleteId);
      await loadData(true);
      toast.success("Centro de custo excluído com sucesso.");
    } catch (error) {
      console.error("Error deleting cost center:", error);
      toast.error("Erro ao excluir o centro de custo. Tente novamente.");
    } finally {
      setDeleteId(null);
    }
  };

  const handleEdit = (costCenter: CostCenter) => {
    setEditingId(costCenter.id);
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setEditingId(null);
    setIsDialogOpen(true);
  };

  const {
    items: sortedCostCenters,
    requestSort,
    sortConfig,
  } = useSortableData(costCenters);

  // KPI stats derivados do array já carregado
  const totalRoots = costCenters.filter(
    (cc) => !cc.parentId || cc.parentId === "none",
  ).length;
  const totalChildren = costCenters.length - totalRoots;
  const withoutBudget = costCenters.filter((cc) => !cc.budget).length;
  const totalBudget = costCenters.reduce(
    (acc, cc) => acc + (cc.budget || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Centros de Custo
          </h1>
          {!isLoading && costCenters.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <span className="font-medium text-foreground">
                  {totalRoots}
                </span>{" "}
                raiz
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {totalChildren}
                </span>{" "}
                {totalChildren === 1 ? "filho" : "filhos"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-sm text-muted-foreground">
                Total orçado:{" "}
                <span className="font-medium font-financial text-foreground">
                  {formatCurrency(totalBudget)}
                </span>
              </span>
              {withoutBudget > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <Badge
                    variant="outline"
                    className="text-[11px] text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20"
                  >
                    {withoutBudget} sem orçamento
                  </Badge>
                </>
              )}
            </div>
          )}
        </div>

        {canManageCostCenters && (
          <ResponsiveModal open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <ResponsiveModalTrigger asChild>
              <Button onClick={handleAddNew}>
                <Plus className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Novo Centro de Custo</span>
                <span className="sm:hidden">Novo</span>
              </Button>
            </ResponsiveModalTrigger>
            <ResponsiveModalContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
              <ResponsiveModalHeader>
                <ResponsiveModalTitle>
                  {editingId
                    ? "Editar Centro de Custo"
                    : "Novo Centro de Custo"}
                </ResponsiveModalTitle>
              </ResponsiveModalHeader>
              <CostCenterForm
                onSubmit={handleSubmit}
                isLoading={isSubmitting}
                onCancel={() => setIsDialogOpen(false)}
                availableCostCenters={costCenters}
                editingId={editingId}
                defaultValues={
                  editingId
                    ? (() => {
                        const cc = costCenters.find((c) => c.id === editingId);
                        if (!cc) return undefined;
                        return {
                          name: cc.name,
                          code: cc.code,
                          description: cc.description,
                          parentId: cc.parentId,
                          budget: cc.budget,
                          budgetYear: cc.budgetYear || new Date().getFullYear(),
                          allowedUserIds: cc.allowedUserIds,
                          approverEmail: cc.approverEmail,
                          releaserEmail: cc.releaserEmail,
                          budgetLimit: cc.budgetLimit,
                        };
                      })()
                    : undefined
                }
              />
            </ResponsiveModalContent>
          </ResponsiveModal>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gerenciamento</CardTitle>
          <CardDescription>
            Liste e gerencie os centros de custo da organização.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 md:p-6">
          {/* ── Desktop: table view ───────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto rounded-md border">
            <div className="min-w-[700px]">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 py-3 border-b bg-muted/50 font-medium text-sm items-center">
                <div
                  className="col-span-2 pl-4 cursor-pointer hover:text-primary flex items-center select-none"
                  onClick={() => requestSort("code")}
                >
                  Código
                  <SortIcon columnKey="code" sortConfig={sortConfig} />
                </div>
                <div
                  className="col-span-3 cursor-pointer hover:text-primary flex items-center select-none"
                  onClick={() => requestSort("name")}
                >
                  Nome
                  <SortIcon columnKey="name" sortConfig={sortConfig} />
                </div>
                <div
                  className="col-span-2 cursor-pointer hover:text-primary flex items-center select-none"
                  onClick={() => requestSort("budget")}
                >
                  Orçamento
                  <SortIcon columnKey="budget" sortConfig={sortConfig} />
                </div>
                <div
                  className="col-span-2 cursor-pointer hover:text-primary flex items-center select-none"
                  onClick={() => requestSort("approverEmail")}
                >
                  Aprovador
                  <SortIcon columnKey="approverEmail" sortConfig={sortConfig} />
                </div>
                <div
                  className="col-span-2 cursor-pointer hover:text-primary flex items-center select-none"
                  onClick={() => requestSort("releaserEmail")}
                >
                  Liberador
                  <SortIcon columnKey="releaserEmail" sortConfig={sortConfig} />
                </div>
                <div className="col-span-1 text-right pr-4">Ações</div>
              </div>

              {/* Body */}
              {isLoading ? (
                <TableSkeleton />
              ) : sortedCostCenters.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
                  <div className="rounded-full bg-muted p-4 mb-4">
                    <GitBranch className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold mb-1">
                    Nenhum centro de custo cadastrado
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-xs mb-4">
                    Crie centros de custo para organizar despesas por área,
                    projeto ou departamento.
                  </p>
                  {canManageCostCenters && (
                    <Button size="sm" onClick={handleAddNew}>
                      <Plus className="mr-2 h-4 w-4" />
                      Criar primeiro centro de custo
                    </Button>
                  )}
                </div>
              ) : (
                buildTree(sortedCostCenters).map((node, idx, arr) => (
                  <CostCenterRow
                    key={node.id}
                    node={node}
                    level={0}
                    isLast={idx === arr.length - 1}
                    onEdit={handleEdit}
                    onDelete={setDeleteId}
                    canManage={canManageCostCenters}
                    usages={usages}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Mobile: card list ─────────────────────────────────── */}
          <div className="md:hidden rounded-md border overflow-hidden">
            {isLoading ? (
              <MobileCardSkeleton />
            ) : sortedCostCenters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <GitBranch className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold mb-1">
                  Nenhum centro de custo cadastrado
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs mb-4">
                  Crie centros de custo para organizar despesas por área,
                  projeto ou departamento.
                </p>
                {canManageCostCenters && (
                  <Button size="sm" onClick={handleAddNew}>
                    <Plus className="mr-2 h-4 w-4" />
                    Criar primeiro centro de custo
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center px-4 py-2.5 border-b bg-muted/30">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {sortedCostCenters.length} centro
                    {sortedCostCenters.length !== 1 ? "s" : ""} de custo
                  </span>
                </div>
                <div className="divide-y">
                  {buildTree(sortedCostCenters).map((node) => (
                    <MobileCostCenterCard
                      key={node.id}
                      node={node}
                      level={0}
                      onEdit={handleEdit}
                      onDelete={setDeleteId}
                      canManage={canManageCostCenters}
                      usages={usages}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Excluir Centro de Custo"
        description="Tem certeza que deseja excluir este centro de custo? Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
