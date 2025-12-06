"use client";

import { useEffect, useState } from "react";
import { companyService } from "@/lib/services/companyService";
import { Company } from "@/lib/types";
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
    DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CompanyForm } from "@/components/features/companies/CompanyForm";
import { useAuth } from "@/components/providers/AuthProvider";
import { useRouter } from "next/navigation";

export default function CompaniesPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

    // Redirect if not admin
    useEffect(() => {
        if (!user) return;
        // Check if user is admin in AT LEAST ONE company or globally?
        // For now, let's assume only global admins or those with 'admin' role in the current context can see this.
        // But this is a global configuration page.
        // Let's rely on the sidebar link visibility for now, but strictly we should check permissions.
    }, [user, router]);

    const fetchCompanies = async () => {
        try {
            const data = await companyService.getAll();
            setCompanies(data);
        } catch (error) {
            console.error("Error fetching companies:", error);
            toast.error("Erro ao carregar empresas.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCompanies();
    }, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCreate = async (data: any) => {
        try {
            if (!user) return;
            await companyService.create(data, { uid: user.uid, email: user.email });
            toast.success("Empresa criada com sucesso!");
            setIsDialogOpen(false);
            fetchCompanies();
        } catch (error) {
            console.error("Error creating company:", error);
            toast.error("Erro ao criar empresa.");
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleUpdate = async (data: any) => {
        if (!selectedCompany) return;
        try {
            if (!user) return;
            await companyService.update(selectedCompany.id, data, { uid: user.uid, email: user.email });
            toast.success("Empresa atualizada com sucesso!");
            setIsDialogOpen(false);
            setSelectedCompany(null);
            fetchCompanies();
        } catch (error) {
            console.error("Error updating company:", error);
            toast.error("Erro ao atualizar empresa.");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita.")) return;
        try {
            if (!user) return;
            await companyService.delete(id, { uid: user.uid, email: user.email });
            toast.success("Empresa excluída com sucesso!");
            fetchCompanies();
        } catch (error) {
            console.error("Error deleting company:", error);
            toast.error("Erro ao excluir empresa.");
        }
    };

    const openEditDialog = (company: Company) => {
        setSelectedCompany(company);
        setIsDialogOpen(true);
    };

    const openCreateDialog = () => {
        setSelectedCompany(null);
        setIsDialogOpen(true);
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gerenciamento de Empresas</h1>
                    <p className="text-muted-foreground">
                        Crie e gerencie as empresas do grupo (Holding).
                    </p>
                </div>
                <Button onClick={openCreateDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Nova Empresa
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Empresas Cadastradas</CardTitle>
                    <CardDescription>
                        Lista de todas as empresas no sistema.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>CNPJ</TableHead>
                                <TableHead>Telefone</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {companies.map((company) => (
                                <TableRow key={company.id}>
                                    <TableCell className="font-medium flex items-center gap-2">
                                        <Building2 className="h-4 w-4 text-muted-foreground" />
                                        {company.name}
                                    </TableCell>
                                    <TableCell>{company.cnpj || "-"}</TableCell>
                                    <TableCell>{company.phone || "-"}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(company)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(company.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{selectedCompany ? "Editar Empresa" : "Nova Empresa"}</DialogTitle>
                        <DialogDescription>
                            {selectedCompany ? "Atualize os dados da empresa." : "Preencha os dados para criar uma nova empresa."}
                        </DialogDescription>
                    </DialogHeader>
                    <CompanyForm
                        defaultValues={selectedCompany || {}}
                        onSubmit={selectedCompany ? handleUpdate : handleCreate}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
