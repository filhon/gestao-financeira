"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { expenseSubmissionService } from "@/lib/services/expenseSubmissionService";
import { transactionService } from "@/lib/services/transactionService";
import { accessKeyParts, flagMessage } from "@/lib/reimbursement/receiptChecks";
import { ExpenseSubmission } from "@/lib/types";
import { TransactionFormData } from "@/lib/validations/transaction";
import { formatCurrency } from "@/lib/utils";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DocumentPreview } from "@/components/features/finance/DocumentPreview";
import { TransactionForm } from "@/components/features/finance/TransactionForm";
import { ExternalLink } from "lucide-react";

/** O que a conta a pagar herda da nota enviada. */
function launchDefaults(s: ExpenseSubmission): Partial<TransactionFormData> {
  const supplier = s.supplierName
    ? `${s.supplierName}${s.supplierDocument ? ` (${formatCpfCnpj(s.supplierDocument)})` : ""}`
    : "";
  return {
    type: "payable",
    description: s.description,
    amount: s.amount ?? 0,
    dueDate: s.date ?? new Date(),
    entityId: s.employeeId,
    supplierOrClient: s.employeeName,
    isReimbursement: true,
    documentNumber: s.accessKey
      ? accessKeyParts(s.accessKey).number
      : undefined,
    details: [s.note, supplier && `Estabelecimento: ${supplier}`]
      .filter(Boolean)
      .join("\n"),
    attachments: [
      {
        id: s.attachment.id,
        url: s.attachment.url,
        name: s.attachment.name,
        type: s.attachment.type,
        category: "invoice",
      },
    ],
  };
}

export function SubmissionReviewPanel({
  submission,
  onClose,
  onDone,
}: {
  submission: ExpenseSubmission | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState<ExpenseSubmission | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRefusing(false);
    setReason("");
  }, [submission?.id]);

  const handleRefuse = async () => {
    if (!submission || !user) return;
    setBusy(true);
    try {
      await expenseSubmissionService.refuse(
        submission.id,
        reason.trim(),
        user.uid,
      );
      toast.success("Nota recusada. O funcionário vê o motivo no link.");
      onDone();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao recusar a nota.");
    } finally {
      setBusy(false);
    }
  };

  const handleLaunch = async (data: TransactionFormData) => {
    if (!launching || !user || !selectedCompany) return false;
    setSaving(true);
    try {
      const ref = await transactionService.create(
        data,
        { uid: user.uid, email: user.email ?? "" },
        selectedCompany.id,
      );
      await expenseSubmissionService.markLaunched(
        launching.id,
        ref.id,
        user.uid,
      );
      toast.success(
        "Conta a pagar lançada. A despesa entra na fila do funcionário.",
      );
      setLaunching(null);
      onDone();
      return true;
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao lançar a conta a pagar."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const s = submission;
  const key = s?.accessKey ? accessKeyParts(s.accessKey) : null;
  const duplicate = s?.flags.some((f) => f.code === "duplicate");

  return (
    <>
      <ResponsiveModal open={!!s} onOpenChange={(o) => !o && onClose()} panel>
        <ResponsiveModalContent sheetClassName="gap-0 overflow-hidden p-0 max-md:pt-3">
          {s && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b px-6 pt-5 pb-4">
                <p className="text-xs text-muted-foreground">
                  Enviada por {s.employeeName} em{" "}
                  {format(s.createdAt, "dd/MM/yyyy 'às' HH:mm")}
                </p>
                <ResponsiveModalTitle className="mt-1 text-lg font-semibold">
                  {s.description}
                </ResponsiveModalTitle>
                <ResponsiveModalDescription className="text-sm">
                  {s.supplierName ?? "Estabelecimento não lido"}
                  {s.supplierDocument &&
                    ` · ${formatCpfCnpj(s.supplierDocument)}`}
                </ResponsiveModalDescription>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <p className="font-financial text-2xl font-semibold tabular-nums">
                    {s.amount != null ? formatCurrency(s.amount) : "Sem valor"}
                  </p>
                  <div className="text-right text-sm">
                    <p className="text-xs text-muted-foreground">
                      Data da nota
                    </p>
                    <p className="tabular-nums">
                      {s.date ? format(s.date, "dd/MM/yyyy") : "-"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                {s.flags.length > 0 && (
                  <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {s.flags.map((f, i) => (
                      <li key={i}>{flagMessage(f)}</li>
                    ))}
                  </ul>
                )}

                {s.note && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Para que foi, segundo {s.employeeName.split(" ")[0]}
                    </p>
                    <p className="text-sm">{s.note}</p>
                  </div>
                )}

                {key && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">
                      {key.model} nº{" "}
                    </span>
                    {key.number}
                    <span className="block font-mono text-xs text-muted-foreground break-all">
                      {s.accessKey}
                    </span>
                  </p>
                )}

                <div className="flex h-[55vh] min-h-72 flex-col">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Nota</span>
                    <a
                      href={s.attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Abrir em nova aba
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <DocumentPreview
                    key={s.id}
                    url={s.attachment.url}
                    name={s.attachment.name}
                    type={s.attachment.type}
                    title={`Nota: ${s.description}`}
                  />
                </div>
              </div>

              <div className="shrink-0 space-y-3 border-t bg-background px-6 py-4">
                {refusing && (
                  <div className="space-y-1.5">
                    <Label htmlFor="sub-refuse">
                      Motivo (o funcionário vê)
                    </Label>
                    <Textarea
                      id="sub-refuse"
                      autoFocus
                      rows={2}
                      placeholder={
                        duplicate
                          ? "Ex.: nota já enviada antes."
                          : "Ex.: nota ilegível, mande outra foto."
                      }
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {refusing ? (
                    <>
                      <Button
                        variant="destructive"
                        onClick={handleRefuse}
                        loading={busy}
                        disabled={busy || reason.trim().length < 3}
                      >
                        Confirmar recusa
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setRefusing(false)}
                        disabled={busy}
                      >
                        Voltar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() => {
                          setLaunching(s);
                          onClose();
                        }}
                      >
                        Lançar conta a pagar
                      </Button>
                      <Button
                        variant={duplicate ? "destructive" : "outline"}
                        onClick={() => setRefusing(true)}
                      >
                        Recusar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>

      <Sheet open={!!launching} onOpenChange={(o) => !o && setLaunching(null)}>
        <SheetContent
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 overflow-visible p-0 sm:max-w-4xl"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-6 py-4">
            <SheetTitle className="text-lg">
              Lançar reembolso de {launching?.employeeName}
            </SheetTitle>
            <SheetDescription>
              em {selectedCompany?.name}. Escolha o centro de custo e confira o
              que a leitura trouxe.
            </SheetDescription>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 pt-5"
            style={{ "--form-inset": "1.5rem" } as React.CSSProperties}
          >
            {launching && (
              <TransactionForm
                key={launching.id}
                type="payable"
                variant="create"
                defaultValues={launchDefaults(launching)}
                onSubmit={handleLaunch}
                isLoading={saving}
                onCancel={() => setLaunching(null)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
