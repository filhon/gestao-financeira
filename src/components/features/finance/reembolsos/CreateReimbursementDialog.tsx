"use client";

import { useEffect, useMemo, useState } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  reimbursementReportService,
  itemAmount,
  sumItems,
} from "@/lib/services/reimbursementReportService";
import { Entity, Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { formatCpfCnpj } from "@/lib/validations/cnpj";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/features/finance/TransactionList";
import { formatPeriod } from "./reimbursementUi";

interface CreateReimbursementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Funcionários ativos (pessoa física). */
  employees: Entity[];
  /** Despesas de reembolso sem relatório, por funcionário. */
  queue: Map<string, Transaction[]>;
  initialEmployeeId?: string;
  onCreated: (reportId: string) => void;
}

/**
 * Painel único: escolhe o funcionário, vê as despesas sem relatório dele e
 * cria. Período e total saem das despesas marcadas.
 */
export function CreateReimbursementDialog({
  open,
  onOpenChange,
  employees,
  queue,
  initialEmployeeId,
  onCreated,
}: CreateReimbursementDialogProps) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();

  const [employeeId, setEmployeeId] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(initialEmployeeId ?? "");
    setExcluded(new Set());
    setNotes("");
  }, [open, initialEmployeeId]);

  // Quem tem pendência primeiro; quem não tem fica visível, mas desabilitado.
  const options = useMemo(
    () =>
      [...employees].sort(
        (a, b) =>
          (queue.get(b.id)?.length ?? 0) - (queue.get(a.id)?.length ?? 0) ||
          a.name.localeCompare(b.name),
      ),
    [employees, queue],
  );

  const employee = employees.find((e) => e.id === employeeId);
  const items = useMemo(
    () =>
      [...(queue.get(employeeId) ?? [])].sort(
        (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
      ),
    [queue, employeeId],
  );
  const selected = items.filter((t) => !excluded.has(t.id));
  const total = sumItems(selected);
  const withoutNote = selected.filter(
    (t) => !(t.attachments ?? []).some((a) => a.url),
  ).length;
  const period = selected.length
    ? formatPeriod(
        startOfMonth(selected[0].dueDate),
        endOfMonth(selected[selected.length - 1].dueDate),
      )
    : null;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCreate = async () => {
    if (!selectedCompany || !user || !employee || !selected.length) return;
    setIsSaving(true);
    try {
      const { id, rdNumber } = await reimbursementReportService.create(
        {
          employee,
          transactionIds: selected.map((t) => t.id),
          notes,
        },
        { uid: user.uid },
        selectedCompany.id,
      );
      toast.success(`${rdNumber} criado.`);
      onOpenChange(false);
      onCreated(id);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao criar o relatório.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} panel>
      <ResponsiveModalContent sheetClassName="gap-0 overflow-hidden p-0 max-md:pt-3">
        <div className="shrink-0 border-b px-6 pt-5 pb-4">
          <ResponsiveModalTitle className="text-lg font-semibold">
            Novo relatório de despesas
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-sm">
            Junta as despesas de reembolso de um funcionário que ainda não estão
            em nenhum relatório.
          </ResponsiveModalDescription>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="rd-employee">Funcionário</Label>
            <Select
              value={employeeId}
              onValueChange={(v) => {
                setEmployeeId(v);
                setExcluded(new Set());
              }}
            >
              <SelectTrigger id="rd-employee" className="w-full">
                <SelectValue placeholder="Selecione o funcionário" />
              </SelectTrigger>
              <SelectContent>
                {options.map((e) => {
                  const pending = queue.get(e.id) ?? [];
                  return (
                    <SelectItem
                      key={e.id}
                      value={e.id}
                      disabled={!pending.length}
                    >
                      <span className="truncate">{e.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {pending.length
                          ? `${pending.length} · ${formatCurrency(sumItems(pending))}`
                          : "nada a reembolsar"}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {employees.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma pessoa física ativa. Cadastre o funcionário em
                Cadastros, Entidades, com tipo Pessoa Física.
              </p>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {!employee ? (
            <p className="text-sm text-muted-foreground">
              Escolha um funcionário para ver as despesas dele.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {employee.document &&
                    `CPF ${formatCpfCnpj(employee.document)}`}
                </span>
                <span>
                  {selected.length} de {items.length} marcadas
                </span>
              </div>
              <ul className="divide-y rounded-md border">
                {items.map((t) => {
                  const hasNote = (t.attachments ?? []).some((a) => a.url);
                  return (
                    <li key={t.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                        <Checkbox
                          checked={!excluded.has(t.id)}
                          onCheckedChange={() => toggle(t.id)}
                          aria-label={`Incluir ${t.description}`}
                        />
                        <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {format(t.dueDate, "dd/MM/yy")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {t.description}
                          </span>
                          <span className="flex items-center gap-2 text-xs">
                            <StatusBadge status={t.status} type="payable" />
                            {!hasNote && (
                              <span className="text-amber-700 dark:text-amber-400">
                                sem nota
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 font-financial text-sm tabular-nums">
                          {formatCurrency(itemAmount(t))}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 space-y-1.5">
                <Label htmlFor="rd-notes">
                  Observações{" "}
                  <span className="font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Textarea
                  id="rd-notes"
                  placeholder="Ex.: despesas da viagem a Recife, autorizadas pela diretoria."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-6 py-4">
          {selected.length > 0 && (
            <div className="mb-3 flex items-end justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                {period}
                {withoutNote > 0 && (
                  <span className="block text-amber-700 dark:text-amber-400">
                    {withoutNote === 1
                      ? "1 despesa sem nota"
                      : `${withoutNote} despesas sem nota`}
                  </span>
                )}
              </div>
              <p className="font-financial text-2xl font-semibold tabular-nums">
                {formatCurrency(total)}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              loading={isSaving}
              disabled={!selected.length}
            >
              Criar relatório
            </Button>
          </div>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
