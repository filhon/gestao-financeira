"use client";

import { useEffect, useState } from "react";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";

export default function UsersPage() {
    const { user: currentUser } = useAuth();
    const { selectedCompany } = useCompany();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
            // If "none", we might want to remove the role, but for now let's just assume valid roles.
            // Or we can handle "none" by removing the key from the map (not implemented in service yet).
            // Let's stick to valid roles for now.
            if (newRole === "none") return; // TODO: Implement remove role

            await userService.updateRole(uid, newRole as UserRole, selectedCompany.id);

            // Update local state
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
        auditor: "Auditor"
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-96">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const getRoleForCompany = (user: UserProfile) => {
        if (!selectedCompany) return user.role; // Fallback to legacy
        return user.companyRoles?.[selectedCompany.id] || "none";
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Gerenciamento de Usuários</h1>
                <p className="text-muted-foreground">
                    Gerencie os acessos para a empresa: <span className="font-semibold text-foreground">{selectedCompany?.name}</span>
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Usuários Cadastrados</CardTitle>
                    <CardDescription>
                        Lista de todos os usuários com acesso ao sistema.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Usuário</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Função na Empresa</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((user) => {
                                const currentRole = getRoleForCompany(user);
                                return (
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
                                            <Badge variant={currentRole === "none" ? "secondary" : "outline"} className="capitalize">
                                                {currentRole === "none" ? "Sem Acesso" : (roleLabels[currentRole as UserRole] || currentRole)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Select
                                                value={currentRole}
                                                onValueChange={(value) => handleRoleUpdate(user.uid, value as UserRole)}
                                                disabled={currentUser?.uid === user.uid} // Prevent self-lockout
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
        </div>
    );
}
