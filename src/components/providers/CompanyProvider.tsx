"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Company } from "@/lib/types";
import { companyService } from "@/lib/services/companyService";
import Cookies from "js-cookie";
import { useAuth } from "@/components/providers/AuthProvider";

interface CompanyContextType {
  companies: Company[];
  selectedCompany: Company | null;
  isLoading: boolean;
  selectCompany: (companyId: string) => void;
}

const CompanyContext = createContext<CompanyContextType>({
  companies: [],
  selectedCompany: null,
  isLoading: true,
  selectCompany: () => {},
});

export const useCompany = () => useContext(CompanyContext);

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadCompanies = async () => {
      if (!user) {
        setCompanies([]);
        setSelectedCompany(null);
        setIsLoading(false);
        return;
      }

      // Skip loading for users who haven't been approved yet
      if (
        user.status === "pending_company_setup" ||
        user.status === "pending_approval" ||
        (user.status as string) === "pending"
      ) {
        setCompanies([]);
        setSelectedCompany(null);
        setIsLoading(false);
        return;
      }

      const allowedIds = Object.keys(user.companyRoles ?? {});
      const fetchCompanies = (fromCache: boolean) =>
        user.role === "admin"
          ? companyService.getAll(fromCache)
          : companyService.getByIds(allowedIds, fromCache);

      // Restore selection from cookie or default to first. Mantém a mesma
      // referência quando nada mudou: telas com `selectedCompany` em deps de
      // efeito não buscam tudo de novo quando o servidor confirma o cache.
      const applyCompanies = (list: Company[]) => {
        setCompanies((prev) => (sameJson(prev, list) ? prev : list));
        const savedId = Cookies.get("selected_company_id");
        const found = list.find((c) => c.id === savedId) || list[0];
        setSelectedCompany((prev) => (sameJson(prev, found) ? prev : found));
        if (!savedId && found) {
          Cookies.set("selected_company_id", found.id);
        }
      };

      // Cache local primeiro: com as empresas já em disco a tela abre sem
      // esperar a rede. Vazio não conta — a criação da empresa padrão abaixo
      // só pode decidir com a resposta do servidor.
      const cached = await fetchCompanies(true).catch(() => []);
      if (cached.length > 0) {
        applyCompanies(cached);
        setIsLoading(false);
      }

      try {
        const allCompanies: Company[] = await fetchCompanies(false);

        // If no companies exist, create a default one (Migration Logic)
        if (allCompanies.length === 0) {
          const defaultCompany = await companyService.create(
            {
              name: "Minha Empresa",
            },
            { uid: user.uid, email: user.email },
          );

          // Assign current user as admin of this new company
          if (user) {
            const { userService } = await import("@/lib/services/userService");
            await userService.updateRole(
              user.uid,
              "admin",
              { uid: user.uid, email: user.email },
              defaultCompany.id,
            );
          }

          setCompanies([defaultCompany]);
          setSelectedCompany(defaultCompany);
          Cookies.set("selected_company_id", defaultCompany.id);
        } else {
          applyCompanies(allCompanies);
        }
      } catch (error) {
        console.error("Failed to load companies:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadCompanies();
  }, [user]);

  const selectCompany = (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    if (company) {
      setSelectedCompany(company);
      Cookies.set("selected_company_id", company.id);
      // Reload page to refresh all data with new context
      window.location.reload();
    }
  };

  return (
    <CompanyContext.Provider
      value={{ companies, selectedCompany, isLoading, selectCompany }}
    >
      {children}
    </CompanyContext.Provider>
  );
}
