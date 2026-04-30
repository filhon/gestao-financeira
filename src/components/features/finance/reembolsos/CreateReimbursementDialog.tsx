"use client";

import { useState, useEffect } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { reimbursementReportService } from "@/lib/services/reimbursementReportService";
import { transactionService } from "@/lib/services/transactionService";
import { entityService } from "@/lib/services/entityService";
import { Entity, Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  CalendarIcon,
  Loader2,
  User,
  Receipt,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CreateReimbursementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const STEPS = ["Funcionário", "Período", "Revisão"];

export function CreateReimbursementDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateReimbursementDialogProps) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Step 1 — employee
  const [individuals, setIndividuals] = useState<Entity[]>([]);
  const [loadingIndividuals, setLoadingIndividuals] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  // Step 2 — period
  const [periodStart, setPeriodStart] = useState<Date>(
    startOfMonth(new Date()),
  );
  const [periodEnd, setPeriodEnd] = useState<Date>(endOfMonth(new Date()));
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  // Step 3 — review
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [notes, setNotes] = useState("");

  const selectedEmployee = individuals.find((e) => e.id === selectedEmployeeId);

  // Load individuals
  useEffect(() => {
    if (!open || !selectedCompany) return;
    setLoadingIndividuals(true);
    entityService
      .getAll(selectedCompany.id)
      .then((all) => setIndividuals(all.filter((e) => e.type === "individual")))
      .finally(() => setLoadingIndividuals(false));
  }, [open, selectedCompany]);

  // Load matching transactions when reaching review step
  useEffect(() => {
    if (step !== 2 || !selectedCompany || !selectedEmployeeId) return;
    setLoadingTx(true);
    transactionService
      .getAll({
        companyId: selectedCompany.id,
        startDate: periodStart,
        endDate: periodEnd,
      })
      .then((all) => {
        const matching = all.filter(
          (t) =>
            t.isReimbursement === true &&
            t.entityId === selectedEmployeeId &&
            !t.reimbursementReportId,
        );
        setTransactions(matching);
      })
      .finally(() => setLoadingTx(false));
  }, [step, selectedCompany, selectedEmployeeId, periodStart, periodEnd]);

  const totalAmount = transactions.reduce((sum, t) => {
    const amt = t.status === "paid" && t.finalAmount ? t.finalAmount : t.amount;
    return sum + amt;
  }, 0);

  const handleReset = () => {
    setStep(0);
    setSelectedEmployeeId("");
    setPeriodStart(startOfMonth(new Date()));
    setPeriodEnd(endOfMonth(new Date()));
    setTransactions([]);
    setNotes("");
  };

  const handleClose = () => {
    handleReset();
    onOpenChange(false);
  };

  const handleCreate = async () => {
    if (!selectedCompany || !user || !selectedEmployee) return;
    if (transactions.length === 0) {
      toast.error(
        "Nenhum lançamento de reembolso encontrado para este funcionário no período.",
      );
      return;
    }

    setIsLoading(true);
    try {
      await reimbursementReportService.create(
        {
          employeeId: selectedEmployee.id,
          employeeName: selectedEmployee.name,
          employeeDocument: selectedEmployee.document,
          employeeEmail: selectedEmployee.email,
          periodStart,
          periodEnd,
          transactionIds: transactions.map((t) => t.id),
          totalAmount,
          notes: notes.trim() || undefined,
        },
        { uid: user.uid, email: user.email! },
        selectedCompany.id,
      );

      toast.success("Relatório de despesas criado com sucesso!");
      handleClose();
      onCreated();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao criar o relatório. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  const canProceedStep0 = !!selectedEmployeeId;
  const canProceedStep1 = periodStart <= periodEnd;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Novo Relatório de Despesas</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-2 shrink-0">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                    i < step
                      ? "bg-green-600 text-white"
                      : i === step
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-500",
                  )}
                >
                  {i < step ? "✓" : i + 1}
                </div>
                <span
                  className={cn(
                    "text-xs",
                    i === step
                      ? "font-semibold text-slate-900"
                      : "text-slate-400",
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 mx-1 flex-1" />
              )}
            </div>
          ))}
        </div>

        {/* ── Step 0: Select employee ─────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-4 py-2 overflow-y-auto flex-1">
            <div className="space-y-2">
              <Label>Funcionário (Pessoa Física)</Label>
              {loadingIndividuals ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando cadastros...
                </div>
              ) : individuals.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Nenhuma pessoa física cadastrada. Cadastre o funcionário em{" "}
                    <strong>Cadastros → Entidades</strong> com tipo{" "}
                    <strong>Pessoa Física</strong>.
                  </AlertDescription>
                </Alert>
              ) : (
                <Select
                  value={selectedEmployeeId}
                  onValueChange={setSelectedEmployeeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funcionário..." />
                  </SelectTrigger>
                  <SelectContent>
                    {individuals.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{e.name}</span>
                          {e.document && (
                            <span className="text-muted-foreground text-xs shrink-0">
                              · {e.document}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}

        {/* ── Step 1: Select period ───────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4 py-2 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data Inicial</Label>
                <Popover open={startOpen} onOpenChange={setStartOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !periodStart && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {periodStart
                        ? format(periodStart, "dd/MM/yyyy")
                        : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={periodStart}
                      onSelect={(d) => {
                        if (d) {
                          setPeriodStart(d);
                          setStartOpen(false);
                        }
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Data Final</Label>
                <Popover open={endOpen} onOpenChange={setEndOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !periodEnd && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {periodEnd
                        ? format(periodEnd, "dd/MM/yyyy")
                        : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={periodEnd}
                      onSelect={(d) => {
                        if (d) {
                          setPeriodEnd(d);
                          setEndOpen(false);
                        }
                      }}
                      fromDate={periodStart}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {!canProceedStep1 && (
              <p className="text-xs text-red-500">
                A data inicial deve ser anterior à data final.
              </p>
            )}
          </div>
        )}

        {/* ── Step 2: Review ─────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4 py-2 overflow-y-auto flex-1">
            {/* Summary card */}
            <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium">
                  {selectedEmployee?.name}
                </span>
                {selectedEmployee?.document && (
                  <span className="text-xs text-slate-400">
                    · CPF {selectedEmployee.document}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Período: {format(periodStart, "dd/MM/yyyy", { locale: ptBR })} —{" "}
                {format(periodEnd, "dd/MM/yyyy", { locale: ptBR })}
              </p>
            </div>

            {/* Transactions list */}
            {loadingTx ? (
              <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Buscando lançamentos...</span>
              </div>
            ) : transactions.length === 0 ? (
              <Alert>
                <Receipt className="h-4 w-4" />
                <AlertDescription>
                  Nenhum lançamento de reembolso encontrado para este
                  funcionário no período selecionado. Certifique-se de que as
                  transações estão marcadas como{" "}
                  <strong>Despesa de reembolso</strong> e vinculadas a este
                  funcionário.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                  {transactions.length} lançamento(s) encontrado(s)
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 rounded border p-2">
                  {transactions.map((t) => {
                    const amt =
                      t.status === "paid" && t.finalAmount
                        ? t.finalAmount
                        : t.amount;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between text-sm px-2 py-1 rounded bg-white"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-slate-400 text-xs shrink-0">
                            {format(t.dueDate, "dd/MM")}
                          </span>
                          <span className="truncate">{t.description}</span>
                        </div>
                        <span className="font-medium text-slate-700 shrink-0 ml-2">
                          {formatCurrency(amt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-2.5">
                  <span className="text-xs text-slate-400 font-medium uppercase">
                    Total
                  </span>
                  <span className="text-green-400 font-bold text-base">
                    {formatCurrency(totalAmount)}
                  </span>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="rd-notes">Observações (opcional)</Label>
              <Textarea
                id="rd-notes"
                placeholder="Adicione informações relevantes sobre este reembolso..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-0 shrink-0 border-t pt-4">
          <div className="flex gap-2 w-full sm:w-auto">
            {step > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                disabled={isLoading}
                className="flex-1 sm:flex-none"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isLoading}
              className="flex-1 sm:flex-none"
            >
              Cancelar
            </Button>
          </div>

          {step < 2 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 0 && !canProceedStep0) ||
                (step === 1 && !canProceedStep1)
              }
            >
              Próximo
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              loading={isLoading}
              disabled={transactions.length === 0}
            >
              Criar Relatório
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
