"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
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
import { Entity } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { entityService } from "@/lib/services/entityService";
import { cnpjService } from "@/lib/services/cnpjService";
import { validateCnpj } from "@/lib/validations/cnpj";
import { useCompany } from "@/components/providers/CompanyProvider";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Check, ChevronDown, ChevronsUpDown, Loader2 } from "lucide-react";
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
import { BRAZILIAN_BANKS } from "@/lib/banks";
import { cn, normalizeText } from "@/lib/utils";

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

const entitySchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  type: z.enum(["individual", "company"]),
  document: z.string().optional(),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  category: z.enum(["supplier", "client", "both"]),

  // Bank Details
  bankName: z.string().optional(),
  agency: z.string().optional(),
  account: z.string().optional(),
  accountType: z.enum(["checking", "savings"]).optional(),
  pixKeyType: z.enum(["cpf", "cnpj", "email", "phone", "random"]).optional(),
  pixKey: z.string().optional(),
});

type EntityFormData = z.infer<typeof entitySchema>;

const pixPlaceholders: Record<string, string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "chave@exemplo.com",
  phone: "+55 (00) 00000-0000",
  random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
};

interface EntityFormProps {
  defaultValues?: Partial<Entity>;
  onSubmit: (data: EntityFormData) => Promise<void>;
  isLoading?: boolean;
  onCancel?: () => void;
}

export function EntityForm({
  defaultValues,
  onSubmit,
  isLoading,
  onCancel,
}: EntityFormProps) {
  const { selectedCompany } = useCompany();
  const [isCheckingDocument, setIsCheckingDocument] = useState(false);
  const [isBankOpen, setIsBankOpen] = useState(false);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const form = useForm<EntityFormData>({
    resolver: zodResolver(entitySchema),
    defaultValues: {
      name: "",
      type: "company",
      document: "",
      email: "",
      phone: "",
      address: "",
      category: "supplier",
      bankName: "",
      agency: "",
      account: "",
      accountType: undefined,
      pixKeyType: undefined,
      pixKey: "",
      ...defaultValues,
    },
  });

  const lastCheckedDocument = useRef("");

  // Runs on blur and as soon as 14 digits are typed/pasted.
  // Checks for duplicates; on a new entity with a CNPJ, also fills the form from the Receita Federal.
  const checkDocument = async (raw: string) => {
    const document = raw.replace(/\D/g, "");
    if (!document || !selectedCompany) return;
    if (document === lastCheckedDocument.current) return;

    // If we are editing, and the document hasn't changed, don't check
    if (
      defaultValues?.document &&
      defaultValues.document.replace(/\D/g, "") === document
    ) {
      return;
    }
    lastCheckedDocument.current = document;

    const shouldLookup = !defaultValues?.id && document.length === 14;
    if (shouldLookup && !validateCnpj(document)) {
      form.setError("document", { type: "manual", message: "CNPJ inválido." });
      return;
    }

    setIsCheckingDocument(true);
    try {
      const exists = await entityService.checkCnpjExists(
        selectedCompany.id,
        document,
      );
      if (exists) {
        form.setError("document", {
          type: "manual",
          message: "Este documento já está cadastrado.",
        });
        return;
      }
      form.clearErrors("document");
      if (!shouldLookup) return;

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
        const { name, email, phone, address } = result.data;
        form.setValue("name", name, { shouldValidate: true });
        form.setValue("email", email, { shouldValidate: true });
        form.setValue("phone", phone);
        form.setValue("address", address);
        toast.success("Dados preenchidos a partir da Receita Federal.");
      }
    } finally {
      setIsCheckingDocument(false);
    }
  };

  useEffect(() => {
    if (defaultValues) {
      form.reset({
        name: defaultValues.name || "",
        type: defaultValues.type || "company",
        document: defaultValues.document || "",
        email: defaultValues.email || "",
        phone: defaultValues.phone || "",
        address: defaultValues.address || "",
        category: defaultValues.category || "supplier",
        bankName: defaultValues.bankName || "",
        agency: defaultValues.agency || "",
        account: defaultValues.account || "",
        accountType: defaultValues.accountType,
        pixKeyType: defaultValues.pixKeyType,
        pixKey: defaultValues.pixKey || "",
      });
    }
  }, [defaultValues, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-8">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome / Razão Social</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome da entidade" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="company">Pessoa Jurídica</SelectItem>
                      <SelectItem value="individual">Pessoa Física</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoria</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione a categoria" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="supplier">Fornecedor</SelectItem>
                      <SelectItem value="client">Cliente</SelectItem>
                      <SelectItem value="both">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-4">
            <FormField
              control={form.control}
              name="document"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPF / CNPJ</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        placeholder="000.000.000-00"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          if (e.target.value.replace(/\D/g, "").length === 14) {
                            checkDocument(e.target.value);
                          }
                        }}
                        onBlur={(e) => {
                          field.onBlur();
                          checkDocument(e.target.value);
                        }}
                      />
                      {isCheckingDocument && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input placeholder="contato@exemplo.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-4">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input placeholder="(00) 00000-0000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-8">
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endereço</FormLabel>
                  <FormControl>
                    <Input placeholder="Rua, Número, Bairro..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Collapsible open={isBankOpen} onOpenChange={setIsBankOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between w-full px-4 py-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
            >
              <span className="text-sm font-medium">
                Dados Bancários (Opcional)
              </span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isBankOpen ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 border-t-0 rounded-t-none">
              <CardHeader className="sr-only">
                <CardTitle className="text-base">
                  Dados Bancários (Opcional)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 md:col-span-6">
                    <FormField
                      control={form.control}
                      name="bankName"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
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
                                          <span className="font-mono text-muted-foreground mr-2">
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="col-span-6 md:col-span-3">
                    <FormField
                      control={form.control}
                      name="agency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Agência</FormLabel>
                          <FormControl>
                            <Input placeholder="0000" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="col-span-6 md:col-span-3">
                    <FormField
                      control={form.control}
                      name="account"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Conta</FormLabel>
                          <FormControl>
                            <Input placeholder="00000-0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="col-span-12 md:col-span-4">
                    <FormField
                      control={form.control}
                      name="accountType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Conta</FormLabel>
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
                              <SelectItem value="checking">Corrente</SelectItem>
                              <SelectItem value="savings">Poupança</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="col-span-12 md:col-span-4">
                    <FormField
                      control={form.control}
                      name="pixKeyType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Chave PIX</FormLabel>
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
                              <SelectItem value="cpf">CPF</SelectItem>
                              <SelectItem value="cnpj">CNPJ</SelectItem>
                              <SelectItem value="email">E-mail</SelectItem>
                              <SelectItem value="phone">Telefone</SelectItem>
                              <SelectItem value="random">
                                Chave Aleatória
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="col-span-12 md:col-span-4">
                    <FormField
                      control={form.control}
                      name="pixKey"
                      render={({ field }) => {
                        const pixKeyType = form.watch("pixKeyType");
                        const placeholder = pixKeyType
                          ? (pixPlaceholders[pixKeyType] ?? "Chave PIX")
                          : "Selecione o tipo primeiro";
                        return (
                          <FormItem>
                            <FormLabel>Chave PIX</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={placeholder}
                                disabled={!pixKeyType}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex justify-end gap-2 pt-4">
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
            Salvar Entidade
          </Button>
        </div>
      </form>
    </Form>
  );
}
