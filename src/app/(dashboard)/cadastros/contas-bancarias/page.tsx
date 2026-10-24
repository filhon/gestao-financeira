"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Landmark, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { BankAccountForm } from "@/components/features/bank-accounts/BankAccountForm";
import {
  bankAccountService,
  BankAccountDraft,
} from "@/lib/services/bankAccountService";
import { lastClosing } from "@/lib/bankReconciliation";
import { BankAccount } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

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
      setEditing(null);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar a conta.",
      );
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
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Contas Bancárias
          </h1>
          {!isEmpty && !isLoading && (
            <p className="text-sm text-muted-foreground mt-1.5">
              Cada conta é conciliada separadamente em{" "}
              <Link
                href="/financeiro/conciliacao"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Financeiro › Conciliação Bancária
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
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_200px_180px_160px_48px] gap-4 px-4 py-2.5 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Conta</span>
            <span>Agência / conta</span>
            <span className="text-right">Saldo de abertura</span>
            <span>Conciliada até</span>
            <span />
          </div>
          <ul className="divide-y">
            {accounts.map((a) => {
              const closing = lastClosing(a);
              return (
                <li
                  key={a.id}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_200px_180px_160px_48px] gap-x-4 gap-y-0.5 items-center px-4 py-3 text-sm",
                    !a.active && "text-muted-foreground",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {a.name}
                      {!a.active && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          Inativa
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[a.bankCode, a.bankName].filter(Boolean).join(" · ") ||
                        "Banco não informado"}
                    </p>
                  </div>
                  <span className="hidden md:block tabular-nums">
                    {[a.agency, a.accountNumber].filter(Boolean).join(" / ")}
                  </span>
                  <span className="hidden md:block text-right font-financial tabular-nums">
                    {formatCurrency(a.openingBalance)}
                    <span className="block text-xs text-muted-foreground">
                      em {format(a.openingBalanceDate, "dd/MM/yyyy")}
                    </span>
                  </span>
                  <span className="hidden md:block">
                    {closing ? (
                      format(closing.through, "dd/MM/yyyy")
                    ) : (
                      <span className="text-muted-foreground">
                        Nunca fechada
                      </span>
                    )}
                  </span>
                  <div className="row-span-2 md:row-span-1 col-start-2 md:col-auto row-start-1 md:row-start-auto flex justify-end">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Editar ${a.name}`}
                        onClick={() => setEditing(a)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <span className="md:hidden text-xs text-muted-foreground">
                    {[a.agency, a.accountNumber].filter(Boolean).join(" / ")}
                    {closing &&
                      ` · conciliada até ${format(closing.through, "dd/MM/yyyy")}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ResponsiveModal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <ResponsiveModalContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              {editing === "new" ? "Nova conta bancária" : "Editar conta"}
            </ResponsiveModalTitle>
          </ResponsiveModalHeader>
          {editing && (
            <BankAccountForm
              key={editing === "new" ? "new" : editing.id}
              editing={editing === "new" ? null : editing}
              isLoading={isSaving}
              onSubmit={handleSubmit}
              onCancel={() => setEditing(null)}
            />
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
