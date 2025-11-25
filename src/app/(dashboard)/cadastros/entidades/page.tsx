"use client";

import { useEffect, useState } from "react";
import { entityService } from "@/lib/services/entityService";
import { Entity } from "@/lib/types";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Users, Building2, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EntityForm } from "@/components/features/entities/EntityForm";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function EntitiesPage() {
    const { selectedCompany } = useCompany();
    const [entities, setEntities] = useState<Entity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
    const [activeTab, setActiveTab] = useState<string>("all");

    const fetchEntities = async () => {
        if (!selectedCompany) return;
        setIsLoading(true);
        try {
            const category = activeTab === 'all' ? undefined : activeTab as 'supplier' | 'client';
            const data = await entityService.getAll(selectedCompany.id, category);
            setEntities(data);
        } catch (error) {
            console.error("Error fetching entities:", error);
            toast.error("Erro ao carregar entidades.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchEntities();
    }, [selectedCompany, activeTab]);

    const handleCreate = async (data: any) => {
        if (!selectedCompany) return;
        try {
            await entityService.create({ ...data, companyId: selectedCompany.id });
            toast.success("Entidade criada com sucesso!");
            setIsDialogOpen(false);
            fetchEntities();
        } catch (error) {
            console.error("Error creating entity:", error);
            toast.error("Erro ao criar entidade.");
        }
    };

    const handleUpdate = async (data: any) => {
        if (!selectedEntity) return;
        try {
            await entityService.update(selectedEntity.id, data);
            toast.success("Entidade atualizada com sucesso!");
            setIsDialogOpen(false);
            setSelectedEntity(null);
            fetchEntities();
        } catch (error) {
            console.error("Error updating entity:", error);
            toast.error("Erro ao atualizar entidade.");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Tem certeza que deseja excluir esta entidade?")) return;
        try {
            await entityService.delete(id);
            toast.success("Entidade excluída com sucesso!");
            fetchEntities();
        } catch (error) {
            console.error("Error deleting entity:", error);
            toast.error("Erro ao excluir entidade.");
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

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Cadastros</h1>
                    <p className="text-muted-foreground">
                        Gerencie fornecedores e clientes.
                    </p>
                </div>
                <Button onClick={openCreateDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Nova Entidade
                </Button>
            </div>

            <Tabs defaultValue="all" onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="all">Todos</TabsTrigger>
                    <TabsTrigger value="supplier">Fornecedores</TabsTrigger>
                    <TabsTrigger value="client">Clientes</TabsTrigger>
                </TabsList>

                <Card>
                    <CardHeader>
                        <CardTitle>Entidades</CardTitle>
                        <CardDescription>
                            Lista de pessoas e empresas cadastradas.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex justify-center items-center h-32">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nome</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Categoria</TableHead>
                                        <TableHead>Documento</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {entities.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground">
                                                Nenhuma entidade encontrada.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        entities.map((entity) => (
                                            <TableRow key={entity.id}>
                                                <TableCell className="font-medium flex items-center gap-2">
                                                    {entity.type === 'company' ? (
                                                        <Building2 className="h-4 w-4 text-muted-foreground" />
                                                    ) : (
                                                        <User className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                    {entity.name}
                                                </TableCell>
                                                <TableCell>
                                                    {entity.type === 'company' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                                                </TableCell>
                                                <TableCell>
                                                    {entity.category === 'supplier' && 'Fornecedor'}
                                                    {entity.category === 'client' && 'Cliente'}
                                                    {entity.category === 'both' && 'Ambos'}
                                                </TableCell>
                                                <TableCell>{entity.document || "-"}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(entity)}>
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(entity.id)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </Tabs>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{selectedEntity ? "Editar Entidade" : "Nova Entidade"}</DialogTitle>
                        <DialogDescription>
                            {selectedEntity ? "Atualize os dados da entidade." : "Preencha os dados para criar um novo fornecedor ou cliente."}
                        </DialogDescription>
                    </DialogHeader>
                    <EntityForm
                        defaultValues={selectedEntity || {}}
                        onSubmit={selectedEntity ? handleUpdate : handleCreate}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
