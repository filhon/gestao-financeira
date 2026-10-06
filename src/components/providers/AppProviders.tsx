"use client";

import { QueryProvider } from "@/components/providers/QueryProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { CompanyProvider } from "@/components/providers/CompanyProvider";

/**
 * Providers que dependem do Firebase. Ficam só nas rotas que precisam de
 * sessão — (auth) e (dashboard) — para que landing, termos e magic links não
 * baixem o SDK de Auth/Firestore no carregamento inicial.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <CompanyProvider>{children}</CompanyProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
