"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

interface PaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    paymentDate: Date;
    finalAmount: number;
    discount: number;
    interest: number;
  }) => Promise<void>;
  transaction: Transaction;
  type: "pay" | "receive";
}

export function PaymentDialog({
  isOpen,
  onClose,
  onConfirm,
  transaction,
  type,
}: PaymentDialogProps) {
  const [date, setDate] = useState<Date>(new Date());
  // Estado numérico limpo — CurrencyInput gerencia a exibição pt-BR internamente
  const [finalAmount, setFinalAmount] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && transaction) {
      setDate(new Date());
      setFinalAmount(transaction.amount);
    }
  }, [isOpen, transaction]);

  const handleConfirm = async () => {
    if (!date || finalAmount <= 0) return;

    try {
      setIsSubmitting(true);

      const originalAmount = transaction.amount;
      let discount = 0;
      let interest = 0;

      if (finalAmount < originalAmount) {
        discount = originalAmount - finalAmount;
      } else if (finalAmount > originalAmount) {
        interest = finalAmount - originalAmount;
      }

      await onConfirm({
        paymentDate: date,
        finalAmount,
        discount,
        interest,
      });
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {type === "pay" ? "Confirmar Pagamento" : "Confirmar Recebimento"}
          </DialogTitle>
        </DialogHeader>
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
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid gap-2">
            <Label>Valor {type === "pay" ? "Pago" : "Recebido"}</Label>
            {/* CurrencyInput aceita `number` e expõe `number` — sem parseFloat manual.
                Formata automaticamente no padrão pt-BR (pontos de milhar, vírgula decimal). */}
            <CurrencyInput
              value={finalAmount}
              onChange={setFinalAmount}
            />
            <p className="text-xs text-muted-foreground">
              Valor original: {formatCurrency(transaction.amount)}
            </p>
          </div>
          {finalAmount > 0 && (
            <div className="text-sm">
              {finalAmount < transaction.amount && (
                <p className="text-green-600">
                  Desconto: {formatCurrency(transaction.amount - finalAmount)}
                </p>
              )}
              {finalAmount > transaction.amount && (
                <p className="text-red-600">
                  Juros/Multa: {formatCurrency(finalAmount - transaction.amount)}
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
