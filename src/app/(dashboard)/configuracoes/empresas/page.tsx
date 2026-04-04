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
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Pencil, Trash2, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CompanyForm } from "@/components/features/companies/CompanyForm";
import { useAuth } from "@/components/providers/AuthProvider";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import Image from "next/image";

export default function CompaniesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { canManageCompanies } = usePermissions();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (user && !canManageCompanies) {
      router.push("/dashboard");
    }
  }, [user, canManageCompanies, router]);

  const fetchCompanies = async () => {
    try {
      setIsLoading(true);
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
    if (!user) return;
    const admin = { uid: user.uid, email: user.email ?? "" };
    try {
      setIsSubmitting(true);
      await companyService.create(data, admin);
      toast.success("Empresa criada com sucesso!");
      setIsDialogOpen(false);
      fetchCompanies();
    } catch (error) {
      console.error("Error creating company:", error);
      toast.error("Erro ao criar empresa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdate = async (data: any) => {
    if (!selectedCompany || !user) return;
    const admin = { uid: user.uid, email: user.email ?? "" };
    try {
      setIsSubmitting(true);
      await companyService.update(selectedCompany.id, data, admin);
      toast.success("Empresa atualizada com sucesso!");
      setIsDialogOpen(false);
      setSelectedCompany(null);
      fetchCompanies();
    } catch (error) {
      console.error("Error updating company:", error);
      toast.error("Erro ao atualizar empresa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || !user) return;
    const admin = { uid: user.uid, email: user.email ?? "" };
    try {
      await companyService.delete(deleteId, admin);
      toast.success("Empresa excluída com sucesso!");
      fetchCompanies();
    } catch (error) {
      console.error("Error deleting company:", error);
      toast.error("Erro ao excluir empresa.");
    } finally {
      setDeleteId(null);
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

  if (!canManageCompanies) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950/60">
            <Building2 className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Gerenciamento de Empresas
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Crie e gerencie as empresas do grupo (Holding).
              {companies.length > 0 && (
                <>
                  {" · "}
                  <span>
                    {companies.length} empresa
                    {companies.length !== 1 ? "s" : ""} cadastrada
                    {companies.length !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </p>
          </div>
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
                <TableHead>Empresa</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Building2 className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          Nenhuma empresa cadastrada
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Clique em &quot;Nova Empresa&quot; para começar.
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((company, idx) => (
                  <TableRow
                    key={company.id}
                    className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                    style={{
                      animationDelay: `${idx * 40}ms`,
                      animationFillMode: "both",
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {company.logoUrl ? (
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border bg-white">
                            <Image
                              src={company.logoUrl}
                              alt={`Logo ${company.name}`}
                              width={32}
                              height={32}
                              unoptimized
                              className="h-full w-full object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display =
                                  "none";
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-50 dark:bg-violet-950/60">
                            <Building2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          </div>
                        )}
                        <span className="font-medium">{company.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">
                      {company.cnpj || (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.phone || (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-[200px] truncate"
                      title={company.address}
                    >
                      {company.address || (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditDialog(company)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                          onClick={() => setDeleteId(company.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[50vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedCompany ? "Editar Empresa" : "Nova Empresa"}
            </DialogTitle>
            <DialogDescription>
              {selectedCompany
                ? "Atualize os dados da empresa."
                : "Preencha os dados para criar uma nova empresa."}
            </DialogDescription>
          </DialogHeader>
          <CompanyForm
            defaultValues={selectedCompany || {}}
            onSubmit={selectedCompany ? handleUpdate : handleCreate}
            isLoading={isSubmitting}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Excluir Empresa"
        description="Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
