"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AccountSelect } from "@/components/features/chart-of-accounts/AccountSelect";
import { Entity, ENTITY_BANK_FIELDS } from "@/lib/types";
import { entityService } from "@/lib/services/entityService";
import { cnpjService } from "@/lib/services/cnpjService";
import { maskCpfCnpj, validateCnpj, validateCpf } from "@/lib/validations/cnpj";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCostCenters } from "@/hooks/useCostCenters";
import { BRAZILIAN_BANKS } from "@/lib/banks";
import { cn, normalizeText } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PIX_KEY_TYPE_LABELS,
  TAX_REGIME_LABELS,
} from "./entityDisplay";

// Item value is "<code> - <name>". Digits search the code by prefix ("1" → 001, 104…); text searches the name.
function filterBank(value: string, search: string) {
  const term = normalizeText(search.trim());
  if (!term) return 1;
  const [code, ...rest] = value.split(" - ");
  if (/^\d+$/.test(term))
    return code.startsWith(term) || code.replace(/^0+/, "").startsWith(term)
      ? 1
      : 0;
  return normalizeText(rest.join(" - ")).includes(term) ? 1 : 0;
}

/** Tipo da chave PIX pelo formato, para não exigir a escolha antes. */
function guessPixKeyType(key: string): Entity["pixKeyType"] | undefined {
  const k = key.trim();
  if (!k) return undefined;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k)) return "email";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k))
    return "random";
  if (k.startsWith("+")) return "phone";
  const d = k.replace(/\D/g, "");
  if (d.length === 14 && validateCnpj(d)) return "cnpj";
  if (d.length === 11 && validateCpf(d)) return "cpf";
  if (d.length >= 10 && d.length <= 13) return "phone";
  return undefined;
}

const percent = z.number().min(0).max(100).nullable().optional();

const entitySchema = z
  .object({
    document: z.string().optional(),
    type: z.enum(["individual", "company"]),
    name: z.string().trim().min(3, "Nome deve ter pelo menos 3 caracteres"),
    tradeName: z.string().optional(),
    category: z.enum(["supplier", "client", "both"]),
    taxRegime: z
      .enum(["mei", "simples", "presumido", "real", "imune"])
      .optional(),
    stateRegistration: z.string().optional(),
    municipalRegistration: z.string().optional(),
    email: z.string().email("E-mail inválido").optional().or(z.literal("")),
    phone: z.string().optional(),
    zipCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    state: z.string().max(2).optional(),

    bankName: z.string().optional(),
    agency: z.string().optional(),
    account: z.string().optional(),
    accountType: z.enum(["checking", "savings"]).optional(),
    pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).optional(),
    pixKey: z.string().optional(),

    defaultAccountId: z.string().optional(),
    defaultCostCenterId: z.string().optional(),
    defaultPaymentMethod: z
      .enum(["pix", "boleto", "transfer", "credit_card", "cash"])
      .optional(),
    paymentTermDays: z.number().int().min(0).max(365).nullable().optional(),
    // null = usar o padrão (2% de multa + 1% a.m.)
    lateFeePercent: percent,
    monthlyInterestPercent: percent,
    withholdings: z.object({
      irrf: percent,
      pcc: percent,
      inss: percent,
      iss: percent,
    }),

    relatedParty: z.boolean().optional(),
    autoConfirmReceipts: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const d = v.document?.replace(/\D/g, "") ?? "";
    if (!d) return;
    const ok =
      d.length === 11 ? validateCpf(d) : d.length === 14 && validateCnpj(d);
    if (!ok) {
      ctx.addIssue({
        code: "custom",
        path: ["document"],
        message:
          d.length === 11
            ? "CPF inválido."
            : d.length === 14
              ? "CNPJ inválido."
              : "Digite 11 dígitos (CPF) ou 14 (CNPJ).",
      });
    }
  });

export type EntityFormData = z.infer<typeof entitySchema>;

const pixPlaceholders: Record<string, string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "chave@exemplo.com",
  phone: "+55 (00) 00000-0000",
  random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
};

const UF =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  );

/** Valores do cadastro no formato do formulário ("" no lugar de ausente). */
function toFormValues(e: Partial<Entity>): EntityFormData {
  return {
    document: e.document ? maskCpfCnpj(e.document) : "",
    type: e.type ?? "company",
    name: e.name ?? "",
    tradeName: e.tradeName ?? "",
    category: e.category ?? "supplier",
    taxRegime: e.taxRegime,
    stateRegistration: e.stateRegistration ?? "",
    municipalRegistration: e.municipalRegistration ?? "",
    email: e.email ?? "",
    phone: e.phone ?? "",
    // Cadastro antigo só tem a linha de endereço: ela vira o logradouro
    zipCode: e.zipCode ?? "",
    street: e.street ?? (e.zipCode || e.city ? "" : (e.address ?? "")),
    number: e.number ?? "",
    complement: e.complement ?? "",
    district: e.district ?? "",
    city: e.city ?? "",
    state: e.state ?? "",
    bankName: e.bankName ?? "",
    agency: e.agency ?? "",
    account: e.account ?? "",
    accountType: e.accountType,
    pixKeyType: e.pixKeyType,
    pixKey: e.pixKey ?? "",
    defaultAccountId: e.defaultAccountId,
    defaultCostCenterId: e.defaultCostCenterId,
    defaultPaymentMethod: e.defaultPaymentMethod,
    paymentTermDays: e.paymentTermDays ?? null,
    lateFeePercent: e.lateFeePercent ?? null,
    monthlyInterestPercent: e.monthlyInterestPercent ?? null,
    withholdings: {
      irrf: e.withholdings?.irrf ?? null,
      pcc: e.withholdings?.pcc ?? null,
      inss: e.withholdings?.inss ?? null,
      iss: e.withholdings?.iss ?? null,
    },
    relatedParty: e.relatedParty ?? false,
    autoConfirmReceipts: e.autoConfirmReceipts ?? false,
  };
}

/** Bloco recolhível com resumo do que está preenchido. */
function Section({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 py-3 text-left"
        >
          <span className="text-sm font-semibold">{title}</span>
          <span className="flex min-w-0 items-center gap-2">
            {!open && summary && (
              <span className="truncate text-xs text-muted-foreground">
                {summary}
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="col-span-12 pt-2 text-sm font-semibold">{children}</h3>;
}

/** Número com vírgula ou ponto; vazio = null. */
function NumberInput({
  value,
  onChange,
  placeholder,
  step = 0.01,
  max = 100,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: number;
  max?: number;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      step={step}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : e.target.valueAsNumber)
      }
      className="font-financial"
    />
  );
}

interface EntityFormProps {
  defaultValues?: Partial<Entity>;
  onSubmit: (data: EntityFormData) => Promise<void>;
  isLoading?: boolean;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Cadastros da empresa, para avisar de nome repetido. */
  existing?: Entity[];
}

export function EntityForm({
  defaultValues,
  onSubmit,
  isLoading,
  onCancel,
  onDirtyChange,
  existing = [],
}: EntityFormProps) {
  const { selectedCompany } = useCompany();
  const isEdit = !!defaultValues?.id;
  const [isCheckingDocument, setIsCheckingDocument] = useState(false);
  const [isCheckingCep, setIsCheckingCep] = useState(false);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const form = useForm<EntityFormData>({
    resolver: zodResolver(entitySchema),
    defaultValues: toFormValues(defaultValues ?? {}),
  });

  const { isDirty } = form.formState;
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const { accounts } = useChartOfAccounts(selectedCompany?.id);
  const { costCenters } = useCostCenters(selectedCompany?.id);
  const leafCostCenters = useMemo(() => {
    const parents = new Set(costCenters.map((c) => c.parentId));
    return costCenters
      .filter((c) => !parents.has(c.id) && !c.archived)
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  }, [costCenters]);

  const documentDigits = (form.watch("document") ?? "").replace(/\D/g, "");
  const category = form.watch("category");
  const type = form.watch("type");
  const taxRegime = form.watch("taxRegime");
  const isCompany = type === "company";
  const nature = category === "client" ? "revenue" : "expense";
  const hasAccounts = accounts.some(
    (a) => a.nature === nature && a.type === "analytic" && !a.archived,
  );

  // O tipo sai do documento: 11 dígitos é pessoa física, 14 é jurídica.
  useEffect(() => {
    if (documentDigits.length === 11) form.setValue("type", "individual");
    if (documentDigits.length === 14) form.setValue("type", "company");
  }, [documentDigits, form]);

  const lastCheckedDocument = useRef("");

  // Runs on blur and as soon as the document is complete.
  // Checks for duplicates; on a new entity with a CNPJ, also fills the form from the Receita Federal.
  const checkDocument = async (raw: string) => {
    const document = raw.replace(/\D/g, "");
    if (!document || !selectedCompany) return;
    if (document === lastCheckedDocument.current) return;
    if (document.length !== 11 && document.length !== 14) return;

    // If we are editing, and the document hasn't changed, don't check
    if (
      defaultValues?.document &&
      defaultValues.document.replace(/\D/g, "") === document
    ) {
      return;
    }
    lastCheckedDocument.current = document;

    const valid =
      document.length === 11 ? validateCpf(document) : validateCnpj(document);
    if (!valid) {
      form.setError("document", {
        type: "manual",
        message: document.length === 11 ? "CPF inválido." : "CNPJ inválido.",
      });
      return;
    }

    setIsCheckingDocument(true);
    try {
      const exists = await entityService.checkCnpjExists(
        selectedCompany.id,
        document,
        defaultValues?.id,
      );
      if (exists) {
        form.setError("document", {
          type: "manual",
          message: "Este documento já está cadastrado.",
        });
        return;
      }
      form.clearErrors("document");
      if (isEdit || document.length !== 14) return;

      const result = await cnpjService.lookup(document);
      if (result.status === "not_found") {
        form.setError("document", {
          type: "manual",
          message: "Este CNPJ não existe na base da Receita Federal.",
        });
      } else if (result.status === "unavailable") {
        toast.warning(
          "Não foi possível consultar o CNPJ agora. Preencha os dados manualmente.",
        );
      } else {
        const { taxRegime: regime, ...data } = result.data;
        for (const [key, value] of Object.entries(data)) {
          if (value) {
            form.setValue(key as "name", value, {
              shouldValidate: key === "name" || key === "email",
              shouldDirty: true,
            });
          }
        }
        if (regime) form.setValue("taxRegime", regime, { shouldDirty: true });
        toast.success("Dados preenchidos a partir da Receita Federal.");
      }
    } finally {
      setIsCheckingDocument(false);
    }
  };

  const checkCep = async (raw: string) => {
    if (raw.replace(/\D/g, "").length !== 8) return;
    setIsCheckingCep(true);
    try {
      const address = await cnpjService.lookupCep(raw);
      if (!address) {
        form.setError("zipCode", {
          type: "manual",
          message: "CEP não encontrado.",
        });
        return;
      }
      form.clearErrors("zipCode");
      for (const [key, value] of Object.entries(address)) {
        if (value) {
          form.setValue(key as "name", value, {
            shouldDirty: true,
          });
        }
      }
    } finally {
      setIsCheckingCep(false);
    }
  };

  // Nome igual (sem acento/caixa) a outro cadastro: aviso, não bloqueio.
  const name = form.watch("name");
  const similar = useMemo(() => {
    const n = normalizeText(name?.trim() ?? "");
    if (n.length < 3) return null;
    return (
      existing.find(
        (e) =>
          e.id !== defaultValues?.id &&
          (normalizeText(e.name) === n ||
            (e.tradeName && normalizeText(e.tradeName) === n)),
      ) ?? null
    );
  }, [name, existing, defaultValues?.id]);

  const pending = defaultValues?.pendingBankChange;
  const values = form.watch();
  const bankSummary =
    [
      values.pixKey && `PIX ${values.pixKey}`,
      values.bankName?.split(" - ")[1],
      values.account && `c/c ${values.account}`,
    ]
      .filter(Boolean)
      .join(" · ") || "Nenhum dado bancário";
  const defaultsSummary =
    [
      values.defaultPaymentMethod &&
        PAYMENT_METHOD_LABELS[values.defaultPaymentMethod],
      values.paymentTermDays != null && `${values.paymentTermDays} dias`,
      values.defaultAccountId &&
        accounts.find((a) => a.id === values.defaultAccountId)?.name,
      values.lateFeePercent != null && `multa ${values.lateFeePercent}%`,
    ]
      .filter(Boolean)
      .join(" · ") || "Sem padrões";
  const w = values.withholdings;
  const withholdingSummary =
    [
      w.irrf != null && `IRRF ${w.irrf}%`,
      w.pcc != null && `PCC ${w.pcc}%`,
      w.inss != null && `INSS ${w.inss}%`,
      w.iss != null && `ISS ${w.iss}%`,
    ]
      .filter(Boolean)
      .join(" · ") || "Sem retenção";

  const bankChanged =
    isEdit &&
    ENTITY_BANK_FIELDS.some(
      (f) => (values[f] ?? "") !== (defaultValues?.[f] ?? ""),
    );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-full flex-col"
      >
        <div className="grid grid-cols-12 gap-x-4 gap-y-4 pb-5">
          <SectionTitle>Identificação</SectionTitle>
          <div className="col-span-12 sm:col-span-5">
            <FormField
              control={form.control}
              name="document"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPF ou CNPJ</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        data-first-field
                        inputMode="numeric"
                        placeholder="Digite só os números"
                        className="font-financial"
                        {...field}
                        onChange={(e) => {
                          const masked = maskCpfCnpj(e.target.value);
                          field.onChange(masked);
                          const len = masked.replace(/\D/g, "").length;
                          if (len === 14) checkDocument(masked);
                        }}
                        onBlur={(e) => {
                          field.onBlur();
                          checkDocument(e.target.value);
                        }}
                      />
                      {isCheckingDocument && (
                        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </FormControl>
                  {!isEdit && !form.formState.errors.document && (
                    <FormDescription className="text-xs">
                      {documentDigits.length === 14
                        ? "Pessoa jurídica"
                        : documentDigits.length === 11
                          ? "Pessoa física"
                          : "Com CNPJ, os dados vêm da Receita Federal."}
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 sm:col-span-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoria</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Sem documento (estrangeiro, cadastro antigo) o tipo é escolhido à mão */}
          {documentDigits.length !== 11 && documentDigits.length !== 14 && (
            <div className="col-span-12 sm:col-span-3">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="company">Pessoa jurídica</SelectItem>
                        <SelectItem value="individual">
                          Pessoa física
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
          )}

          <div className={cn("col-span-12", isCompany && "sm:col-span-7")}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>
                    {isCompany ? "Razão social" : "Nome completo"}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  {similar && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Já existe “{similar.name}”
                      {similar.document &&
                        ` (${maskCpfCnpj(similar.document)})`}
                      . Confira se não é o mesmo cadastro.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {isCompany && (
            <div className="col-span-12 sm:col-span-5">
              <FormField
                control={form.control}
                name="tradeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome fantasia</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          )}

          {isCompany && (
            <>
              <div className="col-span-12 sm:col-span-4">
                <FormField
                  control={form.control}
                  name="taxRegime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Regime tributário</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? ""}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Não informado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(TAX_REGIME_LABELS).map(
                            ([v, label]) => (
                              <SelectItem key={v} value={v}>
                                {label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-6 sm:col-span-4">
                <FormField
                  control={form.control}
                  name="stateRegistration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inscrição estadual</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Isento"
                          className="font-financial"
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <div className="col-span-6 sm:col-span-4">
                <FormField
                  control={form.control}
                  name="municipalRegistration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inscrição municipal</FormLabel>
                      <FormControl>
                        <Input className="font-financial" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </>
          )}

          <SectionTitle>Contato e endereço</SectionTitle>
          <div className="col-span-12 sm:col-span-7">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="contato@exemplo.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-12 sm:col-span-5">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="(00) 00000-0000"
                      className="font-financial"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-5 sm:col-span-3">
            <FormField
              control={form.control}
              name="zipCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CEP</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        inputMode="numeric"
                        placeholder="00000-000"
                        className="font-financial"
                        {...field}
                        onChange={(e) => {
                          const d = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 8);
                          const masked =
                            d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
                          field.onChange(masked);
                          if (d.length === 8) checkCep(d);
                        }}
                      />
                      {isCheckingCep && (
                        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-7 sm:col-span-7">
            <FormField
              control={form.control}
              name="street"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Logradouro</FormLabel>
                  <FormControl>
                    <Input placeholder="Rua, avenida…" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-4 sm:col-span-2">
            <FormField
              control={form.control}
              name="number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Número</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-8 sm:col-span-4">
            <FormField
              control={form.control}
              name="complement"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Complemento</FormLabel>
                  <FormControl>
                    <Input placeholder="Sala, bloco…" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-12 sm:col-span-3">
            <FormField
              control={form.control}
              name="district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bairro</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-8 sm:col-span-3">
            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cidade</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          <div className="col-span-4 sm:col-span-2">
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>UF</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="–" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {UF.map((uf) => (
                        <SelectItem key={uf} value={uf}>
                          {uf}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </div>
        </div>

        <Section
          title="Dados bancários"
          summary={pending ? "Troca pendente de aprovação" : bankSummary}
          defaultOpen={!isEdit || !!pending}
        >
          {pending && (
            <div className="mb-4 flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {pending.requestedByEmail} pediu troca em{" "}
                {format(pending.requestedAt, "dd/MM/yyyy")}. Os campos abaixo
                mostram os dados em uso; a troca é aprovada na página da
                entidade.
              </p>
            </div>
          )}
          {isEdit && (
            <p
              className={cn(
                "mb-4 flex items-start gap-2 text-xs",
                bankChanged
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground",
              )}
            >
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {bankChanged
                ? "Ao salvar, a troca fica pendente até outra pessoa aprovar. Até lá, os pagamentos usam os dados atuais."
                : "Trocar estes dados pede aprovação de outra pessoa."}
            </p>
          )}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 sm:col-span-5">
              <FormField
                control={form.control}
                name="pixKey"
                render={({ field }) => {
                  const pixKeyType = form.watch("pixKeyType");
                  return (
                    <FormItem>
                      <FormLabel>Chave PIX</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={
                            pixKeyType
                              ? pixPlaceholders[pixKeyType]
                              : "CPF, CNPJ, e-mail, telefone ou aleatória"
                          }
                          className="font-financial"
                          {...field}
                          onBlur={(e) => {
                            field.onBlur();
                            const guess = guessPixKeyType(e.target.value);
                            if (guess && !form.getValues("pixKeyType")) {
                              form.setValue("pixKeyType", guess, {
                                shouldDirty: true,
                              });
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
            <div className="col-span-12 sm:col-span-3">
              <FormField
                control={form.control}
                name="pixKeyType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo da chave</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? ""}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Detectado ao digitar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(PIX_KEY_TYPE_LABELS).map(
                          ([v, label]) => (
                            <SelectItem key={v} value={v}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
            <div className="col-span-12 sm:col-span-4" />

            <div className="col-span-12 sm:col-span-6">
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Banco</FormLabel>
                    <Popover
                      open={isBankPickerOpen}
                      onOpenChange={setIsBankPickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            <span className="truncate">
                              {field.value || "Selecione o banco"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                        <Command filter={filterBank}>
                          <CommandInput placeholder="Código ou nome do banco..." />
                          <CommandList
                            onWheel={(e) => {
                              e.stopPropagation();
                              e.currentTarget.scrollTop += e.deltaY;
                            }}
                          >
                            <CommandEmpty>
                              Nenhum banco encontrado.
                            </CommandEmpty>
                            <CommandGroup>
                              {BRAZILIAN_BANKS.map((bank) => {
                                const value = `${bank.code} - ${bank.name}`;
                                return (
                                  <CommandItem
                                    key={bank.code}
                                    value={value}
                                    onSelect={() => {
                                      field.onChange(value);
                                      setIsBankPickerOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        field.value === value
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                    <span className="mr-2 font-mono text-muted-foreground">
                                      {bank.code}
                                    </span>
                                    {bank.name}
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
            </div>
            <div className="col-span-4 sm:col-span-2">
              <FormField
                control={form.control}
                name="agency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agência</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="0000"
                        className="font-financial"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <div className="col-span-8 sm:col-span-4">
              <FormField
                control={form.control}
                name="account"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conta</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          placeholder="00000-0"
                          className="font-financial"
                          {...field}
                        />
                      </FormControl>
                      <Select
                        onValueChange={(v) =>
                          form.setValue(
                            "accountType",
                            v as "checking" | "savings",
                            { shouldDirty: true },
                          )
                        }
                        value={form.watch("accountType") ?? ""}
                      >
                        <SelectTrigger
                          className="w-32 shrink-0"
                          aria-label="Tipo de conta"
                        >
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="checking">Corrente</SelectItem>
                          <SelectItem value="savings">Poupança</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Padrões para lançamentos"
          summary={defaultsSummary}
          defaultOpen={!isEdit}
        >
          <p className="mb-4 text-xs text-muted-foreground">
            Preenchem a conta nova deste cadastro. O que vier do documento ou
            for digitado tem prioridade.
          </p>
          <div className="grid grid-cols-12 gap-4">
            {hasAccounts && (
              <div className="col-span-12 sm:col-span-6">
                <FormField
                  control={form.control}
                  name="defaultAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Conta do plano</FormLabel>
                      <FormControl>
                        <AccountSelect
                          accounts={accounts}
                          nature={nature}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Nenhuma"
                          allowClear
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            )}
            {category !== "client" && leafCostCenters.length > 0 && (
              <div className="col-span-12 sm:col-span-6">
                <FormField
                  control={form.control}
                  name="defaultCostCenterId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Centro de custo</FormLabel>
                      <Select
                        onValueChange={(v) =>
                          field.onChange(v === "none" ? undefined : v)
                        }
                        value={field.value ?? "none"}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Nenhum</SelectItem>
                          {leafCostCenters.map((cc) => (
                            <SelectItem key={cc.id} value={cc.id}>
                              <span className="font-financial text-muted-foreground">
                                {cc.code}
                              </span>{" "}
                              {cc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>
            )}
            <div className="col-span-7 sm:col-span-4">
              <FormField
                control={form.control}
                name="defaultPaymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Forma de pagamento</FormLabel>
                    <Select
                      onValueChange={(v) =>
                        field.onChange(v === "none" ? undefined : v)
                      }
                      value={field.value ?? "none"}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {Object.entries(PAYMENT_METHOD_LABELS).map(
                          ([v, label]) => (
                            <SelectItem key={v} value={v}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
            <div className="col-span-5 sm:col-span-2">
              <FormField
                control={form.control}
                name="paymentTermDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prazo (dias)</FormLabel>
                    <FormControl>
                      <NumberInput
                        value={field.value}
                        onChange={field.onChange}
                        step={1}
                        max={365}
                        placeholder="30"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <FormField
                control={form.control}
                name="lateFeePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Multa (%)</FormLabel>
                    <FormControl>
                      <NumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="2"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <FormField
                control={form.control}
                name="monthlyInterestPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Juros (% a.m.)</FormLabel>
                    <FormControl>
                      <NumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="1"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="col-span-12 -mt-2 text-xs text-muted-foreground">
              O prazo sugere o vencimento a partir do dia do lançamento. Multa e
              juros corrigem contas vencidas; em branco, vale 2% e 1% ao mês.
            </p>
          </div>
        </Section>

        {category !== "client" && (
          <Section title="Retenções na fonte" summary={withholdingSummary}>
            <p className="mb-4 text-xs text-muted-foreground">
              {taxRegime === "simples" || taxRegime === "mei"
                ? "Optante pelo Simples: em regra não sofre retenção de PIS/COFINS/CSLL (IN RFB 459/2004); IRRF e ISS dependem do serviço."
                : "Alíquotas retidas ao pagar este fornecedor. Em branco, não retém."}
            </p>
            <div className="grid grid-cols-12 gap-4">
              {(
                [
                  ["irrf", "IRRF (%)", "1,5"],
                  ["pcc", "PIS/COFINS/CSLL (%)", "4,65"],
                  ["inss", "INSS (%)", "11"],
                  ["iss", "ISS (%)", "5"],
                ] as const
              ).map(([key, label, placeholder]) => (
                <div key={key} className="col-span-6 sm:col-span-3">
                  <FormField
                    control={form.control}
                    name={`withholdings.${key}`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{label}</FormLabel>
                        <FormControl>
                          <NumberInput
                            value={field.value}
                            onChange={field.onChange}
                            placeholder={placeholder}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </div>
          </Section>
        )}

        <div className="space-y-4 border-t pt-4 pb-5">
          <FormField
            control={form.control}
            name="relatedParty"
            render={({ field }) => (
              <FormItem className="flex-row items-start gap-3">
                <FormControl>
                  <Checkbox
                    className="mt-0.5"
                    checked={!!field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                  />
                </FormControl>
                <div className="space-y-0.5">
                  <FormLabel>Parte relacionada</FormLabel>
                  <FormDescription className="text-xs">
                    Mantenedora, coligada, dirigente ou empresa ligada à
                    organização. Aparece destacada na cobrança e nos alertas de
                    caixa, porque esses valores pedem divulgação à parte.
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
          {category !== "client" && (
            <FormField
              control={form.control}
              name="autoConfirmReceipts"
              render={({ field }) => (
                <FormItem className="flex-row items-start gap-3">
                  <FormControl>
                    <Checkbox
                      className="mt-0.5"
                      checked={!!field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel>
                      Confirmar comprovantes automaticamente
                    </FormLabel>
                    <FormDescription className="text-xs">
                      Comprovante deste fornecedor com valor exato, sem empate e
                      sem divergência é associado sem revisão, mesmo quando só o
                      nome aparece. Cada associação fica na auditoria.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="sticky bottom-0 mt-auto flex justify-end gap-2 border-t bg-background py-3">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancelar
            </Button>
          )}
          <Button type="submit" loading={isLoading}>
            {isEdit ? "Salvar alterações" : "Cadastrar"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
