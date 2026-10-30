"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRight, Landmark, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import {
  BankAccountForm,
  investmentLabel,
} from "@/components/features/bank-accounts/BankAccountForm";
import {
  bankAccountService,
  BankAccountDraft,
} from "@/lib/services/bankAccountService";
import {
  balanceBase,
  isInvestment,
  lastClosing,
  reconciliationAccountKey,
} from "@/lib/bankReconciliation";
import { friendlyError } from "@/lib/errors";
import { BankAccount } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

const COLS =
  "grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_48px] gap-x-4";

export default function BankAccountsPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canViewBankAccounts, canManageBankAccounts: canManage } =
    usePermissions();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id;
  const { accounts, isLoading } = useBankAccounts(companyId);

  const [editing, setEditing] = useState<BankAccount | "new" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const close = () => {
    setIsDirty(false);
    setEditing(null);
  };
  const requestClose = () => (isDirty ? setConfirmDiscard(true) : close());

  // A conciliação abre na conta escolhida na lista.
  const rememberAccount = (accountId: string) => {
    try {
      if (companyId)
        localStorage.setItem(reconciliationAccountKey(companyId), accountId);
    } catch {
      // Sem storage: a conciliação abre na conta mais atrasada.
    }
  };

  const handleSubmit = async (draft: BankAccountDraft) => {
    if (!companyId || !user || !editing) return;
    const actor = { uid: user.uid, email: user.email };
    try {
      setIsSaving(true);
      if (editing === "new") {
        await bankAccountService.create(draft, companyId, actor);
        toast.success("Conta cadastrada.");
      } else {
        await bankAccountService.update(editing, draft, actor);
        toast.success("Conta atualizada.");
      }
      await queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      close();
    } catch (error) {
      console.error(error);
      toast.error(friendlyError(error, "Erro ao salvar a conta."));
    } finally {
      setIsSaving(false);
    }
  };

  if (!canViewBankAccounts) {
    return (
      <p className="text-sm text-muted-foreground">
        Você não tem permissão para ver as contas bancárias.
      </p>
    );
  }

  const isEmpty = !isLoading && accounts.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Contas Bancárias
          </h1>
          {!isEmpty && !isLoading && (
            <p className="text-sm text-muted-foreground mt-1.5">
              Cada conta é conciliada separadamente em{" "}
              <Link
                href="/financeiro/conciliacao"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Rotinas › Conciliação Bancária
              </Link>
              .
            </p>
          )}
        </div>
        {canManage && !isEmpty && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Nova conta
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-lg border divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-24 ml-auto" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="rounded-lg border px-6 py-12 text-center">
          <Landmark className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">Nenhuma conta cadastrada</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A conciliação compara o extrato de uma conta com o que o sistema
            registra. Cadastre a conta com o saldo de abertura para começar.
          </p>
          {canManage ? (
            <Button className="mt-5" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              Cadastrar conta
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Peça ao gestor financeiro para cadastrar as contas.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div
            className={cn(
              COLS,
              "hidden md:grid px-4 py-2.5 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground",
            )}
          >
            <span>Conta</span>
            <span>Dados</span>
            <span className="text-right">Saldo conciliado</span>
            <span>Conciliada até</span>
            <span />
          </div>
          <ul className="divide-y">
            {accounts.map((a) => {
              const closing = lastClosing(a);
              const base = balanceBase(a);
              const details = isInvestment(a)
                ? investmentLabel(a)
                : [a.agency, a.accountNumber].filter(Boolean).join(" / ");
              const linked = isInvestment(a)
                ? accounts.find((c) => c.id === a.linkedAccountId)
                : undefined;
              const reconciled = closing
                ? format(closing.through, "dd/MM/yyyy")
                : "Nunca fechada";
              return (
                <li
                  key={a.id}
                  onClick={canManage ? () => setEditing(a) : undefined}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 items-center px-4 py-3 text-sm",
                    "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_48px]",
                    canManage && "cursor-pointer hover:bg-muted/40",
                    !a.active && "text-muted-foreground",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {a.name}
                      {!a.active && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Inativa
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[a.bankCode, a.bankName].filter(Boolean).join(" · ") ||
                        "Banco não informado"}
                    </p>
                  </div>
                  <div className="hidden md:block min-w-0">
                    <p className="tabular-nums truncate">{details}</p>
                    {isInvestment(a) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {linked
                          ? `Vinculada a ${linked.name}`
                          : "Sem conta corrente vinculada"}
                      </p>
                    )}
                  </div>
                  <span className="hidden md:block text-right font-financial tabular-nums">
                    {formatCurrency(base.balance)}
                    <span className="block text-xs text-muted-foreground">
                      {closing ? "fechado" : "abertura"} em{" "}
                      {format(base.date, "dd/MM/yyyy")}
                    </span>
                  </span>
                  <span className="hidden md:block">
                    {a.active ? (
                      <Link
                        href="/financeiro/conciliacao"
                        onClick={(e) => {
                          e.stopPropagation();
                          rememberAccount(a.id);
                        }}
                        title="Abrir a conciliação desta conta"
                        className={cn(
                          "inline-flex items-center gap-1 underline-offset-2 hover:underline",
                          !closing && "font-medium",
                        )}
                      >
                        {reconciled}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      reconciled
                    )}
                  </span>
                  <div className="row-span-2 md:row-span-1 col-start-2 md:col-auto row-start-1 md:row-start-auto flex justify-end">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Editar ${a.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(a);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <span className="md:hidden text-xs text-muted-foreground">
                    {[details, linked && `vinculada a ${linked.name}`]
                      .filter(Boolean)
                      .join(" · ")}
                    {` · ${formatCurrency(base.balance)} em ${format(base.date, "dd/MM/yyyy")}`}
                    {closing && ` · conciliada até ${reconciled}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Sheet open={!!editing} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-6 py-4">
            <SheetTitle className="text-lg">
              {editing === "new"
                ? "Nova conta ou aplicação"
                : `Editar ${editing?.name ?? ""}`}
            </SheetTitle>
            <SheetDescription>em {selectedCompany?.name}</SheetDescription>
          </SheetHeader>
          {editing && companyId && (
            <BankAccountForm
              key={editing === "new" ? "new" : editing.id}
              companyId={companyId}
              accounts={accounts}
              editing={editing === "new" ? null : editing}
              isLoading={isSaving}
              onSubmit={handleSubmit}
              onCancel={requestClose}
              onDirtyChange={setIsDirty}
            />
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar alterações?"
        description="O que foi preenchido será perdido."
        confirmText="Descartar"
        cancelText="Continuar editando"
        variant="destructive"
        onConfirm={close}
      />
    </div>
  );
}
