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
  natureFitsSide,
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn, formatCurrency } from "@/lib/utils";
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
  advanceDays: z.number().int().min(0).max(90).optional(),
  amountIsEstimate: z.boolean().optional(),
  costCenterId: z.string().optional(),
  accountId: z.string().optional(),
});

type RecurrenceFormData = z.infer<typeof recurrenceSchema>;

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

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
    (a) => natureFitsSide(a.nature, accountNature) && a.type === "analytic",
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
        advanceDays: template.advanceDays,
        amountIsEstimate: template.amountIsEstimate ?? false,
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

    if (
      data.adjustmentRule?.type === "FIXED" &&
      !data.adjustmentRule.percentage
    ) {
      form.setError("adjustmentRule", {
        message: "Informe o percentual do reajuste.",
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
        advanceDays: data.advanceDays,
        amountIsEstimate: data.amountIsEstimate ?? false,
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

            <FormField
              control={form.control}
              name="amountIsEstimate"
              render={({ field }) => (
                <FormItem className="flex items-start gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={!!field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                      className="mt-0.5"
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="font-normal">
                      O valor muda todo mês
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      O lançamento sai marcado para você confirmar o valor da
                      fatura antes de aprovar.
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="advanceDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Criar o lançamento com antecedência de</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={90}
                        className="w-24"
                        placeholder={template?.type === "payable" ? "7" : "0"}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? undefined
                              : parseInt(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      dias antes do vencimento
                    </span>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="adjustmentRule"
              render={({ field }) => {
                const rule = field.value;
                return (
                  <FormItem className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={!!rule}
                        onCheckedChange={(on) =>
                          field.onChange(
                            on === true
                              ? {
                                  type: "IPCA",
                                  monthToApply:
                                    form.getValues("nextDueDate").getMonth() +
                                    1,
                                }
                              : undefined,
                          )
                        }
                        className="mt-0.5"
                      />
                      <div className="space-y-0.5">
                        <FormLabel className="font-normal">
                          Reajuste anual
                        </FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Aluguel, mensalidade, contrato. O valor sobe sozinho
                          no mês escolhido e o gestor é avisado.
                        </p>
                      </div>
                    </div>
                    {rule && (
                      <div className="grid grid-cols-3 gap-2">
                        <Select
                          value={rule.type}
                          onValueChange={(type) =>
                            field.onChange({
                              ...rule,
                              type,
                              percentage:
                                type === "FIXED" ? rule.percentage : undefined,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="IPCA">IPCA</SelectItem>
                            <SelectItem value="IGPM">IGP-M</SelectItem>
                            <SelectItem value="FIXED">% fixo</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={String(rule.monthToApply)}
                          onValueChange={(m) =>
                            field.onChange({ ...rule, monthToApply: Number(m) })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTHS.map((name, i) => (
                              <SelectItem key={name} value={String(i + 1)}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          placeholder={
                            rule.type === "FIXED" ? "% ao ano" : "Automático"
                          }
                          value={rule.percentage ?? ""}
                          onChange={(e) =>
                            field.onChange({
                              ...rule,
                              percentage:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    )}
                    {rule && rule.type !== "FIXED" && (
                      <p className="text-xs text-muted-foreground">
                        Em branco, usa o acumulado de 12 meses divulgado pelo
                        Banco Central. Se a consulta falhar, o valor segue igual
                        e o lançamento fica marcado para confirmar.
                      </p>
                    )}
                    {template?.lastAdjustment && (
                      <p className="text-xs text-muted-foreground">
                        Último reajuste ({template.lastAdjustment.year}):{" "}
                        {template.lastAdjustment.percentage}%, de{" "}
                        {formatCurrency(template.lastAdjustment.from)} para{" "}
                        {formatCurrency(template.lastAdjustment.to)}.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

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
