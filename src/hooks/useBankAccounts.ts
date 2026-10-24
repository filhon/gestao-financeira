"use client";

import { useQuery } from "@tanstack/react-query";
import { BankAccount } from "@/lib/types";
import { bankAccountService } from "@/lib/services/bankAccountService";

/** Após qualquer escrita, invalide `["bank-accounts"]`. */
export function useBankAccounts(companyId: string | undefined) {
  const query = useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: () => bankAccountService.getAll(companyId!),
    enabled: !!companyId,
  });
  return { ...query, accounts: query.data ?? EMPTY };
}

// Referência estável: um `[]` novo a cada render dispararia efeitos dependentes.
const EMPTY: BankAccount[] = [];
