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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Users, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSortableData } from "@/hooks/useSortableData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";

const roleBadgeConfig: Record<
  UserRole,
  { label: string; className: string }
> = {
  admin: {
    label: "Administrador",
    className:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-800",
  },
  financial_manager: {
    label: "Gerente Financeiro",
    className:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800",
  },
  approver: {
    label: "Aprovador",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
  },
  releaser: {
    label: "Pagador/Baixador",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
  },
  auditor: {
    label: "Auditor",
    className:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800",
  },
  user: {
    label: "Usuário",
    className:
      "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700",
  },
};

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { selectedCompany } = useCompany();
  const router = useRouter();
  const { canManageUsers } = usePermissions();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUserToApprove, setSelectedUserToApprove] =
    useState<UserProfile | null>(null);
  const [approvalRole, setApprovalRole] =
    useState<UserRole>("financial_manager");
  const [rejectUserId, setRejectUserId] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  // Pre-select the user's requested role when opening approval dialog
  useEffect(() => {
    if (selectedUserToApprove?.pendingRole) {
      setApprovalRole(selectedUserToApprove.pendingRole);
    }
  }, [selectedUserToApprove]);

  useEffect(() => {
    if (!canManageUsers) {
      router.push("/dashboard");
    }
  }, [canManageUsers, router]);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const data = await userService.getAll(selectedCompany?.id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany]);

  const handleRoleUpdate = async (uid: string, newRole: UserRole | "none") => {
    if (!selectedCompany) return;
    if (!currentUser) return;
    const admin = { uid: currentUser.uid, email: currentUser.email ?? "" };
    try {
      if (newRole === "none") {
        await userService.revokeAccess(uid, selectedCompany.id, admin);
        setUsers(
          users.map((u) => {
            if (u.uid === uid) {
              const updatedRoles = { ...u.companyRoles };
              delete updatedRoles[selectedCompany.id];
              return { ...u, companyRoles: updatedRoles };
            }
            return u;
          }),
        );
        toast.success("Acesso revogado com sucesso!");
        return;
      }

      await userService.updateRole(
        uid,
        newRole as UserRole,
        admin,
        selectedCompany.id,
      );

      setUsers(
        users.map((u) => {
          if (u.uid === uid) {
            return {
              ...u,
              companyRoles: {
                ...u.companyRoles,
                [selectedCompany.id]: newRole as UserRole,
              },
            };
          }
          return u;
        }),
      );

      toast.success("Função do usuário atualizada!");
    } catch (error) {
      console.error("Error updating role:", error);
      toast.error("Erro ao atualizar função.");
    }
  };

  const handleApproveUser = async () => {
    if (!selectedUserToApprove || !selectedCompany) return;
    if (!currentUser) return;
    const admin = { uid: currentUser.uid, email: currentUser.email ?? "" };
    try {
      setIsApproving(true);

      await userService.updateStatus(
        selectedUserToApprove.uid,
        "active",
        admin,
      );

      const targetCompanyId =
        selectedUserToApprove.pendingCompanyId || selectedCompany.id;
      await userService.updateRole(
        selectedUserToApprove.uid,
        approvalRole,
        admin,
        targetCompanyId,
      );

      await userService.clearPendingAccess(selectedUserToApprove.uid);

      toast.success(
        `Usuário ${selectedUserToApprove.displayName} aprovado com sucesso!`,
      );
      setSelectedUserToApprove(null);
      fetchUsers();
    } catch (error) {
      console.error("Error approving user:", error);
      toast.error("Erro ao aprovar usuário.");
    } finally {
      setIsApproving(false);
    }
  };

  const handleRejectUser = async () => {
    if (!rejectUserId) return;
    if (!currentUser) return;
    const admin = { uid: currentUser.uid, email: currentUser.email ?? "" };
    try {
      await userService.updateStatus(rejectUserId, "rejected", admin);
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

  const getRoleForCompany = (user: UserProfile) => {
    if (!selectedCompany) return user.role;
    return user.companyRoles?.[selectedCompany.id] || "none";
  };

  const activeUsers = users.filter(
    (u) => u.status === "active" || (!u.status && u.active),
  );
  const pendingUsers = users.filter((u) => {
    const isPendingApproval = u.status === "pending_approval";
    const isOldPendingStatus = (u.status as string) === "pending";
    const isPendingCompanySetup = u.status === "pending_company_setup";

    if (isPendingApproval) {
      return !u.pendingCompanyId || u.pendingCompanyId === selectedCompany?.id;
    }

    if (isOldPendingStatus || isPendingCompanySetup) {
      return true;
    }

    return false;
  });

  const {
    items: sortedActiveUsers,
    requestSort,
    sortConfig,
  } = useSortableData(activeUsers);

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
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60">
            <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Gerenciamento de Usuários
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Empresa:{" "}
              <span className="font-semibold text-foreground">
                {selectedCompany?.name}
              </span>
              {" · "}
              <span>{activeUsers.length} ativo{activeUsers.length !== 1 ? "s" : ""}</span>
              {pendingUsers.length > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {pendingUsers.length} pendente{pendingUsers.length !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Pending alert callout */}
      {pendingUsers.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{pendingUsers.length}</strong> solicitaç{pendingUsers.length > 1 ? "ões" : "ão"} de acesso aguardando aprovação.
          </span>
        </div>
      )}

      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active" className="gap-2">
            Ativos
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums leading-none">
              {activeUsers.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            Pendentes
            {pendingUsers.length > 0 ? (
              <Badge className="h-5 min-w-5 px-1.5 text-xs bg-red-500 text-white">
                {pendingUsers.length}
              </Badge>
            ) : (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums leading-none">
                0
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <Card>
            <CardHeader>
              <CardTitle>Usuários Ativos</CardTitle>
              <CardDescription>Usuários com acesso ao sistema.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:text-primary"
                      onClick={() => requestSort("displayName")}
                    >
                      Usuário{" "}
                      {sortConfig?.key === "displayName" &&
                        (sortConfig.direction === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-primary"
                      onClick={() => requestSort("email")}
                    >
                      Email{" "}
                      {sortConfig?.key === "email" &&
                        (sortConfig.direction === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead>Função na Empresa</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedActiveUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                            <Users className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Nenhum usuário ativo nesta empresa.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedActiveUsers.map((user, idx) => {
                      const currentRole = getRoleForCompany(user);
                      const isCurrentUser = currentUser?.uid === user.uid;
                      const roleConfig = roleBadgeConfig[currentRole as UserRole];
                      return (
                        <TableRow
                          key={user.uid}
                          className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                          style={{
                            animationDelay: `${idx * 40}ms`,
                            animationFillMode: "both",
                          }}
                        >
                          <TableCell>
                            <Link
                              href={`/perfil/${user.uid}`}
                              className="flex items-center gap-3 hover:underline"
                            >
                              <div className="relative">
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={user.photoURL || ""} />
                                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                    {user.displayName
                                      ? getInitials(user.displayName)
                                      : "U"}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
                              </div>
                              <span className="font-medium">
                                {user.displayName}
                              </span>
                              {isCurrentUser && (
                                <Badge variant="secondary" className="text-xs">
                                  Você
                                </Badge>
                              )}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.email}
                          </TableCell>
                          <TableCell>
                            {currentRole === "none" ? (
                              <Badge variant="secondary" className="capitalize">
                                Sem Acesso
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-medium",
                                  roleConfig?.className,
                                )}
                              >
                                {roleConfig?.label ?? currentRole}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Select
                              value={currentRole}
                              onValueChange={(value) =>
                                handleRoleUpdate(user.uid, value as UserRole)
                              }
                              disabled={isCurrentUser}
                            >
                              <SelectTrigger className="w-[180px] ml-auto">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Sem Acesso</SelectItem>
                                <SelectItem value="admin">
                                  Administrador
                                </SelectItem>
                                <SelectItem value="financial_manager">
                                  Gerente Financeiro
                                </SelectItem>
                                <SelectItem value="approver">
                                  Aprovador
                                </SelectItem>
                                <SelectItem value="releaser">
                                  Pagador/Baixador
                                </SelectItem>
                                <SelectItem value="auditor">Auditor</SelectItem>
                                <SelectItem value="user">Usuário</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
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
                      <TableCell colSpan={5} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                            <Users className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Nenhuma solicitação pendente.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingUsers.map((user, idx) => (
                      <TableRow
                        key={user.uid}
                        className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                        style={{
                          animationDelay: `${idx * 40}ms`,
                          animationFillMode: "both",
                        }}
                      >
                        <TableCell className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={user.photoURL || ""} />
                              <AvatarFallback className="text-xs bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                                {user.displayName
                                  ? getInitials(user.displayName)
                                  : "U"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-card" />
                          </div>
                          <span className="font-medium">{user.displayName}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          {user.pendingRole ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-medium",
                                roleBadgeConfig[user.pendingRole]?.className,
                              )}
                            >
                              {roleBadgeConfig[user.pendingRole]?.label ??
                                user.pendingRole}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user.createdAt
                            ? new Date(user.createdAt).toLocaleDateString(
                                "pt-BR",
                              )
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setRejectUserId(user.uid)}
                            >
                              <XCircle className="h-4 w-4 mr-1" /> Rejeitar
                            </Button>

                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  size="sm"
                                  onClick={() => setSelectedUserToApprove(user)}
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />{" "}
                                  Aprovar
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Aprovar Usuário</DialogTitle>
                                  <DialogDescription>
                                    Defina a função inicial para{" "}
                                    <strong>{user.displayName}</strong> na
                                    empresa{" "}
                                    <strong>{selectedCompany?.name}</strong>.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="py-4">
                                  <Select
                                    value={approvalRole}
                                    onValueChange={(v) =>
                                      setApprovalRole(v as UserRole)
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Selecione uma função" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="admin">
                                        Administrador
                                      </SelectItem>
                                      <SelectItem value="financial_manager">
                                        Gerente Financeiro
                                      </SelectItem>
                                      <SelectItem value="approver">
                                        Aprovador
                                      </SelectItem>
                                      <SelectItem value="releaser">
                                        Pagador/Baixador
                                      </SelectItem>
                                      <SelectItem value="auditor">
                                        Auditor
                                      </SelectItem>
                                      <SelectItem value="user">
                                        Usuário
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <DialogFooter>
                                  <Button
                                    onClick={handleApproveUser}
                                    disabled={isApproving}
                                  >
                                    {isApproving && (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    Confirmar Aprovação
                                  </Button>
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
