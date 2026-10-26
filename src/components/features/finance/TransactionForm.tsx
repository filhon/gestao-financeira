"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import currency from "currency.js";
import {
  useForm,
  useFieldArray,
  type FieldErrors,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  addDays,
  addMonths,
  startOfDay,
  differenceInCalendarDays,
  format,
  isValid,
  parse,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Barcode,
  CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  FolderTree,
  History,
  Loader2,
  Plus,
  Trash2,
  Upload,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  TransactionFormData,
  transactionSchema,
} from "@/lib/validations/transaction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn, formatCurrency } from "@/lib/utils";
import { storageService } from "@/lib/services/storageService";
import { entityService } from "@/lib/services/entityService";
import { transactionService } from "@/lib/services/transactionService";
import { getHierarchicalCostCenters } from "@/lib/services/costCenterService";
import { formatBoletoLine, parseBoleto } from "@/lib/boleto";
import { amountsFromPercent, evenPercentages } from "@/lib/allocation";
import { Entity, Transaction } from "@/lib/types";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useCostCenterBalances, useCostCenters } from "@/hooks/useCostCenters";
import { useDocumentExtraction } from "@/hooks/useDocumentExtraction";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import {
  accountRequiredFor,
  useChartOfAccounts,
} from "@/hooks/useChartOfAccounts";
import { AccountSelect } from "@/components/features/chart-of-accounts/AccountSelect";

type Allocation = TransactionFormData["costCenterAllocation"][number];
type PaymentMethod = NonNullable<TransactionFormData["paymentMethod"]>;

/** De onde veio um valor que o usuário não digitou. */
type FillSource = "document" | "boleto" | "history" | "entity";
const SOURCE: Record<FillSource, { label: string; Icon: typeof FileText }> = {
  document: { label: "Lido do documento", Icon: FileText },
  boleto: { label: "Lido da linha digitável", Icon: Barcode },
  history: { label: "Sugerido pelo último lançamento", Icon: History },
  entity: { label: "Padrão do cadastro", Icon: UserCheck },
};

/** Valor lido de uma fonte que diverge do que o usuário já preencheu. */
type Suggestion = {
  value: unknown;
  display: string;
  diff?: string;
  /** "no documento", "no boleto". */
  where: string;
};
const SUGGESTION_LABEL: Record<string, string> = {
  amount: "Valor",
  dueDate: "Vencimento",
  paymentMethod: "Forma de pagamento",
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "PIX",
  boleto: "Boleto",
  transfer: "Transferência",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
};

type Repetition = "single" | "installment" | "recurring";
const REPETITIONS: Repetition[] = ["single", "installment", "recurring"];
const REPETITION_LABEL: Record<Repetition, string> = {
  single: "Única",
  installment: "Parcelada",
  recurring: "Recorrente",
};

/** Campos de data com digitação própria: texto inválido vira erro do formulário. */
type TypedDateField = "dueDate" | "competence" | "recurrence.endDate";
const TYPED_DATE_MESSAGE: Record<TypedDateField, string> = {
  dueDate: "Data inválida. Use dd/mm/aaaa.",
  competence: "Mês inválido. Use mm/aaaa.",
  "recurrence.endDate": "Data inválida. Use dd/mm/aaaa.",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const isAcceptedFile = (f: File) =>
  f.type === "application/pdf" || f.type.startsWith("image/");

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** Meio-dia local: a data não escorrega de dia por fuso, como no boleto. */
const noon = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);

/** Mensagens das folhas de erro (o `ref` de cada uma não é percorrido). */
function errorMessages(e: unknown): string[] {
  if (!e || typeof e !== "object") return [];
  if ("type" in e && "message" in e) {
    return [String((e as { message?: unknown }).message ?? "")];
  }
  return Object.values(e).flatMap(errorMessages);
}

/** Rótulo com a mesma tipografia do FormLabel, para grupos sem um campo só. */
const groupLabelClass =
  "flex items-center gap-1.5 text-sm font-medium leading-none";

function RequiredMark() {
  return (
    <>
      <span className="text-muted-foreground" aria-hidden="true">
        *
      </span>
      <span className="sr-only">(obrigatório)</span>
    </>
  );
}

/**
 * dd/mm/aaaa (ou dd/mm/aa) digitado, ou escolhido no calendário.
 *
 * Texto que não forma data vira `undefined` no formulário e avisa por
 * `onBadInput`; quem decide a mensagem é o formulário. O texto digitado fica
 * na tela até ser corrigido ou até o valor mudar por fora (documento, boleto).
 */
function DateField({
  value,
  onChange,
  onBadInput,
  id,
  invalid,
}: {
  value?: Date;
  onChange: (d: Date | undefined) => void;
  onBadInput: (bad: boolean) => void;
  id?: string;
  invalid?: boolean;
}) {
  const shown = value ? format(value, "dd/MM/yyyy") : "";
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  // Último valor que o próprio campo emitiu: só o que vem de fora reescreve o texto.
  const [emitted, setEmitted] = useState(shown);
  const [prevShown, setPrevShown] = useState(shown);
  if (shown !== prevShown) {
    setPrevShown(shown);
    if (shown !== emitted) {
      setText(shown);
      setEmitted(shown);
    }
  }

  const emit = (d: Date | undefined, bad = false) => {
    const next = d ? format(d, "dd/MM/yyyy") : "";
    if (!bad) setText(next);
    setEmitted(next);
    onBadInput(bad);
    onChange(d);
  };

  const commit = (masked: string) => {
    const d = onlyDigits(masked);
    if (d.length === 0) return emit(undefined);
    const parsed =
      d.length === 8
        ? parse(masked, "dd/MM/yyyy", new Date())
        : d.length === 6
          ? parse(masked, "dd/MM/yy", new Date())
          : null;
    if (parsed && isValid(parsed)) emit(noon(parsed));
    else emit(undefined, true);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        aria-invalid={invalid}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={text}
        onChange={(e) => {
          const d = onlyDigits(e.target.value).slice(0, 8);
          const masked = [d.slice(0, 2), d.slice(2, 4), d.slice(4)]
            .filter(Boolean)
            .join("/");
          setText(masked);
          if (d.length === 8) commit(masked);
        }}
        onBlur={() => {
          if (text !== shown) commit(text);
        }}
        className="pr-9 font-financial"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Abrir calendário"
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              emit(d ? noon(d) : undefined);
              setOpen(false);
            }}
            defaultMonth={value}
            locale={ptBR}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** mm/aaaa digitado; o valor do formulário é "yyyy-MM". Mesmas regras do DateField. */
function MonthField({
  value,
  onChange,
  onBadInput,
  id,
  invalid,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
  onBadInput: (bad: boolean) => void;
  id?: string;
  invalid?: boolean;
}) {
  const toText = (v?: string) => (v ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : "");
  const shown = toText(value);
  const [text, setText] = useState(shown);
  const [emitted, setEmitted] = useState(shown);
  const [prevShown, setPrevShown] = useState(shown);
  if (shown !== prevShown) {
    setPrevShown(shown);
    if (shown !== emitted) {
      setText(shown);
      setEmitted(shown);
    }
  }

  const emit = (v: string | undefined, bad = false) => {
    if (!bad) setText(toText(v));
    setEmitted(toText(v));
    onBadInput(bad);
    onChange(v);
  };

  const commit = (masked: string) => {
    const d = onlyDigits(masked);
    const month = Number(d.slice(0, 2));
    if (d.length === 0) emit(undefined);
    else if (d.length === 6 && month >= 1 && month <= 12) {
      emit(`${d.slice(2)}-${d.slice(0, 2)}`);
    } else emit(undefined, true);
  };

  return (
    <Input
      id={id}
      aria-invalid={invalid}
      inputMode="numeric"
      placeholder="mm/aaaa"
      value={text}
      onChange={(e) => {
        const d = onlyDigits(e.target.value).slice(0, 6);
        const masked = [d.slice(0, 2), d.slice(2)].filter(Boolean).join("/");
        setText(masked);
        if (d.length === 6) commit(masked);
      }}
      onBlur={() => {
        if (text !== shown) commit(text);
      }}
      className="font-financial"
    />
  );
}

/** Marca de origem: ícone na cor de "preenchido pela máquina", com texto para leitor de tela. */
function FillMark({ source }: { source?: FillSource }) {
  if (!source) return null;
  const { label, Icon } = SOURCE[source];
  return (
    <span title={label} className="inline-flex text-sky-600 dark:text-sky-400">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * - `create`: lançamento novo pela tela de contas. Repetição, rascunho ou
 *   aprovação, "criar outra".
 * - `reconcile`: lançamento novo a partir do extrato, já baixado.
 * - `edit`: alteração de um lançamento existente.
 */
type FormVariant = "create" | "reconcile" | "edit";

interface TransactionFormProps {
  defaultValues?: Partial<TransactionFormData>;
  /**
   * `keepOpen`: o usuário pediu para criar outra em seguida. Devolver `false`
   * diz que a gravação falhou, e o formulário não é limpo.
   */
  onSubmit: (
    data: TransactionFormData,
    options: { keepOpen: boolean },
  ) => Promise<boolean | void>;
  isLoading: boolean;
  onCancel: () => void;
  type: "payable" | "receivable";
  variant?: FormVariant;
  onDirtyChange?: (dirty: boolean) => void;
}

export function TransactionForm({
  defaultValues,
  onSubmit,
  isLoading,
  onCancel,
  type,
  variant = "edit",
  onDirtyChange,
}: TransactionFormProps) {
  const isPayable = type === "payable";
  const isCreate = variant === "create";
  const isNewRecord = variant !== "edit";
  const counterpartLabel = isPayable ? "Fornecedor" : "Cliente";
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { onlyOwnPayables, canViewReconciliation } = usePermissions();
  // O papel `user` só lê o que ele mesmo lançou: as consultas precisam dizer isso.
  const ownOnly = onlyOwnPayables ? user?.uid : undefined;

  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const duplicateRef = useRef<HTMLDivElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [extraction, setExtraction] = useState<{ confidence: number } | null>(
    null,
  );
  const [entities, setEntities] = useState<Entity[]>([]);
  const [useEntity, setUseEntity] = useState(
    () => !(defaultValues?.supplierOrClient && !defaultValues?.entityId),
  );
  const [openEntityCombobox, setOpenEntityCombobox] = useState(false);
  const [entitySearch, setEntitySearch] = useState("");
  const [openCostCenterCombobox, setOpenCostCenterCombobox] = useState<
    number | null
  >(null);
  const [balanceWarning, setBalanceWarning] = useState<string | null>(null);
  const [autoFilled, setAutoFilled] = useState<Record<string, FillSource>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>(
    {},
  );
  const [duplicate, setDuplicate] = useState<{
    transaction: Transaction;
    reason: string;
  } | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const duplicateAcknowledged = useRef(false);
  // Cada checagem leva um número; resposta de checagem antiga é descartada.
  const duplicateToken = useRef(0);
  const [keepOpen, setKeepOpen] = useState(false);
  // Remonta os campos de data ao limpar para "criar outra".
  const [resetKey, setResetKey] = useState(0);
  const badInputs = useRef<Partial<Record<TypedDateField, boolean>>>({});
  const [moreOpen, setMoreOpen] = useState(
    () =>
      !!(
        defaultValues?.details ||
        defaultValues?.notes ||
        defaultValues?.isReimbursement ||
        defaultValues?.requestOrigin
      ),
  );
  const { extractFromFile, isExtracting } = useDocumentExtraction();

  useEffect(() => {
    if (!selectedCompany) return;
    entityService
      .getAll(selectedCompany.id, isPayable ? "supplier" : "client")
      .then(setEntities)
      .catch((error) => console.error("Falha ao carregar cadastros", error));
  }, [selectedCompany, isPayable]);

  // Arquivo solto fora da área do formulário não pode abrir no navegador e
  // levar junto o que foi preenchido.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const initialValues = useMemo<Partial<TransactionFormData>>(
    () => ({
      type,
      // Conta a receber não passa por aprovação: nasce aprovada.
      status: isPayable ? "draft" : "approved",
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
      details: "",
      amount: 0,
      paymentMethod: undefined,
      supplierOrClient: "",
      entityId: undefined,
      requestOrigin: undefined,
      isReimbursement: false,
      ...defaultValues,
    }),
    // Os valores iniciais são os da abertura; mudar a prop depois não reinicia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Regras que dependem de contexto fora do schema (plano de contas, rateio,
   * texto de data inválido). Rodam no mesmo passo do Zod, para que todos os
   * erros apareçam de uma vez, contados e com foco no primeiro.
   */
  const extraCheck = useRef<
    (v: TransactionFormData) => Record<string, unknown>
  >(() => ({}));
  const resolver = useMemo<Resolver<TransactionFormData>>(() => {
    const base = zodResolver(
      transactionSchema,
    ) as unknown as Resolver<TransactionFormData>;
    return async (values, context, options) => {
      const result = await base(values, context, options);
      const extra = extraCheck.current(values);
      if (Object.keys(extra).length === 0) return result;
      const merged: Record<string, unknown> = { ...result.errors };
      for (const [key, err] of Object.entries(extra)) {
        const current = merged[key];
        merged[key] =
          current && typeof current === "object"
            ? { ...current, ...(err as object) }
            : err;
      }
      return {
        values: {},
        errors: merged as FieldErrors<TransactionFormData>,
      };
    };
  }, []);

  const form = useForm<TransactionFormData>({
    resolver,
    defaultValues: initialValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "costCenterAllocation",
  });
  const {
    fields: attachmentFields,
    append: appendAttachment,
    remove: removeAttachment,
  } = useFieldArray({ control: form.control, name: "attachments" });

  const { isDirty, submitCount, errors } = form.formState;
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const markFilled = (names: string[], source: FillSource) => {
    if (names.length === 0) return;
    setAutoFilled((prev) => ({
      ...prev,
      ...Object.fromEntries(names.map((n) => [n, source])),
    }));
  };
  const clearFilled = (name: string) =>
    setAutoFilled((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  const dropSuggestion = (name: string) =>
    setSuggestions((s) => {
      const next = { ...s };
      delete next[name];
      return next;
    });

  const markBadInput = (name: TypedDateField) => (bad: boolean) => {
    badInputs.current[name] = bad;
    if (bad) {
      form.setError(name, {
        type: "custom",
        message: TYPED_DATE_MESSAGE[name],
      });
    } else {
      form.clearErrors(name);
    }
  };

  // A marca de origem fica até o usuário mexer no campo; mexer no que
  // identifica o documento invalida o aviso de duplicata; data preenchida por
  // fora (documento, boleto) apaga o erro de texto inválido.
  useEffect(() => {
    const sub = form.watch((_, { name, type: event }) => {
      if (!name) return;
      const root = name.split(".")[0];
      if (event === "change") clearFilled(root);
      if (
        name in TYPED_DATE_MESSAGE &&
        badInputs.current[name as TypedDateField] &&
        form.getValues(name as TypedDateField)
      ) {
        badInputs.current[name as TypedDateField] = false;
        form.clearErrors(name as TypedDateField);
      }
      if (
        [
          "entityId",
          "supplierOrClient",
          "documentNumber",
          "barcode",
          "amount",
          "dueDate",
        ].includes(root)
      ) {
        duplicateAcknowledged.current = false;
        duplicateToken.current++;
        setDuplicate(null);
        setCheckingDuplicate(false);
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  // ── Plano de contas ─────────────────────────────────────────────────────────
  // Só aparece quando a empresa tem contas desta natureza, e só é exigido a
  // partir do exercício configurado.
  const nature = isPayable ? "expense" : "revenue";
  const { accounts, requiredFrom } = useChartOfAccounts(selectedCompany?.id);
  const hasAccounts = accounts.some(
    (a) => a.nature === nature && a.type === "analytic" && !a.archived,
  );
  const watchedDueDate = form.watch("dueDate");
  const accountRequired =
    hasAccounts && accountRequiredFor(requiredFrom, watchedDueDate);
  const selectedAccount = accounts.find(
    (a) => a.id === form.watch("accountId"),
  );

  // ── Conta bancária ──────────────────────────────────────────────────────────
  // Só para quem enxerga as contas (as rules escondem `bank_accounts` do
  // `user`). Com uma conta só, ela já vem escolhida.
  const { accounts: bankAccounts } = useBankAccounts(
    canViewReconciliation ? selectedCompany?.id : undefined,
  );
  const watchedBankAccountId = form.watch("bankAccountId");
  const activeBankAccounts = bankAccounts.filter(
    (a) => a.active || a.id === watchedBankAccountId,
  );
  const onlyBankAccountId =
    activeBankAccounts.length === 1 ? activeBankAccounts[0].id : undefined;
  useEffect(() => {
    if (isCreate && onlyBankAccountId && !form.getValues("bankAccountId")) {
      form.setValue("bankAccountId", onlyBankAccountId);
    }
  }, [isCreate, onlyBankAccountId, form]);

  // ── Centros de custo ────────────────────────────────────────────────────────
  const balanceYear = watchedDueDate
    ? new Date(watchedDueDate).getFullYear()
    : new Date().getFullYear();

  // Receita fica de fora do filtro por usuário: ela não escolhe centro, só
  // precisa saber qual é a raiz. Filtrar aqui esconderia a raiz de quem não a
  // tem entre os centros permitidos, e o lançamento travaria numa validação
  // que o usuário não teria como resolver.
  const { costCenters } = useCostCenters(
    user ? selectedCompany?.id : undefined,
    isPayable ? ownOnly : undefined,
  );

  // Saldo vem do razão de envelopes, a mesma fonte que a Cloud Function
  // consulta ao aceitar ou recusar o lançamento. Se a hierarquia for inválida
  // ou o razão faltar, fica sem aviso preventivo: o servidor continua sendo a
  // autoridade no momento de gravar.
  const { data: ledgerBalances, isLoading: balancesLoading } =
    useCostCenterBalances(
      selectedCompany?.id,
      costCenters,
      balanceYear,
      isPayable,
    );
  const costCenterBalances = useMemo<Record<string, number>>(
    () =>
      Object.fromEntries(
        Object.entries(ledgerBalances ?? {}).map(([id, b]) => [
          id,
          b.available,
        ]),
      ),
    [ledgerBalances],
  );

  /** Raiz da árvore: é ela que recebe toda receita da empresa. */
  const rootCostCenter = useMemo(
    () => costCenters.find((cc) => !cc.parentId || cc.parentId === "none"),
    [costCenters],
  );

  /**
   * Receita credita a raiz automaticamente, sem escolha do usuário.
   *
   * No modelo de envelope o recurso entra por cima e desce por distribuição
   * explícita. A alocação continua sendo gravada, e não é decorativa: é ela
   * que alimenta `costCenterIds`, de que o filtro por centro de custo dos
   * relatórios depende.
   */
  const applyRootAllocation = () => {
    if (isPayable || !rootCostCenter) return;
    const current = form.getValues("costCenterAllocation");
    if (
      current?.length === 1 &&
      current[0].costCenterId === rootCostCenter.id &&
      current[0].percentage === 100
    ) {
      return;
    }
    form.setValue("costCenterAllocation", [
      {
        costCenterId: rootCostCenter.id,
        percentage: 100,
        amount: form.getValues("amount") ?? 0,
      },
    ]);
  };
  useEffect(applyRootAllocation, [isPayable, rootCostCenter, form]);

  /** Centros que têm filhos: agrupam recurso, nunca recebem despesa direta. */
  const parentIds = useMemo(
    () =>
      new Set(
        costCenters
          .map((cc) => cc.parentId)
          .filter((id): id is string => !!id && id !== "none"),
      ),
    [costCenters],
  );
  const hierarchicalCostCenters = getHierarchicalCostCenters(costCenters);

  const totalAmount = form.watch("amount");
  const allocations = form.watch("costCenterAllocation");

  useEffect(() => {
    if (!isPayable || !allocations || !(totalAmount > 0)) {
      setBalanceWarning(null);
      return;
    }
    let warning = null;
    for (const alloc of allocations) {
      if (!alloc.costCenterId || !(alloc.amount > 0)) continue;
      const available = costCenterBalances[alloc.costCenterId];
      // Saldo ainda não carregado (ou razão indisponível) não é saldo zero.
      if (available === undefined) continue;
      if (alloc.amount > available) {
        const ccName =
          costCenters.find((cc) => cc.id === alloc.costCenterId)?.name ||
          "Centro de custo";
        warning = `Saldo insuficiente em "${ccName}": disponível ${formatCurrency(available)}, necessário ${formatCurrency(alloc.amount)}.`;
        break;
      }
    }
    setBalanceWarning(warning);
  }, [allocations, totalAmount, costCenterBalances, costCenters, isPayable]);

  /**
   * Grava % e R$ campo a campo. Trocar o array inteiro faria o useFieldArray
   * regenerar as chaves das linhas, e o input em edição perderia o foco.
   */
  const writeAllocations = (next: Allocation[], dirty = false) =>
    next.forEach((a, i) => {
      form.setValue(`costCenterAllocation.${i}.percentage`, a.percentage, {
        shouldDirty: dirty,
      });
      form.setValue(`costCenterAllocation.${i}.amount`, a.amount, {
        shouldDirty: dirty,
      });
    });

  // Valor total mudou: o R$ de cada linha segue o % dela. Na abertura não
  // recalcula, para a edição não mover centavos já gravados entre centros.
  const lastTotal = useRef(totalAmount);
  useEffect(() => {
    if (lastTotal.current === totalAmount) return;
    lastTotal.current = totalAmount;
    const current = form.getValues("costCenterAllocation");
    if (!current?.length) return;
    writeAllocations(amountsFromPercent(current, totalAmount || 0));
  }, [totalAmount, form]); // eslint-disable-line react-hooks/exhaustive-deps

  const revalidateAllocation = () => {
    if (submitCount > 0) void form.trigger("costCenterAllocation");
  };

  const setPercentage = (index: number, pct: number) => {
    const next = form
      .getValues("costCenterAllocation")
      .map((a, i) => (i === index ? { ...a, percentage: pct } : a));
    writeAllocations(
      amountsFromPercent(next, form.getValues("amount") || 0),
      true,
    );
    clearFilled("costCenterAllocation");
    revalidateAllocation();
  };

  const setAllocationAmount = (index: number, value: number) => {
    const total = form.getValues("amount") || 0;
    // Conta crua: `currency` arredondaria a razão a 2 casas antes do ×100.
    const pct = total > 0 ? Math.round((value / total) * 10000) / 100 : 0;
    form.setValue(`costCenterAllocation.${index}.amount`, value, {
      shouldDirty: true,
    });
    form.setValue(`costCenterAllocation.${index}.percentage`, pct, {
      shouldDirty: true,
    });
    clearFilled("costCenterAllocation");
    revalidateAllocation();
  };

  /** Nova linha: o valor se divide por igual entre todos os centros. */
  const addAllocationRow = () => {
    const current = form.getValues("costCenterAllocation");
    const pcts = evenPercentages(current.length + 1);
    const next = amountsFromPercent(
      [...current, { costCenterId: "", percentage: 0, amount: 0 }].map(
        (a, i) => ({ ...a, percentage: pcts[i] }),
      ),
      form.getValues("amount") || 0,
    );
    writeAllocations(next.slice(0, -1), true);
    append(next[next.length - 1]);
  };

  const removeAllocationRow = (index: number) => {
    remove(index);
    const rest = form.getValues("costCenterAllocation");
    // Sobrou uma linha: ela volta a levar o valor inteiro.
    if (rest.length === 1) {
      writeAllocations(
        amountsFromPercent(
          [{ ...rest[0], percentage: 100 }],
          form.getValues("amount") || 0,
        ),
        true,
      );
    }
    revalidateAllocation();
  };

  const allocatedTotal = (allocations ?? []).reduce(
    (s, a) => s.add(a.amount || 0),
    currency(0),
  );
  const allocationRemaining = currency(totalAmount || 0).subtract(
    allocatedTotal,
  );
  const percentTotal = (allocations ?? []).reduce(
    (s, a) => s.add(a.percentage || 0),
    currency(0),
  );
  const isSplit = fields.length > 1;
  const allocationRootError =
    errors.costCenterAllocation?.root?.message ||
    errors.costCenterAllocation?.message;

  const approvers = useMemo(() => {
    const ids = new Set((allocations ?? []).map((a) => a.costCenterId));
    return costCenters
      .filter((c) => ids.has(c.id))
      .map((c) => ({ name: c.name, email: c.approverEmail }));
  }, [allocations, costCenters]);

  // Regras fora do schema, lidas pelo resolver. Atualizadas a cada render para
  // enxergar plano de contas e tipo atuais.
  useEffect(() => {
    extraCheck.current = (v) => {
      const out: Record<string, unknown> = {};
      const err = (message: string) => ({ type: "custom", message });
      const bad = badInputs.current;
      if (bad.dueDate) out.dueDate = err(TYPED_DATE_MESSAGE.dueDate);
      if (bad.competence) out.competence = err(TYPED_DATE_MESSAGE.competence);
      if (bad["recurrence.endDate"]) {
        out.recurrence = {
          endDate: err(TYPED_DATE_MESSAGE["recurrence.endDate"]),
        };
      }
      if (
        hasAccounts &&
        accountRequiredFor(requiredFrom, v.dueDate) &&
        !v.accountId
      ) {
        out.accountId = err(
          `Obrigatória para vencimentos a partir de ${requiredFrom}.`,
        );
      }
      if (isPayable && (v.costCenterAllocation?.length ?? 0) > 1) {
        const rest = currency(v.amount || 0).subtract(
          v.costCenterAllocation.reduce(
            (s, a) => s.add(a.amount || 0),
            currency(0),
          ),
        );
        if (rest.intValue !== 0) {
          out.costCenterAllocation = {
            root: err(
              rest.value > 0
                ? `Faltam ${formatCurrency(rest.value)} para fechar o rateio.`
                : `O rateio passa do valor em ${formatCurrency(-rest.value)}.`,
            ),
          };
        }
      }
      return out;
    };
  });

  // ── Entidade ────────────────────────────────────────────────────────────────
  const entityId = form.watch("entityId");
  const selectedEntity = entities.find((e) => e.id === entityId);

  /**
   * Fornecedor escolhido: o último lançamento dele sugere forma de pagamento,
   * conta e rateio. Só preenche o que está vazio, e nada que tenha sido
   * arquivado ou que o usuário não possa usar.
   */
  const applyEntityDefaults = async (entity: Entity) => {
    if (!isNewRecord || !selectedCompany) return;

    // Padrões do cadastro vêm primeiro; o último lançamento completa o resto.
    const fromEntity: string[] = [];
    if (!form.getValues("paymentMethod") && entity.defaultPaymentMethod) {
      form.setValue("paymentMethod", entity.defaultPaymentMethod);
      fromEntity.push("paymentMethod");
    }
    const entityAccount = accounts.find(
      (a) => a.id === entity.defaultAccountId,
    );
    if (
      !form.getValues("accountId") &&
      entityAccount &&
      !entityAccount.archived &&
      entityAccount.type === "analytic" &&
      entityAccount.nature === nature
    ) {
      form.setValue("accountId", entityAccount.id);
      fromEntity.push("accountId");
    }
    const entityCc = costCenters.find(
      (c) => c.id === entity.defaultCostCenterId,
    );
    const currentAlloc = form.getValues("costCenterAllocation");
    if (
      isPayable &&
      entityCc &&
      !entityCc.archived &&
      !parentIds.has(entityCc.id) &&
      currentAlloc.length === 1 &&
      !currentAlloc[0].costCenterId
    ) {
      form.setValue("costCenterAllocation", [
        {
          costCenterId: entityCc.id,
          percentage: 100,
          amount: form.getValues("amount") || 0,
        },
      ]);
      fromEntity.push("costCenterAllocation");
    }
    if (!form.getValues("dueDate") && entity.paymentTermDays != null) {
      form.setValue(
        "dueDate",
        addDays(startOfDay(new Date()), entity.paymentTermDays),
      );
      fromEntity.push("dueDate");
    }
    markFilled(fromEntity, "entity");

    let last: Transaction | null = null;
    try {
      last = await transactionService.getLastForEntity(
        selectedCompany.id,
        entity.id,
        ownOnly,
      );
    } catch (error) {
      // Sem índice ou sem permissão: o formulário segue sem sugestão.
      console.warn("Sugestão pelo fornecedor indisponível", error);
      return;
    }
    if (!last || form.getValues("entityId") !== entity.id) return;

    const filled: string[] = [];
    if (!form.getValues("paymentMethod") && last.paymentMethod) {
      form.setValue("paymentMethod", last.paymentMethod);
      filled.push("paymentMethod");
    }
    const lastAccount = accounts.find((a) => a.id === last.accountId);
    if (
      !form.getValues("accountId") &&
      lastAccount &&
      !lastAccount.archived &&
      lastAccount.type === "analytic"
    ) {
      form.setValue("accountId", lastAccount.id);
      filled.push("accountId");
    }
    const current = form.getValues("costCenterAllocation");
    const lastAllocations = last.costCenterAllocation ?? [];
    const usable = lastAllocations.filter((a) => {
      const cc = costCenters.find((c) => c.id === a.costCenterId);
      return cc && !cc.archived && !parentIds.has(cc.id);
    });
    if (
      isPayable &&
      current.length === 1 &&
      !current[0].costCenterId &&
      usable.length > 0 &&
      usable.length === lastAllocations.length
    ) {
      form.setValue(
        "costCenterAllocation",
        amountsFromPercent(
          usable.map((a) => ({
            costCenterId: a.costCenterId,
            percentage: a.percentage,
            amount: 0,
          })),
          form.getValues("amount") || 0,
        ),
      );
      filled.push("costCenterAllocation");
    }
    markFilled(filled, "history");
  };

  // Aberto a partir da página da entidade (?entidade=): já vem com o
  // fornecedor escolhido e aplica os padrões dele uma vez.
  const presetApplied = useRef(false);
  useEffect(() => {
    const presetId = defaultValues?.entityId;
    if (!isCreate || !presetId || presetApplied.current) return;
    const entity = entities.find((e) => e.id === presetId);
    if (!entity || (isPayable && costCenters.length === 0)) return;
    presetApplied.current = true;
    if (!form.getValues("supplierOrClient")) {
      form.setValue("supplierOrClient", entity.name);
    }
    void applyEntityDefaults(entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, costCenters, accounts]);

  // ── Descrição automática ────────────────────────────────────────────────────
  // Lançamento novo nasce com "Fornecedor · nº 123"; o que o usuário (ou o
  // documento) escreveu nunca é sobrescrito.
  const lastAutoDescription = useRef("");
  const supplierName = form.watch("supplierOrClient");
  const documentNumber = form.watch("documentNumber");
  useEffect(() => {
    if (!isCreate) return;
    const current = form.getValues("description");
    if (current && current !== lastAutoDescription.current) return;
    const next = [
      supplierName?.trim(),
      documentNumber?.trim() && `nº ${documentNumber.trim()}`,
    ]
      .filter(Boolean)
      .join(" · ");
    lastAutoDescription.current = next;
    form.setValue("description", next);
  }, [isCreate, supplierName, documentNumber, form]);

  // ── Duplicata ───────────────────────────────────────────────────────────────
  const findDuplicate = async () => {
    if (!isNewRecord || !selectedCompany) return null;
    const v = form.getValues();
    if (!(v.barcode || v.documentNumber?.trim() || (v.amount && v.dueDate))) {
      return null;
    }
    return transactionService
      .findDuplicate(
        selectedCompany.id,
        {
          type,
          entityId: v.entityId,
          supplierOrClient: v.supplierOrClient,
          documentNumber: v.documentNumber,
          barcode: v.barcode,
          amount: v.amount,
          dueDate: v.dueDate,
        },
        ownOnly,
      )
      .catch((error) => {
        console.warn("Checagem de duplicata indisponível", error);
        return null;
      });
  };

  /** Checagem antecipada: avisa assim que o documento é identificado. */
  const checkDuplicateEarly = async () => {
    if (duplicateAcknowledged.current || !isNewRecord) return;
    const token = ++duplicateToken.current;
    setCheckingDuplicate(true);
    const found = await findDuplicate();
    // Algo mudou durante a consulta: a resposta já não vale.
    if (token !== duplicateToken.current) return;
    setCheckingDuplicate(false);
    if (found) setDuplicate(found);
  };

  // ── Documento e linha digitável ─────────────────────────────────────────────
  /**
   * Preenche valor e vencimento lidos de uma fonte. Campo vazio recebe o valor;
   * campo já preenchido com outro valor ganha uma sugestão com "Aplicar".
   */
  const offerAmountAndDate = (
    read: { amount?: number; dueDate?: Date },
    source: FillSource,
    where: string,
  ) => {
    const filled: string[] = [];
    const found: Record<string, Suggestion> = {};
    if (read.amount) {
      const current = form.getValues("amount");
      if (!current) {
        form.setValue("amount", read.amount, { shouldValidate: true });
        filled.push("amount");
      } else if (
        currency(current).intValue !== currency(read.amount).intValue
      ) {
        const diff = currency(read.amount).subtract(current).value;
        found.amount = {
          value: read.amount,
          display: formatCurrency(read.amount),
          diff: `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`,
          where,
        };
      }
    }
    if (read.dueDate) {
      const current = form.getValues("dueDate");
      if (!current) {
        form.setValue("dueDate", read.dueDate, { shouldValidate: true });
        filled.push("dueDate");
      } else {
        const days = differenceInCalendarDays(read.dueDate, current);
        if (days !== 0) {
          found.dueDate = {
            value: read.dueDate,
            display: format(read.dueDate, "dd/MM/yyyy"),
            diff: `${days > 0 ? "+" : ""}${days} dia${Math.abs(days) !== 1 ? "s" : ""}`,
            where,
          };
        }
      }
    }
    markFilled(filled, source);
    setSuggestions((s) => ({ ...s, ...found }));
    return { filled: filled.length, divergent: Object.keys(found).length };
  };

  const handleBarcode = (raw: string) => {
    const digits = onlyDigits(raw).slice(0, 48);
    form.setValue("barcode", digits || undefined, {
      shouldDirty: true,
      shouldValidate: submitCount > 0,
    });
    clearFilled("barcode");
    const parsed = parseBoleto(digits);
    if (!parsed.valid) return;
    offerAmountAndDate(parsed, "boleto", "no boleto");
    if (!form.getValues("paymentMethod")) {
      form.setValue("paymentMethod", "boleto");
      markFilled(["paymentMethod"], "boleto");
    }
    void checkDuplicateEarly();
  };

  const handleFile = async (file: File) => {
    if (!selectedCompany) return;
    if (!isAcceptedFile(file)) {
      toast.error("Formato não aceito", {
        description: "Anexe um PDF ou uma imagem.",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Arquivo grande demais", {
        description: "O limite é de 15 MB.",
      });
      return;
    }
    // Só o primeiro anexo de despesa é lido: os seguintes costumam ser
    // comprovantes de demanda, não o documento de cobrança.
    const canExtract = isPayable && attachmentFields.length === 0;
    setIsUploading(true);
    try {
      const [uploaded, result] = await Promise.all([
        storageService.uploadFile(file, `transactions/${selectedCompany.id}`),
        canExtract
          ? extractFromFile(file, selectedCompany.id)
          : Promise.resolve(null),
      ]);

      appendAttachment({
        id: uploaded.id,
        url: uploaded.url,
        name: uploaded.name,
        type: uploaded.type,
        category: "invoice",
      });

      if (!canExtract) return;
      if (!result?.data) {
        toast.warning("Não foi possível ler o documento", {
          description: "O anexo foi salvo. Preencha os campos manualmente.",
        });
        return;
      }

      const { data, matchedEntity } = result;
      const filled: string[] = [];

      if (!form.getValues("supplierOrClient")) {
        if (matchedEntity) {
          setUseEntity(true);
          form.setValue("entityId", matchedEntity.id);
          form.setValue("supplierOrClient", matchedEntity.name as string, {
            shouldValidate: submitCount > 0,
          });
          filled.push("supplierOrClient");
          void applyEntityDefaults(matchedEntity as Entity);
        } else if (data.supplierName) {
          setUseEntity(false);
          form.setValue("supplierOrClient", data.supplierName, {
            shouldValidate: submitCount > 0,
          });
          filled.push("supplierOrClient");
        }
      }
      if (data.description && !form.getValues("description")) {
        form.setValue("description", data.description);
        filled.push("description");
      }
      if (data.barcode && !form.getValues("barcode")) {
        form.setValue("barcode", parseBoleto(data.barcode).digits);
        filled.push("barcode");
        if (!form.getValues("paymentMethod")) {
          form.setValue("paymentMethod", "boleto");
          filled.push("paymentMethod");
        }
      }
      if (data.paymentMethod) {
        const current = form.getValues("paymentMethod");
        if (!current) {
          form.setValue("paymentMethod", data.paymentMethod);
          filled.push("paymentMethod");
        } else if (current !== data.paymentMethod) {
          setSuggestions((s) => ({
            ...s,
            paymentMethod: {
              value: data.paymentMethod,
              display:
                METHOD_LABEL[data.paymentMethod as PaymentMethod] ??
                data.paymentMethod,
              where: "no documento",
            },
          }));
        }
      }
      if (data.notes && !form.getValues("notes")) {
        form.setValue("notes", data.notes);
      }
      markFilled(filled, "document");

      const { filled: dated, divergent } = offerAmountAndDate(
        {
          amount: data.amount || undefined,
          dueDate: data.dueDate
            ? new Date(data.dueDate + "T12:00:00")
            : undefined,
        },
        "document",
        "no documento",
      );

      setExtraction({ confidence: data.confidence });
      if (filled.length + dated === 0 && divergent === 0) {
        toast.info("Documento lido", {
          description: "Os campos já estavam preenchidos.",
        });
      } else if (data.confidence < 50) {
        toast.warning("Leitura com baixa confiança", {
          description: `Confiança de ${data.confidence}%. Confira todos os campos.`,
        });
      } else if (divergent > 0) {
        toast.warning("O documento diverge do que foi digitado", {
          description: "Confira os avisos e aplique se for o caso.",
        });
      }
      void checkDuplicateEarly();
    } catch (error) {
      console.error("Upload failed", error);
      toast.error("Não foi possível enviar o arquivo", {
        description: "Verifique a conexão e tente de novo.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Tirar o documento lido tira também as marcas do que ele preencheu. Os
   * valores ficam (podem ter sido conferidos), com a opção de limpar.
   */
  const handleRemoveAttachment = (index: number) => {
    removeAttachment(index);
    if (index !== 0 || !extraction) return;
    const fromDocument = Object.entries(autoFilled)
      .filter(([, source]) => source === "document")
      .map(([name]) => name);
    setAutoFilled((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([, source]) => source !== "document"),
      ),
    );
    setSuggestions((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([, s]) => s.where !== "no documento"),
      ),
    );
    setExtraction(null);
    if (fromDocument.length === 0) return;
    toast("Os campos lidos do documento foram mantidos", {
      action: {
        label: "Limpar",
        onClick: () => {
          for (const name of fromDocument) {
            const key = name as keyof TransactionFormData;
            form.setValue(key, initialValues[key] as never, {
              shouldDirty: true,
            });
            if (key === "supplierOrClient") {
              form.setValue("entityId", undefined);
            }
          }
          setResetKey((k) => k + 1);
        },
      },
    });
  };

  // ── Repetição ───────────────────────────────────────────────────────────────
  const useInstallments = form.watch("useInstallments");
  const isRecurring = form.watch("recurrence.isRecurring");
  const installmentsCount = form.watch("installmentsCount");
  const repetition: Repetition = useInstallments
    ? "installment"
    : isRecurring
      ? "recurring"
      : "single";

  const setRepetition = (value: Repetition) => {
    form.setValue("recurrence.isRecurring", value === "recurring");
    form.setValue("useInstallments", value === "installment");
    // Linha digitável, nº do documento e competência são de uma ocorrência
    // só: na recorrência eles somem, e um valor escondido não pode nem travar
    // o envio nem ser descartado em silêncio.
    if (value === "recurring") {
      for (const name of ["barcode", "documentNumber", "competence"] as const) {
        form.setValue(name, undefined);
        form.clearErrors(name);
      }
      badInputs.current.competence = false;
    }
  };

  // Mesma conta do serviço ao gravar: parcelas mensais a partir do 1º
  // vencimento, com os centavos distribuídos por `currency.distribute`.
  const installmentPreview = useMemo(() => {
    const n = Number(installmentsCount);
    if (!useInstallments || !watchedDueDate || !(totalAmount > 0)) return [];
    if (!Number.isInteger(n) || n < 2 || n > 120) return [];
    return currency(totalAmount)
      .distribute(n)
      .map((v, i) => ({
        n: i + 1,
        date: addMonths(watchedDueDate, i),
        value: v.value,
      }));
  }, [useInstallments, installmentsCount, watchedDueDate, totalAmount]);

  // ── Envio ───────────────────────────────────────────────────────────────────
  const focusFirstError = () =>
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    });

  const handleInvalid = (errs: FieldErrors<TransactionFormData>) => {
    if (errs.requestOrigin || errs.details) setMoreOpen(true);
    const messages = errorMessages(errs).filter(Boolean);
    // As mensagens vão no aviso: um erro sem campo visível ainda se explica.
    toast.error(
      messages.length === 1
        ? "1 campo precisa de atenção"
        : `${messages.length} campos precisam de atenção`,
      { description: [...new Set(messages)].slice(0, 3).join(" · ") },
    );
    focusFirstError();
  };

  const resetForNext = () => {
    form.reset(initialValues);
    applyRootAllocation();
    lastAutoDescription.current = "";
    lastTotal.current = initialValues.amount ?? 0;
    badInputs.current = {};
    setResetKey((k) => k + 1);
    setAutoFilled({});
    setSuggestions({});
    setExtraction(null);
    setDuplicate(null);
    duplicateAcknowledged.current = false;
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLElement>("[data-first-field]")
        ?.focus(),
    );
  };

  const handleValidSubmit = async (data: TransactionFormData) => {
    if (isNewRecord && !duplicateAcknowledged.current) {
      const found = duplicate ?? (await findDuplicate());
      if (found) {
        setDuplicate(found);
        toast.warning("Possível duplicata", {
          description: "Confira o lançamento parecido antes de salvar.",
        });
        requestAnimationFrame(() =>
          duplicateRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        );
        return;
      }
    }

    const shouldKeepOpen = isCreate && keepOpen;
    const ok = await onSubmit(data, { keepOpen: shouldKeepOpen });
    if (ok !== false && shouldKeepOpen) resetForNext();
  };

  /** Rascunho ou aprovação: o botão decide o status da conta a pagar nova. */
  const submitWith = (status?: "draft" | "pending_approval") => {
    if (status) form.setValue("status", status);
    return form.handleSubmit(handleValidSubmit, handleInvalid)();
  };
  const sendsForApproval = isCreate && isPayable;
  const primarySubmit = () =>
    submitWith(sendsForApproval ? "pending_approval" : undefined);

  const busy = isLoading || form.formState.isSubmitting;
  const errorCount = submitCount > 0 ? errorMessages(errors).length : 0;
  const primaryLabel = sendsForApproval
    ? "Enviar para aprovação"
    : variant === "reconcile"
      ? "Criar e conciliar"
      : isCreate
        ? "Salvar"
        : "Salvar alterações";

  const paymentMethod = form.watch("paymentMethod");
  const barcodeValue = form.watch("barcode");
  const recurringMode = repetition === "recurring";
  const showBarcode = !recurringMode && (isPayable || !!barcodeValue);
  const paymentDate = form.watch("paymentDate");
  // Na recorrência a fileira perde a competência: três colunas iguais.
  const rowCell = recurringMode
    ? "col-span-12 @lg:col-span-4"
    : "col-span-6 @2xl:col-span-3";

  const repetitionRefs = useRef<Record<Repetition, HTMLButtonElement | null>>({
    single: null,
    installment: null,
    recurring: null,
  });

  return (
    <Form {...form}>
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void primarySubmit();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Eventos atravessam portais: Enter numa lista suspensa (fornecedor,
          // centro de custo) é da lista, não do formulário.
          if (!formRef.current?.contains(e.target as Node)) return;
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            void primarySubmit();
            return;
          }
          // Enter num campo de texto não envia o formulário pela metade.
          if (e.target instanceof HTMLInputElement) e.preventDefault();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setIsDragOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
        className="@container flex flex-col gap-6"
      >
        {/* ── Documento ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-12 items-end gap-x-4 gap-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <div className={cn("col-span-12", showBarcode && "@2xl:col-span-7")}>
            {attachmentFields.length === 0 ? (
              <button
                type="button"
                disabled={isUploading || isExtracting}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-2.5 text-left transition-colors",
                  isDragOver
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/40 hover:bg-muted/40",
                  (isUploading || isExtracting) && "cursor-default",
                )}
              >
                {isUploading || isExtracting ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {isExtracting
                      ? "Lendo o documento…"
                      : isUploading
                        ? "Enviando…"
                        : isDragOver
                          ? "Solte para anexar"
                          : isPayable
                            ? "Arraste o boleto ou a nota fiscal, ou clique"
                            : "Arraste a nota, o contrato ou a fatura, ou clique"}
                  </span>
                  {!isUploading && !isExtracting && (
                    <span className="block text-xs text-muted-foreground">
                      {isPayable
                        ? "PDF ou imagem. A leitura preenche fornecedor, valor e vencimento."
                        : "PDF ou imagem, até 15 MB."}
                    </span>
                  )}
                </span>
              </button>
            ) : (
              <div
                className={cn(
                  "rounded-lg border transition-colors",
                  isDragOver && "border-primary bg-primary/5",
                )}
              >
                <ul className="divide-y">
                  {attachmentFields.map((field, index) => (
                    <li
                      key={field.id}
                      className="flex items-center gap-2 py-1 pl-3 pr-1"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <a
                        href={field.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-sm hover:underline"
                      >
                        {field.name}
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${field.name}`}
                        onClick={() => handleRemoveAttachment(index)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2 border-t px-3 py-1">
                  <span className="text-xs text-muted-foreground">
                    {isExtracting
                      ? "Lendo o documento…"
                      : extraction
                        ? `Lido automaticamente, confiança de ${extraction.confidence}%.`
                        : "Arraste outro arquivo para anexar."}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isExtracting}
                    loading={isUploading}
                  >
                    <Plus className="h-4 w-4" />
                    Anexar outro
                  </Button>
                </div>
              </div>
            )}
          </div>

          {showBarcode && (
            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => {
                const parsed = field.value ? parseBoleto(field.value) : null;
                const complete = [44, 47, 48].includes(
                  field.value?.length ?? 0,
                );
                return (
                  <FormItem className="col-span-12 @2xl:col-span-5">
                    <FormLabel className="gap-1.5">
                      {repetition === "installment"
                        ? "Linha digitável da 1ª parcela"
                        : "Linha digitável"}
                      <FillMark source={autoFilled.barcode} />
                    </FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        placeholder="Números do boleto"
                        value={formatBoletoLine(field.value ?? "")}
                        onChange={(e) => handleBarcode(e.target.value)}
                        className="font-financial"
                      />
                    </FormControl>
                    {parsed?.valid ? (
                      <FormDescription className="text-xs font-financial">
                        {[
                          parsed.kind === "bank"
                            ? `Banco ${parsed.bankCode}`
                            : "Arrecadação",
                          parsed.amount !== undefined &&
                            formatCurrency(parsed.amount),
                          parsed.dueDate &&
                            `vence ${format(parsed.dueDate, "dd/MM/yyyy")}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </FormDescription>
                    ) : (
                      complete &&
                      !errors.barcode && (
                        <p className="text-xs text-destructive">
                          Os dígitos não conferem. Confira a linha.
                        </p>
                      )
                    )}
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          )}
        </div>

        {/* ── Lançamento ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-x-4 gap-y-5">
          <FormField
            control={form.control}
            name="supplierOrClient"
            render={({ field }) => (
              <FormItem
                className={cn(
                  "col-span-12",
                  !recurringMode && "@lg:col-span-7",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <FormLabel required className="gap-1.5">
                    {counterpartLabel}
                    <FillMark source={autoFilled.supplierOrClient} />
                  </FormLabel>
                  {!useEntity && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => {
                        setUseEntity(true);
                        form.setValue("entityId", undefined);
                        form.setValue("supplierOrClient", "");
                      }}
                    >
                      Escolher do cadastro
                    </button>
                  )}
                </div>
                {useEntity ? (
                  <Popover
                    open={openEntityCombobox}
                    onOpenChange={setOpenEntityCombobox}
                  >
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          data-first-field
                          variant="outline"
                          role="combobox"
                          className={cn(
                            "w-full justify-between font-normal",
                            !field.value && "text-muted-foreground",
                          )}
                        >
                          <span className="truncate">
                            {selectedEntity?.name ||
                              field.value ||
                              "Buscar no cadastro…"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                      <Command>
                        <CommandInput
                          placeholder="Nome ou documento…"
                          value={entitySearch}
                          onValueChange={setEntitySearch}
                        />
                        <CommandList
                          onWheel={(e) => {
                            e.stopPropagation();
                            e.currentTarget.scrollTop += e.deltaY;
                          }}
                        >
                          <CommandEmpty className="space-y-2 px-3 py-4 text-sm">
                            <p className="text-muted-foreground">
                              Nenhum cadastro encontrado.
                            </p>
                            {entitySearch.trim() && (
                              <button
                                type="button"
                                className="text-left font-medium hover:underline"
                                onClick={() => {
                                  setUseEntity(false);
                                  form.setValue("entityId", undefined);
                                  form.setValue(
                                    "supplierOrClient",
                                    entitySearch.trim(),
                                    {
                                      shouldDirty: true,
                                      shouldValidate: submitCount > 0,
                                    },
                                  );
                                  setOpenEntityCombobox(false);
                                }}
                              >
                                Lançar “{entitySearch.trim()}” sem cadastro
                              </button>
                            )}
                          </CommandEmpty>
                          <CommandGroup>
                            {entities
                              // Inativa não recebe lançamento novo
                              .filter(
                                (e) => e.active !== false || e.id === entityId,
                              )
                              .map((entity) => (
                                <CommandItem
                                  value={`${entity.name} ${entity.tradeName ?? ""} ${entity.document ?? ""}`}
                                  key={entity.id}
                                  onSelect={() => {
                                    form.setValue("entityId", entity.id);
                                    form.setValue(
                                      "supplierOrClient",
                                      entity.name,
                                      {
                                        shouldDirty: true,
                                        shouldValidate: submitCount > 0,
                                      },
                                    );
                                    setOpenEntityCombobox(false);
                                    void applyEntityDefaults(entity);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      entity.id === entityId
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                  <span className="truncate">
                                    {entity.name}
                                  </span>
                                  {entity.document && (
                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground font-financial">
                                      {entity.document}
                                    </span>
                                  )}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <>
                    <FormControl>
                      <Input
                        data-first-field
                        placeholder="Nome da empresa ou pessoa"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Sem cadastro não há PIX nem dados bancários, e o nome não
                      entra nas sugestões.
                    </FormDescription>
                  </>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {!recurringMode && (
            <FormField
              control={form.control}
              name="documentNumber"
              render={({ field }) => (
                <FormItem className="col-span-12 @lg:col-span-5">
                  <FormLabel>Nº do documento</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Nota fiscal, fatura ou contrato"
                      {...field}
                      value={field.value ?? ""}
                      onBlur={() => {
                        field.onBlur();
                        if (field.value?.trim()) void checkDuplicateEarly();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem className={rowCell}>
                <FormLabel required className="gap-1.5">
                  {repetition === "installment"
                    ? "Valor total"
                    : recurringMode
                      ? "Valor por ocorrência"
                      : "Valor"}
                  <FillMark source={autoFilled.amount} />
                </FormLabel>
                <FormControl>
                  <CurrencyInput
                    value={field.value || undefined}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="dueDate"
            render={({ field, fieldState }) => (
              <FormItem className={rowCell}>
                <FormLabel required className="gap-1.5">
                  {repetition === "installment"
                    ? "1º vencimento"
                    : recurringMode
                      ? "1ª ocorrência"
                      : "Vencimento"}
                  <FillMark source={autoFilled.dueDate} />
                </FormLabel>
                <FormControl>
                  <DateField
                    key={resetKey}
                    value={field.value}
                    onChange={field.onChange}
                    onBadInput={markBadInput("dueDate")}
                    invalid={!!fieldState.error}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {!recurringMode && (
            <FormField
              control={form.control}
              name="competence"
              render={({ field, fieldState }) => (
                <FormItem className={rowCell}>
                  <FormLabel>Competência</FormLabel>
                  <FormControl>
                    <MonthField
                      key={resetKey}
                      value={field.value}
                      onChange={field.onChange}
                      onBadInput={markBadInput("competence")}
                      invalid={!!fieldState.error}
                    />
                  </FormControl>
                  {!fieldState.error && (
                    <FormDescription className="text-xs">
                      Vazio: mês do {isPayable ? "pagamento" : "recebimento"}
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="paymentMethod"
            render={({ field }) => (
              <FormItem className={rowCell}>
                <FormLabel className="gap-1.5">
                  Forma de {isPayable ? "pagamento" : "recebimento"}
                  <FillMark source={autoFilled.paymentMethod} />
                </FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {METHOD_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Divergências ficam numa linha própria: dentro de colunas
              estreitas o aviso quebrava e desalinhava a fileira. */}
          {Object.keys(suggestions).length > 0 && (
            <div className="col-span-12 -mt-1 space-y-1 rounded-md bg-amber-500/10 px-3 py-2">
              {Object.entries(suggestions).map(([name, s]) => (
                <div
                  key={name}
                  className="flex flex-wrap items-center gap-x-1.5 text-xs text-amber-800 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>
                    {SUGGESTION_LABEL[name]} {s.where}:{" "}
                    <span className="font-semibold font-financial">
                      {s.display}
                    </span>
                  </span>
                  {s.diff && (
                    <span className="text-muted-foreground font-financial">
                      ({s.diff})
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue(
                        name as "amount" | "dueDate" | "paymentMethod",
                        s.value as never,
                        { shouldValidate: true, shouldDirty: true },
                      );
                      dropSuggestion(name);
                    }}
                    className="ml-auto font-semibold hover:underline"
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => dropSuggestion(name)}
                    className="font-medium text-muted-foreground hover:underline"
                  >
                    Manter o digitado
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeBankAccounts.length > 0 && (
            <FormField
              control={form.control}
              name="bankAccountId"
              render={({ field }) => (
                <FormItem className="col-span-12 @2xl:col-span-6">
                  <FormLabel>
                    Conta de {isPayable ? "saída" : "entrada"}
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                    // Na conciliação a conta é a do extrato.
                    disabled={variant === "reconcile"}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Não definida" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeBankAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.accountNumber && (
                            <span className="text-muted-foreground font-financial">
                              {" "}
                              · {a.accountNumber}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {variant === "reconcile" && paymentDate && (
            <p className="col-span-12 -mt-2 text-xs text-muted-foreground">
              Lançado como {isPayable ? "pago" : "recebido"} em{" "}
              <span className="font-financial text-foreground">
                {format(paymentDate, "dd/MM/yyyy")}
              </span>
              , conforme o extrato.
            </p>
          )}
          {paymentMethod === "pix" && selectedEntity?.pixKey && (
            <p className="col-span-12 -mt-2 text-xs text-muted-foreground">
              Chave PIX de {selectedEntity.name}:{" "}
              <span className="font-financial text-foreground select-all">
                {selectedEntity.pixKey}
              </span>
            </p>
          )}
          {paymentMethod === "transfer" && selectedEntity?.bankName && (
            <p className="col-span-12 -mt-2 text-xs text-muted-foreground">
              Dados bancários de {selectedEntity.name}:{" "}
              <span className="font-financial text-foreground select-all">
                {[
                  selectedEntity.bankName,
                  selectedEntity.agency && `ag. ${selectedEntity.agency}`,
                  selectedEntity.account && `conta ${selectedEntity.account}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          )}

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="col-span-12">
                <FormLabel required className="gap-1.5">
                  Descrição
                  <FillMark source={autoFilled.description} />
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="O que é esta conta? Ex.: Hospedagem AWS de outubro"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ── Classificação: centro de custo e conta contábil ─────────── */}
          {isPayable ? (
            <div
              className={cn(
                "col-span-12 space-y-2",
                !isSplit && hasAccounts && "@2xl:col-span-7",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={groupLabelClass}>
                  Centro de custo
                  <RequiredMark />
                  <FillMark source={autoFilled.costCenterAllocation} />
                </p>
                <button
                  type="button"
                  onClick={addAllocationRow}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  {isSplit ? "Mais um centro" : "Dividir com outro centro"}
                </button>
              </div>

              {isSplit && (
                <div className="hidden grid-cols-[1fr_5.5rem_9rem_2.25rem] gap-2 text-xs text-muted-foreground @lg:grid">
                  <span>Centro</span>
                  <span>%</span>
                  <span>Valor</span>
                </div>
              )}

              {fields.map((row, index) => (
                <div
                  key={row.id}
                  className={cn(
                    "grid items-start gap-2",
                    isSplit
                      ? "grid-cols-[1fr_2.25rem] @lg:grid-cols-[1fr_5.5rem_9rem_2.25rem]"
                      : "grid-cols-1",
                  )}
                >
                  <FormField
                    control={form.control}
                    name={`costCenterAllocation.${index}.costCenterId`}
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel className="sr-only">
                          Centro de custo {index + 1}
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
                                aria-required
                                className={cn(
                                  "w-full justify-between font-normal",
                                  !field.value && "text-muted-foreground",
                                )}
                              >
                                <span className="truncate">
                                  {costCenters.find((c) => c.id === field.value)
                                    ?.name ?? "Selecione o centro de custo"}
                                </span>
                                {field.value &&
                                  (balancesLoading ? (
                                    <span className="ml-auto pl-2 text-xs text-muted-foreground">
                                      saldo…
                                    </span>
                                  ) : (
                                    costCenterBalances[field.value] !==
                                      undefined && (
                                      <span className="ml-auto pl-2 text-xs text-muted-foreground font-financial">
                                        saldo{" "}
                                        {formatCurrency(
                                          costCenterBalances[field.value],
                                        )}
                                      </span>
                                    )
                                  ))}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[--radix-popover-trigger-width] min-w-72 p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Buscar centro de custo…" />
                              <CommandList
                                onWheel={(e) => {
                                  e.stopPropagation();
                                  e.currentTarget.scrollTop += e.deltaY;
                                }}
                              >
                                <CommandEmpty>
                                  Nenhum centro de custo encontrado.
                                </CommandEmpty>
                                <CommandGroup>
                                  {hierarchicalCostCenters.map((cc) => {
                                    const balance = costCenterBalances[cc.id];
                                    const isSelected = field.value === cc.id;
                                    // Arquivado só aparece na conta que já
                                    // está nele.
                                    if (cc.archived && !isSelected) return null;
                                    // Despesa só entra em centro de último
                                    // grau. Os intermediários ficam à vista
                                    // para dar contexto da árvore, mas não são
                                    // selecionáveis: o servidor os recusaria.
                                    const isBranch = parentIds.has(cc.id);
                                    return (
                                      <CommandItem
                                        key={cc.id}
                                        value={`${cc.name} ${cc.code}`}
                                        disabled={isBranch}
                                        onSelect={() => {
                                          if (isBranch) return;
                                          field.onChange(cc.id);
                                          setOpenCostCenterCombobox(null);
                                        }}
                                        className={cn(
                                          "flex items-center gap-0",
                                          isBranch &&
                                            "opacity-45 data-disabled:pointer-events-none",
                                        )}
                                      >
                                        <div
                                          className="flex w-full items-center gap-1.5"
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
                                          {isBranch ? (
                                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                              só agrupa
                                            </span>
                                          ) : (
                                            balance !== undefined && (
                                              <span
                                                className={cn(
                                                  "ml-auto shrink-0 text-xs font-financial",
                                                  balance > 0
                                                    ? "text-green-700 dark:text-green-400"
                                                    : "text-muted-foreground",
                                                )}
                                              >
                                                {formatCurrency(balance)}
                                              </span>
                                            )
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {isSplit && (
                    <>
                      {/* No estreito, % e R$ descem para a linha de baixo. */}
                      <div className="col-span-2 row-start-2 grid grid-cols-2 gap-2 @lg:contents">
                        <Input
                          aria-label={`Percentual do centro ${index + 1}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step="0.01"
                          value={allocations?.[index]?.percentage ?? 0}
                          onChange={(e) =>
                            setPercentage(index, Number(e.target.value) || 0)
                          }
                          className="font-financial"
                        />
                        <CurrencyInput
                          aria-label={`Valor do centro ${index + 1}`}
                          aria-invalid={!!allocationRootError}
                          value={allocations?.[index]?.amount || undefined}
                          onChange={(v) => setAllocationAmount(index, v)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="col-start-2 row-start-1 @lg:col-start-auto @lg:row-start-auto"
                        aria-label={`Remover centro ${index + 1}`}
                        onClick={() => removeAllocationRow(index)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </>
                  )}
                </div>
              ))}

              {isSplit && (
                <div className="grid grid-cols-[1fr_auto] gap-2 border-t pt-2 text-sm font-financial @lg:grid-cols-[1fr_5.5rem_9rem_2.25rem]">
                  <span
                    className={cn(
                      "font-sans text-xs",
                      allocationRemaining.intValue !== 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {allocationRemaining.intValue === 0
                      ? "Rateio fechado"
                      : allocationRemaining.value > 0
                        ? `Faltam ${formatCurrency(allocationRemaining.value)}`
                        : `Passou ${formatCurrency(-allocationRemaining.value)}`}
                  </span>
                  <span className="hidden px-3 @lg:block">
                    {percentTotal.value}%
                  </span>
                  <span className="px-3">
                    {formatCurrency(allocatedTotal.value)}
                  </span>
                </div>
              )}

              {allocationRootError && (
                <p className="text-xs text-destructive">
                  {allocationRootError}
                </p>
              )}

              {balanceWarning && (
                <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {balanceWarning} O lançamento será recusado; peça ao gestor
                    financeiro a distribuição de recursos.
                  </span>
                </p>
              )}

              {sendsForApproval &&
                approvers.map((a) =>
                  a.email ? (
                    <p key={a.name} className="text-xs text-muted-foreground">
                      Ao enviar, o pedido de aprovação vai para{" "}
                      <span className="text-foreground">{a.email}</span> (
                      {a.name}).
                    </p>
                  ) : (
                    <p
                      key={a.name}
                      className="text-xs text-amber-800 dark:text-amber-300"
                    >
                      {a.name} não tem aprovador definido: ninguém é avisado por
                      e-mail, e a conta fica em Pendentes.
                    </p>
                  ),
                )}
            </div>
          ) : (
            <div
              className={cn(
                "col-span-12 space-y-2",
                hasAccounts && "@2xl:col-span-7",
              )}
            >
              <p className={groupLabelClass}>Centro de custo</p>
              <p className="flex min-h-9 items-center text-sm text-muted-foreground">
                {rootCostCenter ? (
                  <span>
                    Credita{" "}
                    <span className="font-medium text-foreground">
                      {rootCostCenter.name}
                    </span>{" "}
                    (raiz) automaticamente.{" "}
                    <Link
                      href="/centros-custo/distribuicao"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Distribuição de envelope
                    </Link>
                  </span>
                ) : (
                  "Nenhum centro raiz cadastrado. Cadastre a árvore de centros de custo antes de lançar receitas."
                )}
              </p>
              {errors.costCenterAllocation && (
                <p className="text-xs text-destructive">
                  {rootCostCenter
                    ? "Os centros de custo ainda estão carregando. Tente salvar de novo em instantes."
                    : "Sem centro raiz não é possível lançar a receita."}
                </p>
              )}
            </div>
          )}

          {hasAccounts && (
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem className="col-span-12 @2xl:col-span-5">
                  <FormLabel required={accountRequired} className="gap-1.5">
                    Conta contábil
                    <FillMark source={autoFilled.accountId} />
                  </FormLabel>
                  <FormControl>
                    <div>
                      <AccountSelect
                        accounts={accounts}
                        nature={nature}
                        value={field.value}
                        onChange={(id) => {
                          field.onChange(id);
                          form.clearErrors("accountId");
                        }}
                      />
                    </div>
                  </FormControl>
                  {selectedAccount?.description && (
                    <FormDescription className="text-xs">
                      {selectedAccount.description}
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* ── Repetição ─────────────────────────────────────────────── */}
          {isCreate && (
            <div className="col-span-12 space-y-3">
              <p id="repetition-label" className={groupLabelClass}>
                Repetição
              </p>
              <div
                role="radiogroup"
                aria-labelledby="repetition-label"
                className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
                onKeyDown={(e) => {
                  const step =
                    e.key === "ArrowRight" || e.key === "ArrowDown"
                      ? 1
                      : e.key === "ArrowLeft" || e.key === "ArrowUp"
                        ? -1
                        : 0;
                  if (!step) return;
                  e.preventDefault();
                  const next =
                    REPETITIONS[
                      (REPETITIONS.indexOf(repetition) +
                        step +
                        REPETITIONS.length) %
                        REPETITIONS.length
                    ];
                  setRepetition(next);
                  repetitionRefs.current[next]?.focus();
                }}
              >
                {REPETITIONS.map((r) => (
                  <button
                    key={r}
                    ref={(el) => {
                      repetitionRefs.current[r] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={repetition === r}
                    tabIndex={repetition === r ? 0 : -1}
                    onClick={() => setRepetition(r)}
                    className={cn(
                      "inline-flex h-full items-center rounded-md border border-transparent px-3 text-sm font-medium transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      repetition === r
                        ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                        : "hover:text-foreground",
                    )}
                  >
                    {REPETITION_LABEL[r]}
                  </button>
                ))}
              </div>

              {repetition === "installment" && (
                <div className="grid grid-cols-12 gap-x-4 gap-y-3">
                  <FormField
                    control={form.control}
                    name="installmentsCount"
                    render={({ field }) => (
                      <FormItem className="col-span-6 @2xl:col-span-3">
                        <FormLabel>Parcelas</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={2}
                            max={120}
                            {...field}
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                              )
                            }
                            className="font-financial"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="col-span-12 space-y-2 @2xl:col-span-9">
                    {installmentPreview.length > 0 ? (
                      <div className="max-h-48 overflow-y-auto rounded-md border">
                        <table className="w-full text-sm font-financial">
                          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-1.5 text-left font-medium">
                                Parcela
                              </th>
                              <th className="px-3 py-1.5 text-left font-medium">
                                Vencimento
                              </th>
                              <th className="px-3 py-1.5 text-right font-medium">
                                Valor
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {installmentPreview.map((p) => (
                              <tr key={p.n}>
                                <td className="px-3 py-1">
                                  {p.n}/{installmentPreview.length}
                                </td>
                                <td className="px-3 py-1">
                                  {format(p.date, "dd/MM/yyyy")}
                                </td>
                                <td className="px-3 py-1 text-right">
                                  {formatCurrency(p.value)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground @2xl:pt-7">
                        Informe valor e 1º vencimento para ver as parcelas.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {form.watch("competence")
                        ? "Com competência preenchida, todas as parcelas entram no mesmo mês da DRE."
                        : "Sem competência, cada parcela entra na DRE no mês em que for paga."}
                    </p>
                  </div>
                </div>
              )}

              {recurringMode && (
                <div className="grid grid-cols-12 gap-x-4 gap-y-3">
                  <FormField
                    control={form.control}
                    name="recurrence.frequency"
                    render={({ field }) => (
                      <FormItem className="col-span-6 @2xl:col-span-3">
                        <FormLabel>Frequência</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || "monthly"}
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
                  <FormField
                    control={form.control}
                    name="recurrence.endDate"
                    render={({ field, fieldState }) => (
                      <FormItem className="col-span-6 @2xl:col-span-3">
                        <FormLabel>Termina em</FormLabel>
                        <FormControl>
                          <DateField
                            key={resetKey}
                            value={field.value}
                            onChange={field.onChange}
                            onBadInput={markBadInput("recurrence.endDate")}
                            invalid={!!fieldState.error}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <p className="col-span-12 text-xs text-muted-foreground">
                    Cada ocorrência é gerada na data devida, a partir da 1ª. Sem
                    data de término, segue até ser pausada em Recorrências. Nº
                    do documento, competência, linha digitável e anexos são de
                    cada ocorrência: informe no lançamento gerado.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Mais detalhes ─────────────────────────────────────────────── */}
        <Collapsible
          open={moreOpen}
          onOpenChange={setMoreOpen}
          className="border-t pt-4"
        >
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-left">
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                !moreOpen && "-rotate-90",
              )}
            />
            <span className="text-sm font-semibold">Mais detalhes</span>
            <span className="truncate text-xs text-muted-foreground">
              {isPayable ? "reembolso, " : ""}área solicitante, observações
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid grid-cols-12 gap-x-4 gap-y-5 pt-5">
            {isPayable && (
              <FormField
                control={form.control}
                name="isReimbursement"
                render={({ field }) => (
                  <FormItem className="col-span-12 flex-row items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                        className="mt-0.5"
                      />
                    </FormControl>
                    <div className="space-y-0.5">
                      <FormLabel className="cursor-pointer">
                        Despesa de reembolso
                      </FormLabel>
                      <FormDescription className="text-xs">
                        Paga por um funcionário, que será reembolsado pela
                        empresa.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="requestOrigin.type"
              render={({ field }) => (
                <FormItem className="col-span-6 @2xl:col-span-3">
                  <FormLabel>Área solicitante</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="department">Departamento</SelectItem>
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
                <FormItem className="col-span-6 @2xl:col-span-9">
                  <FormLabel>Nome da área</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: Marketing"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="details"
              render={({ field }) => (
                <FormItem className="col-span-12">
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Contexto, justificativa, combinados com o fornecedor…"
                      className="min-h-20 resize-y"
                      maxLength={2000}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <div className="flex items-center justify-between gap-2">
                    <FormDescription className="text-xs">
                      Aparece nos detalhes do lançamento.
                    </FormDescription>
                    {(field.value?.length ?? 0) > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {field.value?.length ?? 0}/2000
                      </span>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Observações vindas da leitura do documento ou da importação. */}
            {form.watch("notes") && (
              <div className="col-span-12 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Lido do documento
                </p>
                <p className="whitespace-pre-wrap text-sm text-foreground/80">
                  {form.watch("notes")}
                </p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* ── Duplicata ─────────────────────────────────────────────────── */}
        {duplicate && (
          <div ref={duplicateRef}>
            <Alert className="border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <AlertDescription className="space-y-2 text-sm">
                <p>
                  <span className="font-medium text-foreground">
                    Possível duplicata
                  </span>{" "}
                  ({duplicate.reason}): {duplicate.transaction.description},{" "}
                  <span className="font-financial">
                    {formatCurrency(duplicate.transaction.amount)}
                  </span>
                  , vence{" "}
                  <span className="font-financial">
                    {format(duplicate.transaction.dueDate, "dd/MM/yyyy")}
                  </span>
                  .
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    duplicateAcknowledged.current = true;
                    setDuplicate(null);
                  }}
                >
                  Não é duplicata
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* ── Rodapé ────────────────────────────────────────────────────── */}
        <div className="sticky bottom-0 z-10 mx-[calc(var(--form-inset,0px)*-1)] space-y-2 border-t bg-background px-(--form-inset,0px) py-3">
          {errorCount > 0 && (
            <button
              type="button"
              onClick={focusFirstError}
              className="text-xs font-medium text-destructive hover:underline"
            >
              {errorCount === 1
                ? "1 campo precisa de atenção"
                : `${errorCount} campos precisam de atenção`}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {isCreate && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={keepOpen}
                  onCheckedChange={(v) => setKeepOpen(!!v)}
                />
                Criar outra em seguida
              </label>
            )}
            {checkingDuplicate ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Verificando duplicidade…
              </span>
            ) : (
              <span className="hidden text-xs text-muted-foreground @xl:inline">
                <kbd className="rounded border px-1 font-sans">Ctrl</kbd>/
                <kbd className="rounded border px-1 font-sans">⌘</kbd>+
                <kbd className="rounded border px-1 font-sans">Enter</kbd>{" "}
                {sendsForApproval ? "envia" : "salva"}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={busy}
              >
                Cancelar
              </Button>
              {sendsForApproval && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void submitWith("draft")}
                >
                  Salvar rascunho
                </Button>
              )}
              <Button type="submit" loading={busy}>
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
