"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { CostCenter } from "@/lib/types";
import { costCenterService, getHierarchicalCostCenters } from "@/lib/services/costCenterService";
import { budgetService } from "@/lib/services/budgetService";
import { CostCenterForm } from "@/components/features/finance/CostCenterForm";
import { CostCenterFormData } from "@/lib/validations/costCenter";

import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useSortableData } from "@/hooks/useSortableData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function CostCentersPage() {
    const { selectedCompany } = useCompany();
    const { canManageCostCenters } = usePermissions();
    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);

    const fetchCostCenters = async () => {
        if (!selectedCompany) return;
        try {
            const data = await costCenterService.getAll(selectedCompany.id);
            setCostCenters(data);
        } catch (error) {
            console.error("Error fetching cost centers:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCostCenters();
    }, [selectedCompany]);

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

    const { items: sortedCostCenters, requestSort, sortConfig } = useSortableData(costCenters);

    const hierarchicalCostCenters = getHierarchicalCostCenters(sortedCostCenters);

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
                                    {editingId ? "Editar Centro de Custo" : "Novo Centro de Custo"}
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
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('code')}
                                    >
                                        Código {sortConfig?.key === 'code' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('name')}
                                    >
                                        Nome {sortConfig?.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('budget')}
                                    >
                                        Orçamento {sortConfig?.key === 'budget' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('approverEmail')}
                                    >
                                        Aprovador {sortConfig?.key === 'approverEmail' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead
                                        className="cursor-pointer hover:text-primary"
                                        onClick={() => requestSort('releaserEmail')}
                                    >
                                        Liberador {sortConfig?.key === 'releaserEmail' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                    </TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {hierarchicalCostCenters.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            Nenhum centro de custo cadastrado.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    hierarchicalCostCenters.map((cc) => (
                                        <TableRow key={cc.id}>
                                            <TableCell className="font-medium">
                                                <Link href={`/centros-custo/${cc.id}`} className="hover:underline text-primary">
                                                    {cc.code}
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                <div style={{ paddingLeft: `${cc.level * 20}px` }} className="flex items-center">
                                                    {cc.level > 0 && <span className="mr-2 text-muted-foreground">↳</span>}
                                                    {cc.name}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {cc.budget
                                                    ? new Intl.NumberFormat("pt-BR", {
                                                        style: "currency",
                                                        currency: "BRL",
                                                    }).format(cc.budget)
                                                    : "-"}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {cc.approverEmail || "-"}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {cc.releaserEmail || "-"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {canManageCostCenters && (
                                                    <>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleEdit(cc)}
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="text-red-500 hover:text-red-600"
                                                            onClick={() => setDeleteId(cc.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
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
        </div >
    );
}
