"use client";

import { useEffect, useState, useCallback } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { notificationService } from "@/lib/services/notificationService";
import { emailService } from "@/lib/services/emailService";
import { PaymentBatch } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Plus, MoreHorizontal, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BatchDetailsDialog } from "@/components/features/finance/BatchDetailsDialog";
import { BatchSendDialog } from "@/components/features/finance/BatchSendDialog";
import { BatchApprovalDialog } from "@/components/features/finance/BatchApprovalDialog";

import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";

export default function PaymentBatchesPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const router = useRouter();
  const { canViewBatches, canManageBatches, canApproveBatches, canPayBatches } =
    usePermissions();

  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");

  const [selectedBatch, setSelectedBatch] = useState<PaymentBatch | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // New workflow dialogs
  const [isSendForApprovalOpen, setIsSendForApprovalOpen] = useState(false);
  const [isSendForAuthorizationOpen, setIsSendForAuthorizationOpen] =
    useState(false);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [actionBatch, setActionBatch] = useState<PaymentBatch | null>(null);

  // Guard: redirect if no permission
  useEffect(() => {
    if (!canViewBatches) {
      router.push("/");
    }
  }, [canViewBatches, router]);

  const fetchBatches = useCallback(async () => {
    if (!selectedCompany || !canViewBatches) return;
    try {
      setIsLoading(true);
      const data = await paymentBatchService.getAll(selectedCompany.id);
      setBatches(data);
    } catch (error) {
      console.error("Error fetching batches:", error);
      toast.error("Erro ao carregar lotes");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, canViewBatches]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  if (!canViewBatches) return null;

  const handleCreateBatch = async () => {
    if (!selectedCompany || !user || !newBatchName.trim()) return;
    try {
      await paymentBatchService.create(
        newBatchName,
        selectedCompany.id,
        user.uid
      );
      toast.success("Lote criado com sucesso");
      setIsCreateOpen(false);
      setNewBatchName("");
      fetchBatches();
    } catch (error) {
      console.error("Error creating batch:", error);
      toast.error("Erro ao criar lote");
    }
  };

  const handleViewDetails = (batch: PaymentBatch) => {
    setSelectedBatch(batch);
    setIsDetailsOpen(true);
  };

  // Open send for approval dialog
  const handleOpenSendForApproval = (batch: PaymentBatch) => {
    setActionBatch(batch);
    setIsSendForApprovalOpen(true);
  };

  // Send batch for approval
  const handleSendForApproval = async (
    approverId: string,
    approverEmail: string,
    approverName: string
  ) => {
    if (!actionBatch || !user || !selectedCompany) return;
    try {
      // Generate token and update batch
      const token = await paymentBatchService.sendForApproval(
        actionBatch.id,
        approverId,
        approverEmail
      );

      // Send email with Magic Link
      await emailService.sendBatchApprovalRequest(
        actionBatch.name,
        actionBatch.id,
        token,
        actionBatch.transactionIds.length,
        actionBatch.totalAmount,
        user.displayName,
        approverEmail
      );

      // Also send in-app notification
      await notificationService.notifyBatchForApproval(
        approverId,
        actionBatch.name,
        actionBatch.id,
        user.displayName,
        selectedCompany.id
      );
      toast.success(`Lote enviado para ${approverName} (email enviado)`);
      fetchBatches();
    } catch (error) {
      console.error("Error sending for approval:", error);
      toast.error("Erro ao enviar para aprovação");
      throw error;
    }
  };

  // Open approval dialog
  const handleOpenApproval = (batch: PaymentBatch) => {
    setActionBatch(batch);
    setIsApprovalOpen(true);
  };

  // After approval complete
  const handleApprovalComplete = async () => {
    if (!actionBatch || !selectedCompany || !user) return;
    try {
      // Notify the batch creator (manager)
      await notificationService.notifyBatchApproved(
        actionBatch.createdBy,
        actionBatch.name,
        actionBatch.id,
        user.displayName,
        selectedCompany.id
      );
      fetchBatches();
    } catch (error) {
      console.error("Error notifying after approval:", error);
    }
  };

  // Open send for authorization dialog
  const handleOpenSendForAuthorization = (batch: PaymentBatch) => {
    setActionBatch(batch);
    setIsSendForAuthorizationOpen(true);
  };

  // Send batch for authorization
  const handleSendForAuthorization = async (
    authorizerId: string,
    authorizerEmail: string,
    authorizerName: string
  ) => {
    if (!actionBatch || !user || !selectedCompany) return;
    try {
      // Generate token and update batch
      const token = await paymentBatchService.sendForAuthorization(
        actionBatch.id,
        authorizerId,
        authorizerEmail
      );

      // Send email with Magic Link
      await emailService.sendBatchAuthorizationRequest(
        actionBatch.name,
        actionBatch.id,
        token,
        actionBatch.transactionIds.length,
        actionBatch.totalAmount,
        user.displayName,
        authorizerEmail
      );

      // Also send in-app notification
      await notificationService.notifyBatchForAuthorization(
        authorizerId,
        actionBatch.name,
        actionBatch.id,
        user.displayName,
        selectedCompany.id
      );
      toast.success(`Lote enviado para ${authorizerName} (email enviado)`);
      fetchBatches();
    } catch (error) {
      console.error("Error sending for authorization:", error);
      toast.error("Erro ao enviar para autorização");
      throw error;
    }
  };

  // Confirm authorization (releaser action)
  const handleConfirmAuthorization = async (batch: PaymentBatch) => {
    if (!user || !selectedCompany) return;
    try {
      await paymentBatchService.confirmAuthorization(batch.id, user.uid);
      await notificationService.notifyBatchAuthorized(
        batch.createdBy,
        batch.name,
        batch.id,
        user.displayName,
        selectedCompany.id
      );
      toast.success("Autorização confirmada");
      fetchBatches();
    } catch (error) {
      console.error("Error confirming authorization:", error);
      toast.error("Erro ao confirmar autorização");
    }
  };

  // Confirm payments (manager final action)
  const handleConfirmPayments = async (batch: PaymentBatch) => {
    if (!user) return;
    try {
      await paymentBatchService.confirmPayments(batch.id, user.uid);
      toast.success("Pagamentos confirmados");
      fetchBatches();
    } catch (error) {
      console.error("Error confirming payments:", error);
      toast.error("Erro ao confirmar pagamentos");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="outline">Aberto</Badge>;
      case "pending_approval":
        return <Badge className="bg-amber-500">Aguardando Aprovação</Badge>;
      case "approved":
        return <Badge className="bg-green-500">Aprovado</Badge>;
      case "pending_authorization":
        return <Badge className="bg-amber-500">Aguardando Autorização</Badge>;
      case "authorized":
        return <Badge className="bg-teal-500">Autorizado</Badge>;
      case "paid":
        return <Badge className="bg-blue-500">Pago</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejeitado</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getResponsiblePerson = (batch: PaymentBatch) => {
    switch (batch.status) {
      case "pending_approval":
        return batch.approverEmail ? `Aprovador: ${batch.approverEmail}` : "-";
      case "pending_authorization":
        return batch.authorizerEmail
          ? `Autorizador: ${batch.authorizerEmail}`
          : "-";
      default:
        return "-";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Lotes de Pagamento
        </h1>
        {canManageBatches && (
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Novo Lote
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Novo Lote</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome do Lote</Label>
                  <Input
                    id="name"
                    placeholder="Ex: Pagamentos Semana 42"
                    value={newBatchName}
                    onChange={(e) => setNewBatchName(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancelar
                </Button>
                <Button onClick={handleCreateBatch}>Criar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="border rounded-lg">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Transações</TableHead>
                <TableHead>Valor Total</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Nenhum lote encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-medium">{batch.name}</TableCell>
                    <TableCell>{getStatusBadge(batch.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {getResponsiblePerson(batch)}
                    </TableCell>
                    <TableCell>{batch.transactionIds.length}</TableCell>
                    <TableCell>{formatCurrency(batch.totalAmount)}</TableCell>
                    <TableCell>
                      {format(batch.createdAt, "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Ações</DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => handleViewDetails(batch)}
                          >
                            Ver Detalhes
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />

                          {/* Status: Open - Manager can send for approval */}
                          {batch.status === "open" && canManageBatches && (
                            <DropdownMenuItem
                              onClick={() => handleOpenSendForApproval(batch)}
                            >
                              Enviar para Aprovador
                            </DropdownMenuItem>
                          )}

                          {/* Status: Pending Approval - Approver can approve */}
                          {batch.status === "pending_approval" &&
                            canApproveBatches && (
                              <DropdownMenuItem
                                onClick={() => handleOpenApproval(batch)}
                              >
                                Aprovar Lote
                              </DropdownMenuItem>
                            )}

                          {/* Status: Approved - Manager can send for authorization */}
                          {batch.status === "approved" && canManageBatches && (
                            <DropdownMenuItem
                              onClick={() =>
                                handleOpenSendForAuthorization(batch)
                              }
                            >
                              Enviar para Autorização
                            </DropdownMenuItem>
                          )}

                          {/* Status: Pending Authorization - Releaser can confirm */}
                          {batch.status === "pending_authorization" &&
                            canPayBatches && (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleConfirmAuthorization(batch)
                                }
                              >
                                Confirmar Autorização
                              </DropdownMenuItem>
                            )}

                          {/* Status: Authorized - Manager can confirm payments */}
                          {batch.status === "authorized" &&
                            canManageBatches && (
                              <DropdownMenuItem
                                onClick={() => handleConfirmPayments(batch)}
                              >
                                Confirmar Pagamentos
                              </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Details Dialog */}
      <BatchDetailsDialog
        batch={selectedBatch}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
      />

      {/* Send for Approval Dialog */}
      {selectedCompany && (
        <BatchSendDialog
          isOpen={isSendForApprovalOpen}
          onClose={() => {
            setIsSendForApprovalOpen(false);
            setActionBatch(null);
          }}
          onSend={handleSendForApproval}
          companyId={selectedCompany.id}
          title="Enviar para Aprovador"
          description="Selecione o aprovador que irá revisar e aprovar este lote de pagamentos."
          roles={["approver", "admin", "financial_manager"]}
          buttonText="Enviar para Aprovação"
        />
      )}

      {/* Approval Dialog */}
      {user && (
        <BatchApprovalDialog
          batch={actionBatch}
          isOpen={isApprovalOpen}
          onClose={() => {
            setIsApprovalOpen(false);
            setActionBatch(null);
          }}
          onApprove={handleApprovalComplete}
          userId={user.uid}
        />
      )}

      {/* Send for Authorization Dialog */}
      {selectedCompany && (
        <BatchSendDialog
          isOpen={isSendForAuthorizationOpen}
          onClose={() => {
            setIsSendForAuthorizationOpen(false);
            setActionBatch(null);
          }}
          onSend={handleSendForAuthorization}
          companyId={selectedCompany.id}
          title="Enviar para Autorização"
          description="Selecione o autorizador que irá confirmar os pagamentos no banco."
          roles={["releaser", "admin", "financial_manager"]}
          buttonText="Enviar para Autorização"
        />
      )}
    </div>
  );
}
