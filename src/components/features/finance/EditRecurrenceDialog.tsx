"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { RecurringTransactionTemplate } from "@/lib/types";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { getHierarchicalCostCenters } from "@/lib/services/costCenterService";
import { useCostCenters } from "@/hooks/useCostCenters";
import {
  accountRequiredFor,
  useChartOfAccounts,
} from "@/hooks/useChartOfAccounts";
import { AccountSelect } from "@/components/features/chart-of-accounts/AccountSelect";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { ptBR } from "date-fns/locale";

const recurrenceSchema = z.object({
  description: z.string().min(1, "Descrição é obrigatória"),
  amount: z.number().min(0.01, "Valor deve ser maior que zero"),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().min(1, "Intervalo deve ser pelo menos 1"),
  nextDueDate: z.date({ message: "Data de vencimento é obrigatória" }),
  endDate: z.date().optional().nullable(),
  adjustmentRule: z
    .object({
      type: z.enum(["IPCA", "IGPM", "FIXED"]),
      percentage: z.number().optional(),
      monthToApply: z.number(),
    })
    .optional(),
  costCenterId: z.string().optional(),
  accountId: z.string().optional(),
});

type RecurrenceFormData = z.infer<typeof recurrenceSchema>;

interface EditRecurrenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: RecurringTransactionTemplate | null;
  onSuccess: () => void;
}

export function EditRecurrenceDialog({
  open,
  onOpenChange,
  template,
  onSuccess,
}: EditRecurrenceDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { costCenters } = useCostCenters(
    open ? template?.companyId : undefined,
  );

  // Receita credita a raiz sozinha, e modelo com rateio em vários centros
  // segue sendo editado pelo valor (o gerador reescala a alocação).
  const allocation = template?.baseTransactionData?.costCenterAllocation ?? [];
  const canPickCostCenter =
    template?.type === "payable" && allocation.length <= 1;
  const currentCostCenterId = allocation[0]?.costCenterId;

  // Só folha recebe despesa; arquivado aparece apenas se já é o atual.
  const hierarchical = getHierarchicalCostCenters(costCenters);
  const parentIds = new Set(
    costCenters.map((cc) => cc.parentId).filter(Boolean),
  );
  const costCenterOptions = hierarchical.filter(
    (cc) => !cc.archived || cc.id === currentCostCenterId,
  );

  // Conta do plano: é copiada para cada lançamento gerado, então classificar
  // aqui classifica tudo que a recorrência ainda vai gerar.
  const { accounts, requiredFrom } = useChartOfAccounts(
    open ? template?.companyId : undefined,
  );
  const accountNature = template?.type === "receivable" ? "revenue" : "expense";
  const hasAccounts = accounts.some(
    (a) => a.nature === accountNature && a.type === "analytic",
  );

  const form = useForm<RecurrenceFormData>({
    resolver: zodResolver(recurrenceSchema),
    defaultValues: {
      description: "",
      amount: 0,
      frequency: "monthly",
      interval: 1,
      nextDueDate: new Date(),
      endDate: null,
    },
  });

  useEffect(() => {
    if (template) {
      form.reset({
        description: template.description,
        amount: template.amount,
        frequency: template.frequency,
        interval: template.interval || 1,
        nextDueDate: template.nextDueDate,
        endDate: template.endDate || null,
        adjustmentRule: template.adjustmentRule,
        costCenterId:
          template.baseTransactionData?.costCenterAllocation?.[0]?.costCenterId,
        accountId: template.baseTransactionData?.accountId,
      });
    }
  }, [template, form]);

  const onSubmit = async (data: RecurrenceFormData) => {
    if (!template) return;
    if (canPickCostCenter && !data.costCenterId) {
      form.setError("costCenterId", {
        message: "Selecione o centro de custo",
      });
      return;
    }
    if (
      hasAccounts &&
      !data.accountId &&
      accountRequiredFor(requiredFrom, data.nextDueDate)
    ) {
      form.setError("accountId", {
        message: `Obrigatória para vencimentos a partir de ${requiredFrom}.`,
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const accountChanged =
        (data.accountId ?? null) !==
        (template.baseTransactionData?.accountId ?? null);
      await recurrenceService.updateTemplate(template.id, template.companyId, {
        description: data.description,
        amount: data.amount,
        frequency: data.frequency,
        interval: data.interval,
        nextDueDate: data.nextDueDate,
        endDate: data.endDate || undefined,
        adjustmentRule: data.adjustmentRule,
        // A alocação é regravada com o valor atual mesmo sem trocar o centro:
        // antes a edição mudava só `amount` e a alocação antiga ficava para
        // trás.
        ...((canPickCostCenter || accountChanged) && {
          baseTransactionData: {
            ...template.baseTransactionData,
            accountId: data.accountId,
            ...(canPickCostCenter && {
              costCenterAllocation: [
                {
                  costCenterId: data.costCenterId!,
                  percentage: 100,
                  amount: data.amount,
                },
              ],
            }),
          },
        }),
      });
      toast.success("Recorrência atualizada com sucesso!");
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao atualizar recorrência.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-[500px]">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Editar Recorrência</ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor</FormLabel>
                  <FormControl>
                    <CurrencyInput
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {canPickCostCenter && (
              <FormField
                control={form.control}
                name="costCenterId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Centro de Custo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {costCenterOptions.map((cc) => (
                          <SelectItem
                            key={cc.id}
                            value={cc.id}
                            disabled={parentIds.has(cc.id)}
                          >
                            <span style={{ paddingLeft: `${cc.level * 12}px` }}>
                              {cc.code} — {cc.name}
                              {cc.archived ? " (arquivado)" : ""}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {hasAccounts && (
              <FormField
                control={form.control}
                name="accountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conta do plano de contas</FormLabel>
                    <AccountSelect
                      accounts={accounts}
                      nature={accountNature}
                      value={field.value}
                      onChange={(id) => {
                        field.onChange(id);
                        form.clearErrors("accountId");
                      }}
                      allowClear
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequência</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="daily">Diária</SelectItem>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="yearly">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="interval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Intervalo</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nextDueDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Próximo Vencimento</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP", { locale: ptBR })
                            ) : (
                              <span>Selecione</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <div className="flex items-center justify-between">
                      <FormLabel>Data Final (Opcional)</FormLabel>
                      {field.value && (
                        <button
                          type="button"
                          onClick={() => field.onChange(null)}
                          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP", { locale: ptBR })
                            ) : (
                              <span>Sem data final</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value || undefined}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <ResponsiveModalFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Salvar Alterações
              </Button>
            </ResponsiveModalFooter>
          </form>
        </Form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
