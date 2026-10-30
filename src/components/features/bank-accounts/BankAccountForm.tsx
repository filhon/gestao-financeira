"use client";

import { useEffect, useMemo } from "react";
import currency from "currency.js";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AccountSelect } from "@/components/features/chart-of-accounts/AccountSelect";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCostCenters } from "@/hooks/useCostCenters";
import { getHierarchicalCostCenters } from "@/lib/services/costCenterService";
import { PRODUCT_LABEL, tracksCdi } from "@/lib/investment";
import {
  BankAccountFormData,
  bankAccountSchema,
} from "@/lib/validations/bankAccount";
import { BankAccountDraft } from "@/lib/services/bankAccountService";
import { BankAccount } from "@/lib/types";
import { isInvestment } from "@/lib/bankReconciliation";
import { cn, formatCurrency } from "@/lib/utils";

interface BankAccountFormProps {
  companyId: string;
  editing?: BankAccount | null;
  /** Para escolher a conta corrente de onde vêm as aplicações. */
  accounts: BankAccount[];
  isLoading: boolean;
  onSubmit: (draft: BankAccountDraft) => Promise<void>;
  onCancel: () => void;
  /** Para o painel avisar antes de descartar o que foi preenchido. */
  onDirtyChange?: (dirty: boolean) => void;
}

const blank = (v?: string) => (v?.trim() ? v.trim() : undefined);

export function BankAccountForm({
  companyId,
  editing,
  accounts,
  isLoading,
  onSubmit,
  onCancel,
  onDirtyChange,
}: BankAccountFormProps) {
  const openingLocked = !!editing?.closings?.length;
  const { accounts: chartAccounts } = useChartOfAccounts(companyId);
  const checking = accounts.filter(
    (a) => a.active && !isInvestment(a) && a.id !== editing?.id,
  );

  const form = useForm<BankAccountFormData>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      kind: editing?.kind ?? "checking",
      name: editing?.name ?? "",
      bankName: editing?.bankName ?? "",
      bankCode: editing?.bankCode ?? "",
      agency: editing?.agency ?? "",
      accountNumber: editing?.accountNumber ?? "",
      product: editing?.product ?? "cdb",
      liquidity: editing?.liquidity ?? "daily",
      linkedAccountId:
        editing?.linkedAccountId ??
        (checking.length === 1 ? checking[0].id : undefined),
      yieldAccountId: editing?.yieldAccountId,
      cdiPercent: editing?.cdiPercent ?? (editing ? undefined : 100),
      taxExempt: editing?.taxExempt ?? false,
      taxAccountId: editing?.taxAccountId,
      taxCostCenterId: editing?.taxCostCenterId,
      openingPrincipal: editing?.openingPrincipal,
      openingBalance: Math.abs(editing?.openingBalance ?? 0),
      overdrawn: (editing?.openingBalance ?? 0) < 0,
      // Conta nova começa sem data: hoje quase nunca é o dia certo, e a data
      // trava quando a conta fecha o primeiro período.
      openingBalanceDate: editing
        ? format(editing.openingBalanceDate, "yyyy-MM-dd")
        : "",
      active: editing?.active ?? true,
    },
  });
  const [
    kind,
    product,
    taxExempt,
    linkedAccountId,
    openingBalance,
    openingPrincipal,
    openingBalanceDate,
  ] = useWatch({
    control: form.control,
    name: [
      "kind",
      "product",
      "taxExempt",
      "linkedAccountId",
      "openingBalance",
      "openingPrincipal",
      "openingBalanceDate",
    ],
  });
  const investment = kind === "investment";
  const withCdi = tracksCdi({ kind, product });
  const linked = checking.find((a) => a.id === linkedAccountId);
  const linkedDate = linked
    ? format(linked.openingBalanceDate, "yyyy-MM-dd")
    : "";

  const { isDirty, dirtyFields } = form.formState;

  // Aplicação nova começa na data da conta corrente, até a pessoa digitar outra.
  useEffect(() => {
    if (editing || !investment || !linkedDate) return;
    if (dirtyFields.openingBalanceDate) return;
    form.setValue("openingBalanceDate", linkedDate);
  }, [editing, investment, linkedDate, dirtyFields.openingBalanceDate, form]);

  // Plano com uma só conta possível: já vem escolhida, a pessoa só confere.
  useEffect(() => {
    if (editing || !investment) return;
    for (const [field, nature] of [
      ["yieldAccountId", "revenue"],
      ["taxAccountId", "expense"],
    ] as const) {
      const options = chartAccounts.filter(
        (a) => a.type === "analytic" && a.nature === nature && !a.archived,
      );
      if (options.length === 1 && !dirtyFields[field]) {
        form.setValue(field, options[0].id);
      }
    }
  }, [editing, investment, chartAccounts, dirtyFields, form]);

  const { costCenters } = useCostCenters(companyId);
  // IR retido é despesa: só centro de último grau.
  const leaves = useMemo(() => {
    const parents = new Set(costCenters.map((cc) => cc.parentId));
    return getHierarchicalCostCenters(costCenters).filter(
      (cc) => !cc.archived && !parents.has(cc.id),
    );
  }, [costCenters]);

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const submit = (data: BankAccountFormData) => {
    const [y, m, d] = data.openingBalanceDate.split("-").map(Number);
    const inv = data.kind === "investment";
    return onSubmit({
      kind: data.kind,
      name: data.name.trim(),
      bankName: blank(data.bankName),
      bankCode: blank(data.bankCode),
      agency: blank(data.agency),
      accountNumber: data.accountNumber.trim(),
      product: inv ? data.product : undefined,
      liquidity: inv ? data.liquidity : undefined,
      linkedAccountId: inv ? data.linkedAccountId : undefined,
      yieldAccountId: inv ? data.yieldAccountId : undefined,
      cdiPercent: inv && tracksCdi(data) ? data.cdiPercent : undefined,
      taxExempt: inv ? data.taxExempt : undefined,
      taxAccountId: inv && !data.taxExempt ? data.taxAccountId : undefined,
      taxCostCenterId:
        inv && !data.taxExempt ? data.taxCostCenterId : undefined,
      openingPrincipal: inv ? data.openingPrincipal : undefined,
      openingBalance:
        data.overdrawn && !inv ? -data.openingBalance : data.openingBalance,
      openingBalanceDate: new Date(y, m - 1, d),
      active: data.active,
    });
  };

  const section = "space-y-4 border-t pt-5 first:border-t-0 first:pt-0";
  const sectionTitle = "text-sm font-semibold";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sr-only">Tipo</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!!editing}
                    className="grid grid-cols-2 gap-2"
                  >
                    {(
                      [
                        [
                          "checking",
                          "Conta corrente",
                          "Extrato importado e conciliado",
                        ],
                        ["investment", "Aplicação", "CDB, fundo, Tesouro"],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <label
                        key={value}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                          field.value === value
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50",
                          editing && "cursor-default opacity-70",
                        )}
                      >
                        <RadioGroupItem value={value} className="mt-0.5" />
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {hint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
              </FormItem>
            )}
          />

          <section className={section}>
            <h3 className={sectionTitle}>Identificação</h3>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Nome</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={investment ? "CDB Itaú" : "Itaú movimento"}
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className={cn(
                "grid gap-4",
                !investment && "sm:grid-cols-[1fr_110px]",
              )}
            >
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{investment ? "Emissor" : "Banco"}</FormLabel>
                    <FormControl>
                      <Input placeholder="Itaú Unibanco" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!investment && (
                <FormField
                  control={form.control}
                  name="bankCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cód. banco</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="341"
                          inputMode="numeric"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {investment ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="product"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Produto</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(PRODUCT_LABEL).map(([v, l]) => (
                            <SelectItem key={v} value={v}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="liquidity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Liquidez</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="daily">Diária</SelectItem>
                          <SelectItem value="maturity">
                            No vencimento
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                  <FormField
                    control={form.control}
                    name="agency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Agência</FormLabel>
                        <FormControl>
                          <Input placeholder="0001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="accountNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>Conta</FormLabel>
                        <FormControl>
                          <Input placeholder="12345-6" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Banco, agência e conta são usados para reconhecer o extrato
                  OFX desta conta na importação.
                </p>
              </>
            )}
          </section>

          {investment && (
            <section className={section}>
              <h3 className={sectionTitle}>Vínculo</h3>
              <FormField
                control={form.control}
                name="linkedAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Conta corrente vinculada</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v || undefined)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione a conta" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {checking.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {checking.length === 0
                        ? "Cadastre antes a conta corrente de onde saem as aplicações."
                        : "Aplicações e resgates aparecem no extrato desta conta."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>
          )}

          {investment && (
            <section className={section}>
              <h3 className={sectionTitle}>Rendimento</h3>
              {withCdi && (
                <FormField
                  control={form.control}
                  name="cdiPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Taxa contratada</FormLabel>
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min={0}
                            placeholder="100"
                            className="w-28 font-financial tabular-nums"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === ""
                                  ? undefined
                                  : e.target.valueAsNumber,
                              )
                            }
                          />
                        </FormControl>
                        <span className="text-sm text-muted-foreground">
                          % do CDI
                        </span>
                      </div>
                      <FormDescription>
                        Estima o saldo diário para conferir com o banco. Vazio:
                        sem estimativa.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="yieldAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conta contábil do rendimento</FormLabel>
                    {chartAccounts.length > 0 ? (
                      <>
                        <AccountSelect
                          accounts={chartAccounts}
                          nature="revenue"
                          value={field.value}
                          onChange={field.onChange}
                          allowClear
                        />
                        <FormDescription>
                          Obrigatória para fechar o exercício.
                        </FormDescription>
                      </>
                    ) : (
                      <FormDescription>
                        O plano de contas está vazio.{" "}
                        <Link
                          href="/cadastros/plano-de-contas"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          Cadastre a conta de receita
                        </Link>{" "}
                        para escolhê-la aqui.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>
          )}

          {investment && (
            <section className={section}>
              <h3 className={sectionTitle}>IR retido</h3>
              <FormField
                control={form.control}
                name="taxExempt"
                render={({ field }) => (
                  <FormItem className="flex-row flex-wrap items-center gap-x-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(!!v)}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      Sem IR retido (entidade imune ou isenta)
                    </FormLabel>
                    {(product === "lci_lca" || product === "savings") && (
                      <FormDescription className="basis-full pl-6">
                        Na empresa,{" "}
                        {product === "savings" ? "poupança" : "LCI/LCA"} também
                        tem IR.
                      </FormDescription>
                    )}
                  </FormItem>
                )}
              />

              {!taxExempt && (
                <>
                  <FormField
                    control={form.control}
                    name="taxCostCenterId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Centro de custo</FormLabel>
                        <Select
                          value={field.value ?? ""}
                          onValueChange={(v) => field.onChange(v || undefined)}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Selecione o centro de custo" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {leaves.map((cc) => (
                              <SelectItem key={cc.id} value={cc.id}>
                                {cc.code ? `${cc.code} · ${cc.name}` : cc.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          IR e IOF retidos no resgate entram como despesa aqui,
                          ao fechar o período.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {chartAccounts.length > 0 && (
                    <FormField
                      control={form.control}
                      name="taxAccountId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Conta contábil</FormLabel>
                          <AccountSelect
                            accounts={chartAccounts}
                            nature="expense"
                            value={field.value}
                            onChange={field.onChange}
                            allowClear
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}
            </section>
          )}

          <section className={section}>
            <h3 id="opening-title" className={sectionTitle}>
              {investment ? "Saldo bruto de abertura" : "Saldo de abertura"}
            </h3>
            <fieldset
              disabled={openingLocked}
              aria-labelledby="opening-title"
              className="min-w-0 space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="openingBalance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Saldo</FormLabel>
                      <FormControl>
                        <CurrencyInput
                          value={field.value}
                          onChange={field.onChange}
                          className="font-financial tabular-nums"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {investment && !taxExempt && (
                  <FormField
                    control={form.control}
                    name="openingPrincipal"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor aplicado (custo)</FormLabel>
                        <FormControl>
                          <CurrencyInput
                            value={field.value}
                            onChange={(v) => field.onChange(v || undefined)}
                            placeholder={formatCurrency(openingBalance ?? 0)}
                            className="font-financial tabular-nums"
                          />
                        </FormControl>
                        <FormDescription>
                          {openingPrincipal && openingPrincipal < openingBalance
                            ? `Rendimento já acumulado: ${formatCurrency(
                                currency(openingBalance).subtract(
                                  openingPrincipal,
                                ).value,
                              )}. Paga IR no resgate.`
                            : "Vazio: todo o saldo é dinheiro aplicado."}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="openingBalanceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Data do saldo (fim do dia)</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          max={format(new Date(), "yyyy-MM-dd")}
                          {...field}
                        />
                      </FormControl>
                      {investment &&
                        linked &&
                        openingBalanceDate === linkedDate && (
                          <FormDescription>
                            Mesma data de {linked.name}.
                          </FormDescription>
                        )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {!investment && (
                <FormField
                  control={form.control}
                  name="overdrawn"
                  render={({ field }) => (
                    <FormItem className="flex-row items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(v) => field.onChange(!!v)}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">
                        Saldo devedor (negativo)
                      </FormLabel>
                    </FormItem>
                  )}
                />
              )}
              <FormDescription>
                {openingLocked
                  ? "Travado: a conta já tem período conciliado. Reabra os fechamentos para alterar."
                  : investment
                    ? "Saldo bruto, antes do IR, como o banco mostra ao fim desse dia."
                    : "Saldo do extrato no dia anterior ao primeiro lançamento a conciliar. A data trava no primeiro fechamento."}
              </FormDescription>
            </fieldset>
          </section>

          {editing && (
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(!!v)}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">Conta ativa</FormLabel>
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading}>
            {editing
              ? "Salvar"
              : investment
                ? "Cadastrar aplicação"
                : "Cadastrar conta"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
