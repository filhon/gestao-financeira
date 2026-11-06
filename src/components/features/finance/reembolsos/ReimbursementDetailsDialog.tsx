"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { companyUsersQuery } from "@/hooks/useAuditNames";
import {
  reimbursementReportService,
  approvalStatus,
  canDecide,
  itemAmount,
  sumItems,
} from "@/lib/services/reimbursementReportService";
import { emailService } from "@/lib/services/emailService";
import { transactionService } from "@/lib/services/transactionService";
import { ReimbursementReport } from "@/lib/types";
import { formatCurrency, cn } from "@/lib/utils";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { BatchSendDialog } from "@/components/features/finance/BatchSendDialog";
import { StatusBadge } from "@/components/features/finance/TransactionList";
import { DocumentPreview } from "@/components/features/finance/DocumentPreview";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Send,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  ApprovalBadge,
  PaymentLabel,
  formatPeriod,
  paymentOf,
} from "./reimbursementUi";

interface ReimbursementDetailsDialogProps {
  report: ReimbursementReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
  onDownloadPdf: (report: ReimbursementReport) => Promise<void>;
}

/** Mensagem do service (escrita para o usuário) ou o texto padrão. */
export function actionError(error: unknown, fallback: string) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "permission-denied")
    return "Você não tem permissão para esta ação.";
  return error instanceof Error && !code ? error.message : fallback;
}

export function ReimbursementDetailsDialog({
  report,
  open,
  onOpenChange,
  onUpdated,
  onDownloadPdf,
}: ReimbursementDetailsDialogProps) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { isAdmin, isFinancialManager } = usePermissions();
  const canManage = isAdmin || isFinancialManager;

  const [busy, setBusy] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    setRejecting(false);
    setRejectReason("");
    setPreviewIndex(null);
  }, [report?.id]);

  const { data: items = [], isPending: loadingItems } = useQuery({
    queryKey: ["rd-items", report?.id, report?.transactionIds.join(",")],
    queryFn: async () =>
      (await transactionService.getByIds(report!.transactionIds)).sort(
        (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
      ),
    enabled: open && !!report,
  });

  const { data: users = [] } = useQuery({
    ...companyUsersQuery(selectedCompany?.id ?? ""),
    enabled: open && !!selectedCompany,
  });
  const nameOf = (uid?: string) => {
    if (!uid) return undefined;
    if (uid.startsWith("magic-link:"))
      return uid.slice(11) || "link por e-mail";
    const u = users.find((x) => x.uid === uid);
    return u?.displayName || u?.email;
  };

  // Notas de todos os itens, na ordem em que a folha navega entre elas.
  const docs = useMemo(
    () =>
      items.flatMap((t) =>
        (t.attachments ?? [])
          .filter((a) => !!a.url)
          .map((a) => ({
            key: `${t.id}:${a.id}`,
            itemId: t.id,
            name: a.name,
            url: a.url,
            type: a.type || undefined,
            label: t.description,
          })),
      ),
    [items],
  );
  const previewDoc = previewIndex != null ? docs[previewIndex] : undefined;
  const movePreview = (delta: number) =>
    setPreviewIndex((i) =>
      i == null ? i : (i + delta + docs.length) % docs.length,
    );

  if (!report) return null;

  const status = approvalStatus(report);
  const actor = user ? { uid: user.uid, email: user.email } : null;
  const mayDecide = !!actor && canDecide(report, actor);
  const liveTotal = items.length ? sumItems(items) : report.totalAmount;
  const totalDrifted =
    !loadingItems &&
    (status === "pending_approval" || status === "approved") &&
    Math.round(liveTotal * 100) !== Math.round(report.totalAmount * 100);
  const payment = paymentOf(items);
  const withoutNote = items.filter(
    (t) => !(t.attachments ?? []).some((a) => a.url),
  ).length;
  const missing = loadingItems
    ? 0
    : report.transactionIds.length - items.length;

  const run = async (key: string, fn: () => Promise<void>, fail: string) => {
    setBusy(key);
    try {
      await fn();
      onUpdated();
    } catch (error) {
      console.error(error);
      toast.error(actionError(error, fail));
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async (_id: string, email: string) => {
    if (!actor) return;
    try {
      const { token } = await reimbursementReportService.sendForApproval(
        report,
        email,
        actor,
      );
      await emailService.sendReimbursementApprovalRequest(
        report.id,
        token,
        email,
      );
      toast.success(`Link enviado para ${email}. Vale por 7 dias.`);
      onUpdated();
    } catch (error) {
      console.error(error);
      toast.error(actionError(error, "Erro ao enviar para aprovação."));
      throw error;
    }
  };

  const handleApprove = () =>
    run(
      "approve",
      async () => {
        await reimbursementReportService.approve(report.id, actor!.uid);
        if (report.employeeEmail)
          await emailService.sendReimbursementApproved(
            report.id,
            report.employeeEmail,
          );
        toast.success(`${report.rdNumber} aprovado.`);
      },
      "Erro ao aprovar o relatório.",
    );

  const handleReject = () =>
    run(
      "reject",
      async () => {
        await reimbursementReportService.reject(
          report,
          actor!.uid,
          rejectReason.trim(),
        );
        setRejecting(false);
        toast.success(
          `${report.rdNumber} rejeitado. As despesas voltaram para a fila.`,
        );
      },
      "Erro ao rejeitar o relatório.",
    );

  const handleRecall = () =>
    run(
      "recall",
      async () => {
        await reimbursementReportService.revertToDraft(report.id);
        toast.success("Envio recolhido. O link deixou de valer.");
      },
      "Erro ao recolher o envio.",
    );

  const handleDelete = async () => {
    await run(
      "delete",
      async () => {
        await reimbursementReportService.delete(report);
        toast.success(
          `${report.rdNumber} excluído. As despesas voltaram para a fila.`,
        );
        onOpenChange(false);
      },
      "Erro ao excluir o relatório.",
    );
  };

  const handlePdf = async () => {
    setBusy("pdf");
    try {
      await onDownloadPdf(report);
    } finally {
      setBusy(null);
    }
  };

  // Histórico a partir dos campos do próprio relatório.
  const history = [
    { label: "Criado", at: report.createdAt, by: nameOf(report.createdBy) },
    report.sentForApprovalAt && {
      label: `Enviado para ${report.approverEmail ?? "aprovação"}`,
      at: report.sentForApprovalAt,
      by: nameOf(report.sentBy),
    },
    report.approvedAt && {
      label: "Aprovado",
      at: report.approvedAt,
      by: nameOf(report.approvedBy),
    },
    report.rejectedAt && {
      label: "Rejeitado",
      at: report.rejectedAt,
      by: nameOf(report.rejectedBy),
    },
    payment.total > 0 &&
      payment.paid === payment.total &&
      payment.lastPaidAt && { label: "Pago", at: payment.lastPaidAt },
  ].filter(Boolean) as { label: string; at?: Date; by?: string }[];

  return (
    <>
      <ResponsiveModal open={open} onOpenChange={onOpenChange} panel>
        <ResponsiveModalContent
          sheetClassName="gap-0 overflow-visible p-0 max-md:pt-3"
          onEscapeKeyDown={(e) => {
            if (previewDoc) {
              e.preventDefault();
              setPreviewIndex(null);
            }
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {/* ── Cabeçalho ─────────────────────────────────────────────── */}
            <div className="shrink-0 border-b px-6 pt-4 pb-4">
              <div className="flex items-center gap-2 pr-8 text-xs text-muted-foreground">
                <ApprovalBadge report={report} />
                <span>Relatório de despesas</span>
              </div>
              <ResponsiveModalTitle className="mt-2 font-mono text-lg font-semibold">
                {report.rdNumber}
              </ResponsiveModalTitle>
              <ResponsiveModalDescription className="mt-0.5 text-sm">
                <Link
                  href={`/cadastros/entidades/${report.employeeId}`}
                  className="text-foreground underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  {report.employeeName}
                </Link>
                {report.employeeDocument &&
                  ` · CPF ${formatCpfCnpj(report.employeeDocument)}`}
              </ResponsiveModalDescription>

              <dl className="mt-4 grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="font-financial text-2xl font-semibold tabular-nums">
                    {formatCurrency(liveTotal)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Período</dt>
                  <dd className="text-sm font-medium">
                    {formatPeriod(report.periodStart, report.periodEnd)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Pagamento</dt>
                  <dd className="text-sm">
                    {loadingItems ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PaymentLabel payment={payment} />
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            {/* ── Corpo ─────────────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
              {status === "rejected" && report.rejectionReason && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
                  <p className="font-medium">Motivo da rejeição</p>
                  <p>{report.rejectionReason}</p>
                </div>
              )}

              {totalDrifted && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Os itens mudaram depois do envio: foi para aprovação com{" "}
                  {formatCurrency(report.totalAmount)}, agora somam{" "}
                  {formatCurrency(liveTotal)}.
                </p>
              )}

              {missing > 0 && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {missing === 1
                    ? "1 despesa deste relatório foi excluída."
                    : `${missing} despesas deste relatório foram excluídas.`}
                </p>
              )}

              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">
                    Despesas ({report.transactionIds.length})
                  </h3>
                  {withoutNote > 0 && (
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      {withoutNote === 1
                        ? "1 sem nota"
                        : `${withoutNote} sem nota`}
                    </span>
                  )}
                </div>
                {loadingItems ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando despesas…
                  </div>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {items.map((t) => {
                      const firstDoc = docs.findIndex((d) => d.itemId === t.id);
                      const docCount = docs.filter(
                        (d) => d.itemId === t.id,
                      ).length;
                      return (
                        <li
                          key={t.id}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2",
                            previewDoc?.itemId === t.id && "bg-muted/60",
                          )}
                        >
                          <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                            {format(t.dueDate, "dd/MM/yy")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {t.description}
                            </span>
                            <StatusBadge status={t.status} type="payable" />
                          </span>
                          {firstDoc >= 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 gap-1 px-2 text-xs"
                              onClick={() => setPreviewIndex(firstDoc)}
                            >
                              <Paperclip className="h-3.5 w-3.5" />
                              {docCount > 1 ? `${docCount} notas` : "Nota"}
                            </Button>
                          ) : (
                            <span className="shrink-0 px-2 text-xs text-amber-700 dark:text-amber-400">
                              sem nota
                            </span>
                          )}
                          <span className="w-24 shrink-0 text-right font-financial text-sm tabular-nums">
                            {formatCurrency(itemAmount(t))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {report.notes && (
                <section>
                  <h3 className="mb-1 text-sm font-medium">Observações</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">
                    {report.notes}
                  </p>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-medium">Histórico</h3>
                <ol className="space-y-1.5 text-sm">
                  {history.map((h) => (
                    <li key={h.label} className="flex gap-3">
                      <span className="w-28 shrink-0 text-muted-foreground tabular-nums">
                        {h.at ? format(h.at, "dd/MM/yy HH:mm") : "-"}
                      </span>
                      <span>
                        {h.label}
                        {h.by && (
                          <span className="text-muted-foreground">
                            {" "}
                            por {h.by}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {(status === "approved" || status === "pending_approval") &&
                  payment.paid < payment.total && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      O pagamento segue pelas contas a pagar de cada despesa
                      (lote de pagamento ou baixa).
                    </p>
                  )}
              </section>
            </div>

            {/* ── Rodapé fixo ───────────────────────────────────────────── */}
            <div className="shrink-0 space-y-3 border-t bg-background px-6 py-4">
              {status === "pending_approval" && !mayDecide && (
                <p className="text-sm text-muted-foreground">
                  Aguardando {report.approverEmail}
                  {report.sentForApprovalAt &&
                    ` desde ${format(report.sentForApprovalAt, "dd/MM/yyyy")}`}
                  .
                </p>
              )}

              {mayDecide && rejecting && (
                <div className="space-y-2">
                  <Label htmlFor="rd-reject">Motivo da rejeição</Label>
                  <Textarea
                    id="rd-reject"
                    autoFocus
                    rows={2}
                    placeholder="Ex.: falta a nota do táxi de 12/09."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {status === "draft" && canManage && (
                  <Button
                    onClick={() => setSendOpen(true)}
                    disabled={!!busy || !items.length}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Enviar para aprovação
                  </Button>
                )}

                {mayDecide && !rejecting && (
                  <>
                    <Button
                      onClick={handleApprove}
                      loading={busy === "approve"}
                      disabled={!!busy}
                    >
                      Aprovar {formatCurrency(liveTotal)}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setRejecting(true)}
                      disabled={!!busy}
                    >
                      Rejeitar
                    </Button>
                  </>
                )}
                {mayDecide && rejecting && (
                  <>
                    <Button
                      variant="destructive"
                      onClick={handleReject}
                      loading={busy === "reject"}
                      disabled={!!busy || rejectReason.trim().length < 3}
                    >
                      Confirmar rejeição
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setRejecting(false)}
                      disabled={!!busy}
                    >
                      Voltar
                    </Button>
                  </>
                )}

                {status === "pending_approval" && canManage && !mayDecide && (
                  <Button
                    variant="outline"
                    onClick={handleRecall}
                    loading={busy === "recall"}
                    disabled={!!busy}
                  >
                    <Undo2 className="mr-2 h-4 w-4" />
                    Recolher envio
                  </Button>
                )}

                <Button variant="outline" onClick={handlePdf} disabled={!!busy}>
                  {busy === "pdf" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  PDF
                </Button>

                {status === "draft" && canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                    title="Excluir relatório"
                    aria-label="Excluir relatório"
                    onClick={() => setConfirmDelete(true)}
                    disabled={!!busy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* ── Segunda folha: nota ao lado do painel ──────────────────── */}
          {previewDoc && (
            <aside
              aria-label={`Nota: ${previewDoc.name}`}
              className="absolute inset-0 z-10 flex flex-col bg-background shadow-xl duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] animate-in fade-in-0 slide-in-from-right-8 lg:left-auto lg:right-full lg:w-[min(56rem,calc(100vw-100%-1.5rem))] lg:border-l"
            >
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 lg:hidden"
                  aria-label="Voltar aos detalhes"
                  onClick={() => setPreviewIndex(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <p
                  className="min-w-0 flex-1 truncate px-1 text-sm font-medium"
                  title={previewDoc.name}
                >
                  {previewDoc.label}
                </p>
                {docs.length > 1 && (
                  <>
                    <span className="px-1 text-xs text-muted-foreground tabular-nums">
                      {previewIndex! + 1} de {docs.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Nota anterior"
                      onClick={() => movePreview(-1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Próxima nota"
                      onClick={() => movePreview(1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Abrir em nova aba"
                  aria-label="Abrir em nova aba"
                  asChild
                >
                  <a
                    href={previewDoc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden h-8 w-8 lg:inline-flex"
                  title="Fechar nota (Esc)"
                  aria-label="Fechar nota"
                  onClick={() => setPreviewIndex(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col bg-muted/30 p-3">
                <DocumentPreview
                  key={previewDoc.key}
                  url={previewDoc.url}
                  name={previewDoc.name}
                  type={previewDoc.type}
                  title={previewDoc.name}
                />
              </div>
            </aside>
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>

      {selectedCompany && (
        <BatchSendDialog
          isOpen={sendOpen}
          onClose={() => setSendOpen(false)}
          onSend={handleSend}
          companyId={selectedCompany.id}
          title={`Enviar ${report.rdNumber} para aprovação`}
          description="O aprovador recebe um link por e-mail, válido por 7 dias, com as despesas e as notas. Quem envia não pode aprovar."
          buttonText="Enviar"
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Excluir ${report.rdNumber}?`}
        description="As despesas voltam para a fila A reembolsar. Nenhuma conta a pagar é excluída."
        confirmText="Excluir relatório"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}
