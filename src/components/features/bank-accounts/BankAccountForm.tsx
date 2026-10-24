"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
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
  BankAccountFormData,
  bankAccountSchema,
} from "@/lib/validations/bankAccount";
import { BankAccountDraft } from "@/lib/services/bankAccountService";
import { BankAccount } from "@/lib/types";

interface BankAccountFormProps {
  editing?: BankAccount | null;
  isLoading: boolean;
  onSubmit: (draft: BankAccountDraft) => Promise<void>;
  onCancel: () => void;
}

const blank = (v?: string) => (v?.trim() ? v.trim() : undefined);

export function BankAccountForm({
  editing,
  isLoading,
  onSubmit,
  onCancel,
}: BankAccountFormProps) {
  const openingLocked = !!editing?.closings?.length;

  const form = useForm<BankAccountFormData>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      name: editing?.name ?? "",
      bankName: editing?.bankName ?? "",
      bankCode: editing?.bankCode ?? "",
      agency: editing?.agency ?? "",
      accountNumber: editing?.accountNumber ?? "",
      openingBalance: Math.abs(editing?.openingBalance ?? 0),
      overdrawn: (editing?.openingBalance ?? 0) < 0,
      openingBalanceDate: format(
        editing?.openingBalanceDate ?? new Date(),
        "yyyy-MM-dd",
      ),
      active: editing?.active ?? true,
    },
  });

  const submit = (data: BankAccountFormData) => {
    const [y, m, d] = data.openingBalanceDate.split("-").map(Number);
    return onSubmit({
      name: data.name.trim(),
      bankName: blank(data.bankName),
      bankCode: blank(data.bankCode),
      agency: blank(data.agency),
      accountNumber: data.accountNumber.trim(),
      openingBalance: data.overdrawn
        ? -data.openingBalance
        : data.openingBalance,
      openingBalanceDate: new Date(y, m - 1, d),
      active: data.active,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input placeholder="Itaú movimento" autoFocus {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-[1fr_96px]">
          <FormField
            control={form.control}
            name="bankName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Banco</FormLabel>
                <FormControl>
                  <Input placeholder="Itaú Unibanco" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bankCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Código</FormLabel>
                <FormControl>
                  <Input placeholder="341" inputMode="numeric" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

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
                <FormLabel>Conta</FormLabel>
                <FormControl>
                  <Input placeholder="12345-6" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Banco e conta são usados para reconhecer o extrato OFX desta conta na
          importação.
        </p>

        <fieldset
          disabled={openingLocked}
          className="space-y-3 rounded-lg border p-4"
        >
          <legend className="px-1 text-sm font-medium">
            Saldo de abertura
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="openingBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Saldo</FormLabel>
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
            <FormField
              control={form.control}
              name="openingBalanceDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ao fim do dia</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="overdrawn"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
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
          <FormDescription>
            {openingLocked
              ? "Travado: a conta já tem período conciliado. Reabra os fechamentos para alterar."
              : "Copie do extrato o saldo do dia anterior ao primeiro lançamento que você vai conciliar."}
          </FormDescription>
        </fieldset>

        {editing && (
          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
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

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading}>
            {editing ? "Salvar" : "Cadastrar conta"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
