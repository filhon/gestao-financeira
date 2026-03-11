"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  TransactionFormData,
  transactionSchema,
} from "@/lib/validations/transaction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Check,
  ChevronsUpDown,
  FolderTree,
  ChevronRight,
} from "lucide-react";
import { CostCenter } from "@/lib/types";
import { storageService } from "@/lib/services/storageService";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  costCenterService,
  getHierarchicalCostCenters,
} from "@/lib/services/costCenterService";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { entityService } from "@/lib/services/entityService";
import { Entity } from "@/lib/types";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useDocumentExtraction } from "@/hooks/useDocumentExtraction";
import { toast } from "sonner";

interface TransactionFormProps {
  defaultValues?: Partial<TransactionFormData>;
  onSubmit: (data: TransactionFormData) => Promise<void>;
  isLoading: boolean;
  onCancel: () => void;
  type: "payable" | "receivable";
}

export function TransactionForm({
  defaultValues,
  onSubmit,
  isLoading,
  onCancel,
  type,
}: TransactionFormProps) {
  const { selectedCompany } = useCompany();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [costCenterBalances, setCostCenterBalances] = useState<
    Record<string, number>
  >({});
  const [isUploading, setIsUploading] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [useEntity, setUseEntity] = useState(true);
  const [openEntityCombobox, setOpenEntityCombobox] = useState(false);
  const [balanceWarning, setBalanceWarning] = useState<string | null>(null);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [openCostCenterCombobox, setOpenCostCenterCombobox] = useState<
    number | null
  >(null);
  const { extractFromFile, isExtracting } = useDocumentExtraction();

  useEffect(() => {
    const loadEntities = async () => {
      if (selectedCompany) {
        const category = type === "payable" ? "supplier" : "client";
        const data = await entityService.getAll(selectedCompany.id, category);
        setEntities(data);
      }
    };
    loadEntities();
  }, [selectedCompany, type]);

  const form = useForm<TransactionFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(transactionSchema) as any,
    defaultValues: {
      type,
      status: "draft",
      recurrence: {
        isRecurring: false,
        frequency: "monthly",
        interval: 1,
        intervalUnit: "months",
      },
      installmentsCount: 2,
      useInstallments: false,
      costCenterAllocation: [{ costCenterId: "", percentage: 100, amount: 0 }],
      attachments: [],
      description: "",
      amount: 0,
      paymentMethod: undefined,
      supplierOrClient: "",
      entityId: undefined,
      requestOrigin: { type: undefined, name: "" },
      ...defaultValues,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "costCenterAllocation",
  });

  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment,
  } = useFieldArray({
    control: form.control,
    name: "attachments",
  });

  const { user } = useAuth();
  const { onlyOwnPayables } = usePermissions();

  // Watch dueDate to get the year for balance calculation
  const watchedDueDate = form.watch("dueDate");
  const balanceYear = watchedDueDate
    ? new Date(watchedDueDate).getFullYear()
    : new Date().getFullYear();

  useEffect(() => {
    const loadCostCenters = async () => {
      if (selectedCompany && user) {
        // For 'user' role, pass forUserId to filter in Firestore query
        // This matches Firestore rules and prevents permission errors
        const forUserId = onlyOwnPayables ? user.uid : undefined;
        const data = await costCenterService.getAll(
          selectedCompany.id,
          forUserId,
        );
        setCostCenters(data);

        // Load balances for payables (to show in dropdown) - filtered by year
        if (type === "payable") {
          // Optimized: Fetch all balances at once
          const forUserId = onlyOwnPayables ? user.uid : undefined;
          const balances = await costCenterService.getAllBalances(
            selectedCompany.id,
            data,
            balanceYear,
            forUserId,
          );
          setCostCenterBalances(balances);
        }
      }
    };
    loadCostCenters();
  }, [selectedCompany, user, onlyOwnPayables, type, balanceYear]);

  // Update allocation amounts when total amount changes
  const totalAmount = form.watch("amount");
  const allocations = form.watch("costCenterAllocation");

  // Check balance warning for payables
  useEffect(() => {
    if (type === "payable" && allocations && totalAmount > 0) {
      let warning = null;
      for (const alloc of allocations) {
        if (alloc.costCenterId && alloc.amount > 0) {
          const available = costCenterBalances[alloc.costCenterId] || 0;
          if (alloc.amount > available) {
            const ccName =
              costCenters.find((cc) => cc.id === alloc.costCenterId)?.name ||
              "Centro de Custo";
            warning = `Saldo insuficiente em "${ccName}". Disponível: ${formatCurrency(available)} | Necessário: ${formatCurrency(alloc.amount)}`;
            break;
          }
        }
      }
      setBalanceWarning(warning);
    } else {
      setBalanceWarning(null);
    }
  }, [allocations, totalAmount, costCenterBalances, costCenters, type]);

  useEffect(() => {
    if (totalAmount) {
      const allocations = form.getValues("costCenterAllocation");
      const updatedAllocations = allocations.map((a) => ({
        ...a,
        amount: (totalAmount * a.percentage) / 100,
      }));
      form.setValue("costCenterAllocation", updatedAllocations);
    }
  }, [totalAmount, form]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      try {
        setIsUploading(true);
        const file = e.target.files[0];

        if (!selectedCompany) return;

        // Iniciar upload e extração IA em paralelo
        const isFirstAttachment = attachmentFields.length === 0;
        const canExtract =
          isFirstAttachment &&
          !form.getValues("description") &&
          !form.getValues("amount") &&
          type === "payable";

        const uploadPromise = storageService.uploadFile(
          file,
          `transactions/${selectedCompany.id}`,
        );

        const extractPromise = canExtract
          ? extractFromFile(file, selectedCompany.id)
          : Promise.resolve(null);

        const [uploadedFile, extractionResult] = await Promise.all([
          uploadPromise,
          extractPromise,
        ]);

        appendAttachment({
          id: uploadedFile.id,
          url: uploadedFile.url,
          name: uploadedFile.name,
          type: uploadedFile.type,
          category: "invoice",
        });

        // Preencher campos com dados extraídos pela IA
        if (extractionResult?.data) {
          const { data, matchedEntity } = extractionResult;
          const filled = new Set<string>();

          if (data.description) {
            form.setValue("description", data.description);
            filled.add("description");
          }
          if (data.amount) {
            form.setValue("amount", data.amount);
            filled.add("amount");
          }
          if (data.dueDate) {
            form.setValue("dueDate", new Date(data.dueDate + "T12:00:00"));
            filled.add("dueDate");
          }
          if (data.paymentMethod) {
            form.setValue("paymentMethod", data.paymentMethod);
            filled.add("paymentMethod");
          }

          if (matchedEntity) {
            setUseEntity(true);
            form.setValue("entityId", matchedEntity.id);
            form.setValue("supplierOrClient", matchedEntity.name as string);
            filled.add("supplierOrClient");
          } else if (data.supplierName) {
            setUseEntity(false);
            form.setValue("supplierOrClient", data.supplierName);
            filled.add("supplierOrClient");
          }

          if (data.notes) {
            form.setValue("notes", data.notes);
          }
          if (data.barcode) {
            form.setValue("barcode", data.barcode);
          }

          setAiFilledFields(filled);
          setTimeout(() => setAiFilledFields(new Set()), 5000);

          if (data.confidence >= 50) {
            toast.success("Dados extraídos do documento com IA", {
              description: `Confiança: ${data.confidence}% — Confira os campos preenchidos.`,
            });
          } else {
            toast.warning("Extração com baixa confiança", {
              description: `Confiança: ${data.confidence}% — Verifique todos os campos manualmente.`,
            });
          }
        }
      } catch (error) {
        console.error("Upload failed", error);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const hierarchicalCostCenters = getHierarchicalCostCenters(costCenters);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, (errors) =>
          console.error("Validation Errors:", errors),
        )}
        className="space-y-6"
      >
        {/* Main Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Informações Principais</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-12 gap-6">
            <div className="col-span-12 md:col-span-8">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      Descrição
                      {aiFilledFields.has("description") && (
                        <Sparkles className="h-3.5 w-3.5 text-violet-500 animate-pulse" />
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Pagamento AWS" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-12 md:col-span-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      Valor Total (R$)
                      {aiFilledFields.has("amount") && (
                        <Sparkles className="h-3.5 w-3.5 text-violet-500 animate-pulse" />
                      )}
                    </FormLabel>
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
            </div>

            <div className="col-span-12 md:col-span-6">
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      Forma de Pagamento
                      {aiFilledFields.has("paymentMethod") && (
                        <Sparkles className="h-3.5 w-3.5 text-violet-500 animate-pulse" />
                      )}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="boleto">Boleto</SelectItem>
                        <SelectItem value="transfer">Transferência</SelectItem>
                        <SelectItem value="credit_card">
                          Cartão de Crédito
                        </SelectItem>
                        <SelectItem value="cash">Dinheiro</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-12 md:col-span-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <FormLabel className="flex items-center gap-1.5">
                    {type === "payable" ? "Fornecedor" : "Cliente"}
                    {aiFilledFields.has("supplierOrClient") && (
                      <Sparkles className="h-3.5 w-3.5 text-violet-500 animate-pulse" />
                    )}
                  </FormLabel>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="useEntity"
                      checked={useEntity}
                      onCheckedChange={(checked) => {
                        setUseEntity(!!checked);
                        if (checked) {
                          form.setValue("supplierOrClient", "");
                        } else {
                          form.setValue("entityId", undefined);
                        }
                      }}
                    />
                    <label
                      htmlFor="useEntity"
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      Usar Cadastros
                    </label>
                  </div>
                </div>

                {useEntity ? (
                  <FormField
                    control={form.control}
                    name="entityId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <Popover
                          open={openEntityCombobox}
                          onOpenChange={setOpenEntityCombobox}
                        >
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between",
                                  !field.value && "text-muted-foreground",
                                )}
                              >
                                <span className="truncate">
                                  {field.value
                                    ? entities.find(
                                        (entity) => entity.id === field.value,
                                      )?.name
                                    : "Selecione..."}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                              <CommandInput placeholder="Buscar..." />
                              <CommandList
                                onWheel={(e) => {
                                  e.stopPropagation();
                                  const target = e.currentTarget;
                                  target.scrollTop += e.deltaY;
                                }}
                              >
                                <CommandEmpty>
                                  Nenhuma entidade encontrada.
                                </CommandEmpty>
                                <CommandGroup>
                                  {entities.map((entity) => (
                                    <CommandItem
                                      value={entity.name}
                                      key={entity.id}
                                      onSelect={() => {
                                        form.setValue("entityId", entity.id);
                                        form.setValue(
                                          "supplierOrClient",
                                          entity.name,
                                        );
                                        setOpenEntityCombobox(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          entity.id === field.value
                                            ? "opacity-100"
                                            : "opacity-0",
                                        )}
                                      />
                                      {entity.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="supplierOrClient"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            placeholder="Nome da empresa ou pessoa"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>

            <div className="col-span-12 grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="flex items-center gap-1.5">
                      Vencimento
                      {aiFilledFields.has("dueDate") && (
                        <Sparkles className="h-3.5 w-3.5 text-violet-500 animate-pulse" />
                      )}
                    </FormLabel>
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
                          defaultMonth={field.value}
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
                name="requestOrigin.type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo Origem</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="department">Depto.</SelectItem>
                        <SelectItem value="sector">Setor</SelectItem>
                        <SelectItem value="director">Diretoria</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="requestOrigin.name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome Origem</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Marketing" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Repetition / Installments */}
          <Card className="flex flex-col h-full">
            <CardHeader>
              <CardTitle className="text-base">
                Repetição e Parcelamento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 flex-1">
              <FormItem>
                <FormLabel>Tipo de Lançamento</FormLabel>
                <Select
                  onValueChange={(value) => {
                    if (value === "single") {
                      form.setValue("recurrence.isRecurring", false);
                      form.setValue("useInstallments", false);
                    } else if (value === "recurring") {
                      form.setValue("recurrence.isRecurring", true);
                      form.setValue("useInstallments", false);
                    } else if (value === "installment") {
                      form.setValue("recurrence.isRecurring", false);
                      form.setValue("useInstallments", true);
                    }
                  }}
                  defaultValue={
                    form.getValues("useInstallments")
                      ? "installment"
                      : form.getValues("recurrence.isRecurring")
                        ? "recurring"
                        : "single"
                  }
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="single">Única</SelectItem>
                    <SelectItem value="recurring">
                      Recorrente (Assinatura)
                    </SelectItem>
                    <SelectItem value="installment">Parcelada</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>

              {form.watch("recurrence.isRecurring") && (
                <div className="space-y-4 pt-2">
                  <FormField
                    control={form.control}
                    name="recurrence.frequency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Frequência</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value || "monthly"}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="weekly">Semanal</SelectItem>
                            <SelectItem value="monthly">Mensal</SelectItem>
                            <SelectItem value="yearly">Anual</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {form.watch("useInstallments") && (
                <div className="space-y-4 pt-2">
                  <FormField
                    control={form.control}
                    name="installmentsCount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número de Parcelas</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="2"
                            max="120"
                            {...field}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          Serão geradas {field.value || 0} transações.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card className="flex flex-col h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Anexos</CardTitle>
              <div>
                <Input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    document.getElementById("file-upload")?.click()
                  }
                  disabled={isUploading || isExtracting}
                >
                  {isUploading || isExtracting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {isExtracting ? "Analisando..." : "Upload"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="space-y-2">
                {attachmentFields.length === 0 && !isExtracting && (
                  <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md h-full flex items-center justify-center">
                    {type === "payable"
                      ? "Anexe um boleto ou fatura para preencher os campos automaticamente com IA."
                      : "Nenhum anexo."}
                  </div>
                )}
                {isExtracting && (
                  <div className="text-sm text-center py-4 border border-dashed rounded-md h-full flex flex-col items-center justify-center gap-2 border-violet-300 bg-violet-50 dark:bg-violet-950/20">
                    <Sparkles className="h-5 w-5 text-violet-500 animate-pulse" />
                    <span className="text-violet-600 dark:text-violet-400 font-medium">
                      Analisando documento com IA...
                    </span>
                  </div>
                )}
                {attachmentFields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between p-2 border rounded bg-muted/50"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="text-sm font-medium truncate max-w-[150px]">
                        {field.name}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAttachment(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cost Center Allocation */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">
              Rateio por Centro de Custo
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({ costCenterId: "", percentage: 0, amount: 0 })
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-[1fr_1fr_auto] gap-4 items-end"
                >
                  <FormField
                    control={form.control}
                    name={`costCenterAllocation.${index}.costCenterId`}
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className={index !== 0 ? "sr-only" : ""}>
                          Centro de Custo
                        </FormLabel>
                        <Popover
                          open={openCostCenterCombobox === index}
                          onOpenChange={(open) =>
                            setOpenCostCenterCombobox(open ? index : null)
                          }
                        >
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between font-normal",
                                  !field.value && "text-muted-foreground",
                                )}
                              >
                                <span className="truncate">
                                  {field.value
                                    ? (() => {
                                        const cc = hierarchicalCostCenters.find(
                                          (c) => c.id === field.value,
                                        );
                                        if (!cc) return "Selecione...";
                                        const balance =
                                          costCenterBalances[cc.id];
                                        return `${cc.level > 0 ? "↳ " : ""}${cc.name}${type === "payable" && balance !== undefined ? ` (${formatCurrency(balance)})` : ""}`;
                                      })()
                                    : "Selecione..."}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[--radix-popover-trigger-width] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Buscar centro de custo..." />
                              <CommandList
                                onWheel={(e) => {
                                  e.stopPropagation();
                                  const target = e.currentTarget;
                                  target.scrollTop += e.deltaY;
                                }}
                              >
                                <CommandEmpty>
                                  Nenhum centro de custo encontrado.
                                </CommandEmpty>
                                <CommandGroup>
                                  {hierarchicalCostCenters.map((cc) => {
                                    const balance = costCenterBalances[cc.id];
                                    const isSelected = field.value === cc.id;
                                    return (
                                      <CommandItem
                                        key={cc.id}
                                        value={`${cc.name} ${cc.code}`}
                                        onSelect={() => {
                                          field.onChange(cc.id);
                                          setOpenCostCenterCombobox(null);
                                        }}
                                        className="flex items-center gap-0"
                                      >
                                        <div
                                          className="flex items-center gap-1.5 w-full"
                                          style={{
                                            paddingLeft: `${cc.level * 16}px`,
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "h-4 w-4 shrink-0",
                                              isSelected
                                                ? "opacity-100"
                                                : "opacity-0",
                                            )}
                                          />
                                          {cc.level > 0 ? (
                                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                          ) : (
                                            <FolderTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                          )}
                                          <span className="truncate">
                                            {cc.name}
                                          </span>
                                          {type === "payable" &&
                                            balance !== undefined && (
                                              <span
                                                className={cn(
                                                  "ml-auto text-xs shrink-0",
                                                  balance > 0
                                                    ? "text-green-600"
                                                    : "text-muted-foreground",
                                                )}
                                              >
                                                {formatCurrency(balance)}
                                              </span>
                                            )}
                                        </div>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`costCenterAllocation.${index}.percentage`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={index !== 0 ? "sr-only" : ""}>
                          %
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(e) => {
                              field.onChange(parseFloat(e.target.value));
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className={cn("pb-0", index === 0 ? "pb-2" : "")}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
              <FormMessage>
                {form.formState.errors.costCenterAllocation?.root?.message}
              </FormMessage>

              {/* Balance Warning */}
              {balanceWarning && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {balanceWarning}
                    <br />
                    <span className="text-xs">
                      Solicite alocação de recursos ao gestor financeiro para
                      continuar.
                    </span>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar Transação
          </Button>
        </div>
      </form>
    </Form>
  );
}
