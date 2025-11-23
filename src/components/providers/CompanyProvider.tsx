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
    selectCompany: () => { },
});

export const useCompany = () => useContext(CompanyContext);

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

            try {
                const allCompanies = await companyService.getAll();

                // If no companies exist, create a default one (Migration Logic)
                if (allCompanies.length === 0) {
                    const defaultCompany = await companyService.create({
                        name: "Minha Empresa",
                    });

                    // Assign current user as admin of this new company
                    if (user) {
                        const { userService } = await import("@/lib/services/userService");
                        await userService.updateRole(user.uid, 'admin', defaultCompany.id);
                    }

                    setCompanies([defaultCompany]);
                    setSelectedCompany(defaultCompany);
                    Cookies.set("selected_company_id", defaultCompany.id);
                } else {
                    setCompanies(allCompanies);

                    // Restore selection from cookie or default to first
                    const savedId = Cookies.get("selected_company_id");
                    const found = allCompanies.find(c => c.id === savedId) || allCompanies[0];
                    setSelectedCompany(found);

                    if (!savedId && found) {
                        Cookies.set("selected_company_id", found.id);
                    }
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
        const company = companies.find(c => c.id === companyId);
        if (company) {
            setSelectedCompany(company);
            Cookies.set("selected_company_id", company.id);
            // Reload page to refresh all data with new context
            window.location.reload();
        }
    };

    return (
        <CompanyContext.Provider value={{ companies, selectedCompany, isLoading, selectCompany }}>
            {children}
        </CompanyContext.Provider>
    );
}
