"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AccountSelect } from "@/components/features/chart-of-accounts/AccountSelect";
import { useCostCenters } from "@/hooks/useCostCenters";
import {
  accountRequiredFor,
  natureFitsSide,
  useChartOfAccounts,
} from "@/hooks/useChartOfAccounts";
import { getHierarchicalCostCenters } from "@/lib/services/costCenterService";
import { rulePattern } from "@/lib/bankReconciliation";
import { BankAccount, BankTransaction, ReconciliationRule } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export type LaunchTemplate = NonNullable<ReconciliationRule["template"]>;

interface QuickLaunchSheetProps {
  companyId: string;
  account: BankAccount;
  bankTx: BankTransaction | null;
  /** Só o gestor cria regra; quem não pode não vê a opção. */
  canCreateRule: boolean;
  onOpenChange: (open: boolean) => void;
  /** `pattern` vem preenchido quando o usuário pediu para virar regra. */
  onSubmit: (template: LaunchTemplate, pattern: string | null) => Promise<void>;
  onOpenFullForm: (tx: BankTransaction) => void;
}

/**
 * Lançamento direto do que só existe no banco — tarifa, IOF, juros, rendimento.
 * Sem fluxo de aprovação: o dinheiro já saiu, o lançamento nasce pago.
 */
export function QuickLaunchSheet({
  companyId,
  account,
  bankTx,
  canCreateRule,
  onOpenChange,
  onSubmit,
  onOpenFullForm,
}: QuickLaunchSheetProps) {
  const isPayable = bankTx ? bankTx.amount < 0 : true;
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState("");
  const [costCenterId, setCostCenterId] = useState<string>();
  const [accountId, setAccountId] = useState<string>();
  const [makeRule, setMakeRule] = useState(false);
  const [pattern, setPattern] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bankTx) return;
    setDescription(bankTx.description);
    setSupplier(account.bankName || account.name);
    setPattern(rulePattern(bankTx.description));
    setMakeRule(false);
  }, [bankTx, account]);

  const { costCenters } = useCostCenters(companyId);
  const root = costCenters.find((cc) => !cc.parentId || cc.parentId === "none");
  // Despesa só em centro de último grau; receita sempre na raiz.
  const leaves = useMemo(() => {
    const parents = new Set(costCenters.map((cc) => cc.parentId));
    return getHierarchicalCostCenters(costCenters).filter(
      (cc) => !cc.archived && !parents.has(cc.id),
    );
  }, [costCenters]);
  const effectiveCostCenterId = isPayable ? costCenterId : root?.id;

  const nature = isPayable ? "expense" : "revenue";
  const { accounts, requiredFrom } = useChartOfAccounts(companyId);
  const hasAccounts = accounts.some(
    (a) =>
      natureFitsSide(a.nature, nature) && a.type === "analytic" && !a.archived,
  );
  const accountRequired =
    hasAccounts &&
    !!bankTx &&
    accountRequiredFor(requiredFrom, new Date(bankTx.date));

  const normalizedPattern = rulePattern(pattern);
  const valid =
    description.trim().length >= 3 &&
    supplier.trim().length >= 2 &&
    !!effectiveCostCenterId &&
    (!accountRequired || !!accountId) &&
    (!makeRule || normalizedPattern.length >= 3);

  const close = () => {
    setCostCenterId(undefined);
    setAccountId(undefined);
    onOpenChange(false);
  };

  const submit = async () => {
    if (!valid || !effectiveCostCenterId) return;
    setSaving(true);
    try {
      await onSubmit(
        {
          description: description.trim(),
          supplierOrClient: supplier.trim(),
          costCenterId: effectiveCostCenterId,
          accountId,
        },
        makeRule ? normalizedPattern : null,
      );
      close();
    } catch {
      // O chamador já avisou; o painel fica aberto para corrigir.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!bankTx} onOpenChange={(o) => !o && close()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>
            {isPayable
              ? "Lançar despesa do extrato"
              : "Lançar receita do extrato"}
          </SheetTitle>
          {bankTx && (
            <SheetDescription asChild>
              <div className="space-y-0.5">
                <p className="truncate" title={bankTx.description}>
                  {bankTx.description}
                </p>
                <p className="font-financial tabular-nums text-foreground">
                  {format(new Date(bankTx.date), "dd/MM/yyyy")} ·{" "}
                  {formatCurrency(Math.abs(bankTx.amount))}
                </p>
              </div>
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {isPayable
              ? "Para o que só existe no banco: tarifa, IOF, juros. Nasce paga e conciliada, sem passar pela aprovação."
              : "Para o que só existe no banco: rendimento, estorno. Nasce recebida e conciliada."}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="ql-description">Descrição</Label>
            <Input
              id="ql-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ql-supplier">
              {isPayable ? "Fornecedor" : "Cliente"}
            </Label>
            <Input
              id="ql-supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Centro de custo</Label>
            {isPayable ? (
              <Select value={costCenterId} onValueChange={setCostCenterId}>
                <SelectTrigger className="w-full" aria-label="Centro de custo">
                  <SelectValue placeholder="Selecione o centro de custo" />
                </SelectTrigger>
                <SelectContent>
                  {leaves.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code ? `${cc.code} · ${cc.name}` : cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                Receita entra na raiz{root ? ` (${root.name})` : ""}.
              </p>
            )}
          </div>

          {hasAccounts && (
            <div className="space-y-1.5">
              <Label>
                Conta contábil
                {accountRequired && (
                  <span className="text-destructive"> *</span>
                )}
              </Label>
              <AccountSelect
                accounts={accounts}
                nature={nature}
                value={accountId}
                onChange={setAccountId}
              />
            </div>
          )}

          {canCreateRule && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="ql-rule"
                  checked={makeRule}
                  onCheckedChange={(c) => setMakeRule(!!c)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="ql-rule"
                  className="cursor-pointer leading-snug"
                >
                  Sugerir este lançamento para as próximas linhas parecidas
                </Label>
              </div>
              {makeRule && (
                <div className="space-y-1.5 pl-6">
                  <Label htmlFor="ql-pattern" className="text-xs">
                    Quando o histórico contiver
                  </Label>
                  <Input
                    id="ql-pattern"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maiúsculas, acentos e números não contam. Só{" "}
                    {isPayable ? "débitos" : "créditos"}.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4">
          <Button
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => {
              const tx = bankTx;
              close();
              if (tx) onOpenFullForm(tx);
            }}
          >
            Formulário completo
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button disabled={!valid || saving} onClick={submit}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Lançar e conciliar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
