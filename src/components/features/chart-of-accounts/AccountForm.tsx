"use client";

import { ReactNode, useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartAccountFormData,
  chartAccountSchema,
} from "@/lib/validations/chartAccount";
import { AccountNature, ChartAccount, DreGroup } from "@/lib/types";
import {
  ACCOUNT_NATURE_LABEL,
  AccountDraft,
  DRE_GROUP_LABEL,
  DRE_GROUPS,
  groupFitsNature,
  groupResolver,
  nextChildCode,
  parentCodeOf,
  withLevels,
} from "@/lib/chartOfAccounts";

const ROOT = "__root__";

interface AccountFormProps {
  accounts: ChartAccount[];
  editing?: ChartAccount | null;
  /** "Adicionar subconta": já abre dentro desta conta. */
  parentCode?: string | null;
  isLoading: boolean;
  onSubmit: (draft: AccountDraft) => Promise<void>;
  onCancel: () => void;
  /** Ações da conta no lado esquerdo do rodapé (arquivar, excluir). */
  footerStart?: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * O código é a única fonte da hierarquia. "Conta superior" só ajuda a
 * preenchê-lo — escolher um pai sugere o próximo código livre dentro dele, e
 * digitar um código mostra de qual conta ele é filho.
 */
export function AccountForm({
  accounts,
  editing,
  parentCode,
  isLoading,
  onSubmit,
  onCancel,
  footerStart,
  onDirtyChange,
}: AccountFormProps) {
  const others = useMemo(
    () => accounts.filter((a) => a.id !== editing?.id),
    [accounts, editing],
  );
  const parentFor = (pc: string | null) =>
    pc ? others.find((a) => a.code === pc) : undefined;
  const initialParent = parentFor(parentCode ?? null);

  const form = useForm<ChartAccountFormData>({
    resolver: zodResolver(chartAccountSchema),
    defaultValues: editing
      ? {
          code: editing.code,
          name: editing.name,
          type: editing.type,
          nature: editing.nature,
          dreGroup: editing.dreGroup ?? "inherit",
          description: editing.description ?? "",
        }
      : {
          code: nextChildCode(others, parentCode ?? null),
          name: "",
          type: "analytic",
          nature: initialParent?.nature ?? "expense",
          dreGroup: initialParent ? "inherit" : "",
          description: "",
        },
  });

  // `useWatch`, não `form.watch()`: este o React Compiler não consegue
  // memoizar e desliga a otimização do componente inteiro.
  const [code, type, nature] = useWatch({
    control: form.control,
    name: ["code", "type", "nature"],
  });
  const { isDirty } = form.formState;
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const parent = parentFor(parentCodeOf(code.trim()));

  // Código e natureza descem a subárvore: quem salva precisa ver o alcance.
  const descendants = editing
    ? others.filter((a) => a.code.startsWith(`${editing.code}.`))
    : [];
  const newCode = code.trim();
  const renaming = descendants.length > 0 && newCode !== editing?.code;
  const effectiveNature = parent?.nature ?? nature;
  const natureCascade =
    descendants.length > 0 && effectiveNature !== editing?.nature;
  const touched = renaming || natureCascade ? descendants.length + 1 : 0;
  const natureHint = parent
    ? "Igual à da conta superior."
    : natureCascade
      ? `Muda também nas ${descendants.length} subcontas.`
      : effectiveNature === "balance"
        ? "Ativo e passivo: aparece em contas a pagar e a receber, fora do resultado."
        : null;
  const inherited = parent ? groupResolver(others)(parent.code) : undefined;
  const synthetics = withLevels(
    others.filter(
      (a) =>
        a.type === "synthetic" &&
        // Não pode ficar dentro de si mesma nem de uma descendente.
        !(editing && (a.code + ".").startsWith(editing.code + ".")),
    ),
  );

  const groupOptions = DRE_GROUPS.filter((g) =>
    groupFitsNature(g.value, nature),
  );
  const canInherit = !!inherited && groupFitsNature(inherited, nature);

  const submit = (data: ChartAccountFormData) => {
    if (data.dreGroup === "" && data.type === "analytic") {
      form.setError("dreGroup", { message: "Escolha a linha da DRE" });
      return;
    }
    return onSubmit({
      code: data.code.trim(),
      name: data.name.trim(),
      type: data.type,
      // Com conta superior, a natureza é sempre a dela.
      nature: parent?.nature ?? data.nature,
      dreGroup:
        data.dreGroup === "inherit" || data.dreGroup === ""
          ? undefined
          : (data.dreGroup as DreGroup),
      description: data.description?.trim() || undefined,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-4">
          <FormItem>
            <FormLabel>Conta superior</FormLabel>
            <Select
              value={parent?.code ?? ROOT}
              onValueChange={(pc) => {
                const next = pc === ROOT ? null : pc;
                form.setValue("code", nextChildCode(others, next), {
                  shouldValidate: true,
                });
                const p = parentFor(next);
                if (p) {
                  form.setValue("nature", p.nature);
                  form.setValue("dreGroup", "inherit");
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={ROOT}>Nenhuma (primeiro nível)</SelectItem>
                {synthetics.map((a) => (
                  <SelectItem key={a.id} value={a.code}>
                    <span style={{ paddingLeft: `${a.level * 12}px` }}>
                      <span className="font-financial tabular-nums text-xs text-muted-foreground mr-1.5">
                        {a.code}
                      </span>
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>

          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Código</FormLabel>
                <FormControl>
                  <Input className="font-financial tabular-nums" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {renaming && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" role="status">
            O código das {descendants.length} subcontas muda junto:{" "}
            <span className="font-financial tabular-nums">
              {descendants[0].code} → {newCode}
              {descendants[0].code.slice(editing!.code.length)}
            </span>
            {descendants.length > 1 && " e as demais"}.
          </p>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input placeholder="Ex.: Energia elétrica" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="analytic">
                      Analítica (recebe lançamentos)
                    </SelectItem>
                    <SelectItem value="synthetic">
                      Sintética (agrupa outras contas)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nature"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Natureza</FormLabel>
                <Select
                  value={parent?.nature ?? field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    const g = form.getValues("dreGroup");
                    if (
                      g &&
                      g !== "inherit" &&
                      !groupFitsNature(g as DreGroup, v as AccountNature)
                    ) {
                      form.setValue("dreGroup", "");
                    }
                  }}
                  disabled={!!parent}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="revenue">
                      {ACCOUNT_NATURE_LABEL.revenue} (entrada)
                    </SelectItem>
                    <SelectItem value="expense">
                      {ACCOUNT_NATURE_LABEL.expense} (saída)
                    </SelectItem>
                    <SelectItem value="balance">
                      {ACCOUNT_NATURE_LABEL.balance} (entrada e saída)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {natureHint && <FormDescription>{natureHint}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="dreGroup"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Linha da DRE
                {type === "synthetic" && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (opcional)
                  </span>
                )}
              </FormLabel>
              <Select
                value={field.value || (canInherit ? "inherit" : "")}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {canInherit && (
                    <SelectItem value="inherit">
                      Da conta superior ({DRE_GROUP_LABEL[inherited!]})
                    </SelectItem>
                  )}
                  {groupOptions.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                {DRE_GROUPS.find((g) => g.value === field.value)?.hint ??
                  "Onde a conta aparece no Demonstrativo de Resultados."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Quando usar{" "}
                <span className="text-muted-foreground font-normal">
                  (opcional)
                </span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex.: contas de luz de todas as unidades. Não inclui instalação elétrica (Manutenção)."
                  className="min-h-[70px] resize-y"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                Aparece para quem lança, para escolher a conta certa.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-2 border-t bg-background px-6 py-3">
          {footerStart}
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isLoading}>
              {!editing
                ? "Criar conta"
                : touched
                  ? `Salvar ${touched} contas`
                  : "Salvar alterações"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
