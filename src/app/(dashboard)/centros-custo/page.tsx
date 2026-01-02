"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronRight,
  ChevronDown,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { budgetService } from "@/lib/services/budgetService";
import { CostCenterForm } from "@/components/features/finance/CostCenterForm";
import { CostCenterFormData } from "@/lib/validations/costCenter";

import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type CostCenterNode = CostCenter & { children: CostCenterNode[] };

function buildTree(items: CostCenter[]): CostCenterNode[] {
  const map = new Map<string, CostCenterNode>();
  const roots: CostCenterNode[] = [];

  // Initialize map
  items.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  // Build tree
  items.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parentId && item.parentId !== "none" && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

interface CostCenterRowProps {
  node: CostCenterNode;
  level: number;
  onEdit: (cc: CostCenter) => void;
  onDelete: (id: string) => void;
  canManage: boolean;
}

function CostCenterRow({
  node,
  level,
  onEdit,
  onDelete,
  canManage,
}: CostCenterRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="grid grid-cols-12 gap-4 py-3 border-b items-center hover:bg-muted/50 transition-colors text-sm">
        <div className="col-span-2 font-medium pl-4 truncate">
          <Link
            href={`/centros-custo/${node.id}`}
            className="hover:underline text-primary"
          >
            {node.code}
          </Link>
        </div>
        <div className="col-span-3 flex items-center gap-2">
          <div style={{ width: level * 24 }} className="flex-shrink-0" />
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 p-0 shrink-0"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-6 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          {node.budget ? (
            <>
              <span>
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(node.budget)}
              </span>
              {node.budgetYear && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-5">
                  {node.budgetYear}
                </Badge>
              )}
            </>
          ) : (
            "-"
          )}
        </div>
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
            <div className="flex justify-end gap-1">
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
        {node.children.map((child) => (
          <CostCenterRow
            key={child.id}
            node={child}
            level={level + 1}
            onEdit={onEdit}
            onDelete={onDelete}
            canManage={canManage}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function CostCentersPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canManageCostCenters, onlyOwnPayables } = usePermissions();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchCostCenters = useCallback(async () => {
    if (!selectedCompany) return;
    try {
      // For 'user' role, pass forUserId to filter only their allowed cost centers
      const forUserId = onlyOwnPayables ? user?.uid : undefined;
      const data = await costCenterService.getAll(
        selectedCompany.id,
        forUserId
      );
      setCostCenters(data);
    } catch (error) {
      console.error("Error fetching cost centers:", error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, onlyOwnPayables, user]);

  useEffect(() => {
    fetchCostCenters();
  }, [fetchCostCenters]);

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

      // Save Annual Budget
      if (ccId && data.budget !== undefined && data.budgetYear) {
        await budgetService.setBudget(ccId, data.budgetYear, data.budget);
      }

      await fetchCostCenters();
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
      await costCenterService.delete(deleteId);
      await fetchCostCenters();
    } catch (error) {
      console.error("Error deleting cost center:", error);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Centros de Custo</h1>
        {canManageCostCenters && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleAddNew}>
                <Plus className="mr-2 h-4 w-4" />
                Novo Centro de Custo
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingId
                    ? "Editar Centro de Custo"
                    : "Novo Centro de Custo"}
                </DialogTitle>
              </DialogHeader>
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
                          budgetYear: new Date().getFullYear(),
                          allowedUserIds: cc.allowedUserIds,
                          approverEmail: cc.approverEmail,
                          releaserEmail: cc.releaserEmail,
                          budgetLimit: cc.budgetLimit,
                        };
                      })()
                    : undefined
                }
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gerenciamento</CardTitle>
          <CardDescription>
            Liste e gerencie os centros de custo da organização.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-md border">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 py-3 border-b bg-muted/50 font-medium text-sm items-center">
                <div
                  className="col-span-2 pl-4 cursor-pointer hover:text-primary flex items-center"
                  onClick={() => requestSort("code")}
                >
                  Código{" "}
                  {sortConfig?.key === "code" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </div>
                <div
                  className="col-span-3 cursor-pointer hover:text-primary flex items-center"
                  onClick={() => requestSort("name")}
                >
                  Nome{" "}
                  {sortConfig?.key === "name" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </div>
                <div
                  className="col-span-2 cursor-pointer hover:text-primary flex items-center"
                  onClick={() => requestSort("budget")}
                >
                  Orçamento{" "}
                  {sortConfig?.key === "budget" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </div>
                <div
                  className="col-span-2 cursor-pointer hover:text-primary flex items-center"
                  onClick={() => requestSort("approverEmail")}
                >
                  Aprovador{" "}
                  {sortConfig?.key === "approverEmail" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </div>
                <div
                  className="col-span-2 cursor-pointer hover:text-primary flex items-center"
                  onClick={() => requestSort("releaserEmail")}
                >
                  Liberador{" "}
                  {sortConfig?.key === "releaserEmail" &&
                    (sortConfig.direction === "asc" ? "↑" : "↓")}
                </div>
                <div className="col-span-1 text-right pr-4">Ações</div>
              </div>

              {/* Body */}
              {sortedCostCenters.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Nenhum centro de custo cadastrado.
                </div>
              ) : (
                buildTree(sortedCostCenters).map((node) => (
                  <CostCenterRow
                    key={node.id}
                    node={node}
                    level={0}
                    onEdit={handleEdit}
                    onDelete={setDeleteId}
                    canManage={canManageCostCenters}
                  />
                ))
              )}
            </div>
          )}
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
