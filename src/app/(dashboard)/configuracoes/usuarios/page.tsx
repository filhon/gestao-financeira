"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { userService } from "@/lib/services/userService";
import { UserProfile, UserRole } from "@/lib/types";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useSortableData } from "@/hooks/useSortableData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";

export default function UsersPage() {
    const { user: currentUser } = useAuth();
    const { selectedCompany } = useCompany();
    const router = useRouter();
    const { canManageUsers } = usePermissions();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedUserToApprove, setSelectedUserToApprove] = useState<UserProfile | null>(null);
    const [approvalRole, setApprovalRole] = useState<UserRole>("financial_manager");
    const [rejectUserId, setRejectUserId] = useState<string | null>(null);

    // Pre-select the user's requested role when opening approval dialog
    useEffect(() => {
        if (selectedUserToApprove?.pendingRole) {
            setApprovalRole(selectedUserToApprove.pendingRole);
        }
    }, [selectedUserToApprove]);

    useEffect(() => {
        if (!canManageUsers) {
            router.push("/");
        }
    }, [canManageUsers, router]);

    // Validating permissions...

    const fetchUsers = async () => {
        try {
            const data = await userService.getAll();
            setUsers(data);
        } catch (error) {
            console.error("Error fetching users:", error);
            toast.error("Erro ao carregar usuários.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleRoleUpdate = async (uid: string, newRole: UserRole | "none") => {
        if (!selectedCompany) return;
        try {
            if (newRole === "none") return;
            if (!currentUser) return;

            await userService.updateRole(uid, newRole as UserRole, { uid: currentUser.uid, email: currentUser.email }, selectedCompany.id);

            setUsers(users.map(u => {
                if (u.uid === uid) {
                    return {
                        ...u,
                        companyRoles: {
                            ...u.companyRoles,
                            [selectedCompany.id]: newRole as UserRole
                        }
                    };
                }
                return u;
            }));

            toast.success("Função do usuário atualizada!");
        } catch (error) {
            console.error("Error updating role:", error);
            toast.error("Erro ao atualizar função.");
        }
    };

    const handleApproveUser = async () => {
        if (!selectedUserToApprove || !selectedCompany) return;
        try {
            if (!currentUser) return;

            // 1. Update Status
            await userService.updateStatus(selectedUserToApprove.uid, 'active', { uid: currentUser.uid, email: currentUser.email });

            // 2. Assign Role - use the company that the user requested if it matches, otherwise current selected company
            const targetCompanyId = selectedUserToApprove.pendingCompanyId || selectedCompany.id;
            await userService.updateRole(selectedUserToApprove.uid, approvalRole, { uid: currentUser.uid, email: currentUser.email }, targetCompanyId);

            // 3. Clear pending access fields
            await userService.clearPendingAccess(selectedUserToApprove.uid);

            toast.success(`Usuário ${selectedUserToApprove.displayName} aprovado com sucesso!`);
            setSelectedUserToApprove(null);
            fetchUsers();
        } catch (error) {
            console.error("Error approving user:", error);
            toast.error("Erro ao aprovar usuário.");
        }
    };

    const handleRejectUser = async () => {
        if (!rejectUserId) return;
        if (!currentUser) return;
        try {
            await userService.updateStatus(rejectUserId, 'rejected', { uid: currentUser.uid, email: currentUser.email });
            toast.success("Usuário rejeitado.");
            fetchUsers();
        } catch (error) {
            console.error("Error rejecting user:", error);
            toast.error("Erro ao rejeitar usuário.");
        } finally {
            setRejectUserId(null);
        }
    };

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .substring(0, 2);
    };

    const roleLabels: Record<UserRole, string> = {
        admin: "Administrador",
        financial_manager: "Gerente Financeiro",
        approver: "Aprovador",
        releaser: "Pagador/Baixador",
        auditor: "Auditor",
        user: "Usuário"
    };

    const getRoleForCompany = (user: UserProfile) => {
        if (!selectedCompany) return user.role;
        return user.companyRoles?.[selectedCompany.id] || "none";
    };

    const activeUsers = users.filter(u => u.status === 'active' || (!u.status && u.active)); // Backward compat
    // Filter pending users: those who requested access to the current company OR old 'pending' status users
    const pendingUsers = users.filter(u => {
        const isPendingApproval = u.status === 'pending_approval';
        const isOldPendingStatus = (u.status as string) === 'pending';
        const isPendingCompanySetup = u.status === 'pending_company_setup';
        
        // Include if pending_approval and matches current company (or has no pending company)
        if (isPendingApproval) {
            return !u.pendingCompanyId || u.pendingCompanyId === selectedCompany?.id;
        }
        
        // Include old pending status users for backward compatibility
        if (isOldPendingStatus || isPendingCompanySetup) {
            return true;
        }
        
        return false;
    });

    const { items: sortedActiveUsers, requestSort, sortConfig } = useSortableData(activeUsers);

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!canManageUsers) return null;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Gerenciamento de Usuários</h1>
                <p className="text-muted-foreground">
                    Gerencie os acessos para a empresa: <span className="font-semibold text-foreground">{selectedCompany?.name}</span>
                </p>
            </div>

            <Tabs defaultValue="active" className="w-full">
                <TabsList>
                    <TabsTrigger value="active">Ativos ({activeUsers.length})</TabsTrigger>
                    <TabsTrigger value="pending">Pendentes ({pendingUsers.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="active">
                    <Card>
                        <CardHeader>
                            <CardTitle>Usuários Ativos</CardTitle>
                            <CardDescription>
                                Usuários com acesso ao sistema.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead
                                            className="cursor-pointer hover:text-primary"
                                            onClick={() => requestSort('displayName')}
                                        >
                                            Usuário {sortConfig?.key === 'displayName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </TableHead>
                                        <TableHead
                                            className="cursor-pointer hover:text-primary"
                                            onClick={() => requestSort('email')}
                                        >
                                            Email {sortConfig?.key === 'email' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </TableHead>
                                        <TableHead>Função na Empresa</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedActiveUsers.map((user) => {
                                        const currentRole = getRoleForCompany(user);
                                        return (
                                            <TableRow key={user.uid}>
                                                <TableCell>
                                                    <Link href={`/perfil/${user.uid}`} className="flex items-center gap-3 hover:underline">
                                                        <Avatar>
                                                            <AvatarImage src={user.photoURL || ""} />
                                                            <AvatarFallback>{user.displayName ? getInitials(user.displayName) : "U"}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="font-medium">{user.displayName}</span>
                                                    </Link>
                                                </TableCell>
                                                <TableCell>{user.email}</TableCell>
                                                <TableCell>
                                                    <Badge variant={currentRole === "none" ? "secondary" : "outline"} className="capitalize">
                                                        {currentRole === "none" ? "Sem Acesso" : (roleLabels[currentRole as UserRole] || currentRole)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Select
                                                        value={currentRole}
                                                        onValueChange={(value) => handleRoleUpdate(user.uid, value as UserRole)}
                                                        disabled={currentUser?.uid === user.uid}
                                                    >
                                                        <SelectTrigger className="w-[180px] ml-auto">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="none">Sem Acesso</SelectItem>
                                                            <SelectItem value="admin">Administrador</SelectItem>
                                                            <SelectItem value="financial_manager">Gerente Financeiro</SelectItem>
                                                            <SelectItem value="approver">Aprovador</SelectItem>
                                                            <SelectItem value="releaser">Pagador/Baixador</SelectItem>
                                                            <SelectItem value="auditor">Auditor</SelectItem>
                                                            <SelectItem value="user">Usuário</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="pending">
                    <Card>
                        <CardHeader>
                            <CardTitle>Solicitações Pendentes</CardTitle>
                            <CardDescription>
                                Usuários aguardando aprovação para acessar o sistema.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Usuário</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Função Solicitada</TableHead>
                                        <TableHead>Data de Cadastro</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pendingUsers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                                Nenhuma solicitação pendente.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        pendingUsers.map((user) => (
                                            <TableRow key={user.uid}>
                                                <TableCell className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={user.photoURL || ""} />
                                                        <AvatarFallback>{user.displayName ? getInitials(user.displayName) : "U"}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="font-medium">{user.displayName}</span>
                                                </TableCell>
                                                <TableCell>{user.email}</TableCell>
                                                <TableCell>
                                                    {user.pendingRole ? (
                                                        <Badge variant="outline">{roleLabels[user.pendingRole] || user.pendingRole}</Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => setRejectUserId(user.uid)}>
                                                            <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                                                        </Button>

                                                        <Dialog>
                                                            <DialogTrigger asChild>
                                                                <Button size="sm" onClick={() => setSelectedUserToApprove(user)}>
                                                                    <CheckCircle className="h-4 w-4 mr-1" /> Aprovar
                                                                </Button>
                                                            </DialogTrigger>
                                                            <DialogContent>
                                                                <DialogHeader>
                                                                    <DialogTitle>Aprovar Usuário</DialogTitle>
                                                                    <DialogDescription>
                                                                        Defina a função inicial para <strong>{user.displayName}</strong> na empresa <strong>{selectedCompany?.name}</strong>.
                                                                    </DialogDescription>
                                                                </DialogHeader>
                                                                <div className="py-4">
                                                                    <Select value={approvalRole} onValueChange={(v) => setApprovalRole(v as UserRole)}>
                                                                        <SelectTrigger>
                                                                            <SelectValue placeholder="Selecione uma função" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="admin">Administrador</SelectItem>
                                                                            <SelectItem value="financial_manager">Gerente Financeiro</SelectItem>
                                                                            <SelectItem value="approver">Aprovador</SelectItem>
                                                                            <SelectItem value="releaser">Pagador/Baixador</SelectItem>
                                                                            <SelectItem value="auditor">Auditor</SelectItem>
                                                                            <SelectItem value="user">Usuário</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <DialogFooter>
                                                                    <Button onClick={handleApproveUser}>Confirmar Aprovação</Button>
                                                                </DialogFooter>
                                                            </DialogContent>
                                                        </Dialog>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <ConfirmDialog
                open={!!rejectUserId}
                onOpenChange={(open) => !open && setRejectUserId(null)}
                title="Rejeitar Usuário"
                description="Tem certeza que deseja rejeitar este usuário? Ele não terá acesso ao sistema."
                confirmText="Rejeitar"
                variant="destructive"
                onConfirm={handleRejectUser}
            />
        </div>
    );
}
