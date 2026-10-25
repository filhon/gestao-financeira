"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { Transaction } from "@/lib/types";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { CurrencyInput } from "@/components/ui/currency-input";
import currency from "currency.js";
import { lateCharges, type LateFeeRule } from "@/lib/transactionTabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useBankAccounts } from "@/hooks/useBankAccounts";

export interface PaymentConfirmation {
  paymentDate: Date;
  finalAmount: number;
  discount: number;
  interest: number;
  bankAccountId?: string;
}

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: PaymentConfirmation) => Promise<void>;
  transaction: Transaction;
  type: "pay" | "receive";
  /** Quando informado, sugere o valor com multa e juros pela data escolhida. */
  lateFee?: LateFeeRule;
}

export function PaymentDialog({
  isOpen,
  onClose,
  onConfirm,
  transaction,
  type,
  lateFee,
}: PaymentDialogProps) {
  const [date, setDate] = useState<Date>(new Date());
  // Estado numérico limpo — CurrencyInput gerencia a exibição pt-BR internamente
  const [finalAmount, setFinalAmount] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Depois que o usuário digita um valor, trocar a data não o sobrescreve.
  const [amountEdited, setAmountEdited] = useState(false);

  // Conta por onde o dinheiro passou: a do título, ou a única cadastrada.
  const { selectedCompany } = useCompany();
  const { canViewReconciliation } = usePermissions();
  const { accounts } = useBankAccounts(
    canViewReconciliation ? selectedCompany?.id : undefined,
  );
  const activeAccounts = accounts.filter(
    (a) => a.active || a.id === transaction.bankAccountId,
  );
  const [bankAccountId, setBankAccountId] = useState<string | undefined>();
  const defaultAccountId =
    transaction.bankAccountId ??
    (activeAccounts.length === 1 ? activeAccounts[0].id : undefined);
  useEffect(() => {
    if (isOpen) setBankAccountId(defaultAccountId);
  }, [isOpen, defaultAccountId]);

  const charges = lateFee
    ? lateCharges(transaction.amount, transaction.dueDate, date, lateFee)
    : null;

  // Primitivos nas dependências: a regra chega como objeto novo a cada render.
  const feePercent = lateFee?.feePercent;
  const monthlyInterestPercent = lateFee?.monthlyInterestPercent;

  useEffect(() => {
    if (isOpen && transaction) {
      const today = new Date();
      setDate(today);
      setAmountEdited(false);
      setFinalAmount(
        feePercent !== undefined && monthlyInterestPercent !== undefined
          ? lateCharges(transaction.amount, transaction.dueDate, today, {
              feePercent,
              monthlyInterestPercent,
            }).total
          : transaction.amount,
      );
    }
  }, [isOpen, transaction, feePercent, monthlyInterestPercent]);

  const handleConfirm = async () => {
    if (!date || finalAmount <= 0) return;

    try {
      setIsSubmitting(true);

      const originalAmount = transaction.amount;
      let discount = 0;
      let interest = 0;

      if (finalAmount < originalAmount) {
        discount = currency(originalAmount).subtract(finalAmount).value;
      } else if (finalAmount > originalAmount) {
        interest = currency(finalAmount).subtract(originalAmount).value;
      }

      await onConfirm({
        paymentDate: date,
        finalAmount,
        discount,
        interest,
        bankAccountId,
      });
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResponsiveModal open={isOpen} onOpenChange={onClose}>
      <ResponsiveModalContent className="sm:max-w-[425px]">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>
            {type === "pay" ? "Confirmar Pagamento" : "Confirmar Recebimento"}
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>
              Data do {type === "pay" ? "Pagamento" : "Recebimento"}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? (
                    format(date, "PPP", { locale: ptBR })
                  ) : (
                    <span>Selecione uma data</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    if (!d) return;
                    setDate(d);
                    if (lateFee && !amountEdited) {
                      setFinalAmount(
                        lateCharges(
                          transaction.amount,
                          transaction.dueDate,
                          d,
                          lateFee,
                        ).total,
                      );
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          {activeAccounts.length > 0 && (
            <div className="grid gap-2">
              <Label>Conta de {type === "pay" ? "saída" : "entrada"}</Label>
              <Select
                value={bankAccountId ?? ""}
                onValueChange={setBankAccountId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Não definida" />
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Valor {type === "pay" ? "Pago" : "Recebido"}</Label>
            {/* CurrencyInput aceita `number` e expõe `number` — sem parseFloat manual.
                Formata automaticamente no padrão pt-BR (pontos de milhar, vírgula decimal). */}
            <CurrencyInput
              value={finalAmount}
              onChange={(v) => {
                setAmountEdited(true);
                setFinalAmount(v);
              }}
            />
            <p className="text-xs text-muted-foreground font-financial">
              Valor original: {formatCurrency(transaction.amount)}
              {charges && charges.days > 0 && (
                <>
                  {" "}
                  · {charges.days} dia{charges.days !== 1 && "s"} de atraso:
                  multa {formatCurrency(charges.fee)} + juros{" "}
                  {formatCurrency(charges.interest)} ={" "}
                  {formatCurrency(charges.total)}
                </>
              )}
            </p>
          </div>
          {finalAmount > 0 && (
            <div className="text-sm">
              {finalAmount < transaction.amount && (
                <p className="text-green-600 font-financial">
                  Desconto:{" "}
                  {formatCurrency(
                    currency(transaction.amount).subtract(finalAmount).value,
                  )}
                </p>
              )}
              {finalAmount > transaction.amount && (
                <p className="text-red-600 font-financial">
                  Juros/Multa:{" "}
                  {formatCurrency(
                    currency(finalAmount).subtract(transaction.amount).value,
                  )}
                </p>
              )}
            </div>
          )}
        </div>
        <ResponsiveModalFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
