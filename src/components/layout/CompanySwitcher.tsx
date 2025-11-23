"use client";

import { ChevronsUpDown, Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function CompanySwitcher() {
    const { companies, selectedCompany, selectCompany } = useCompany();

    if (!selectedCompany) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between px-2 mb-4">
                    <div className="flex items-center gap-2 truncate">
                        <Avatar className="h-6 w-6">
                            <AvatarImage src={selectedCompany.logoUrl} />
                            <AvatarFallback><Building2 className="h-4 w-4" /></AvatarFallback>
                        </Avatar>
                        <span className="truncate">{selectedCompany.name}</span>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]">
                <DropdownMenuLabel>Empresas</DropdownMenuLabel>
                {companies.map((company) => (
                    <DropdownMenuItem
                        key={company.id}
                        onSelect={() => selectCompany(company.id)}
                        className="flex items-center gap-2"
                    >
                        <div className="h-2 w-2 rounded-full bg-primary" style={{ opacity: selectedCompany.id === company.id ? 1 : 0 }} />
                        {company.name}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 text-muted-foreground cursor-not-allowed">
                    <Plus className="h-4 w-4" />
                    Nova Empresa
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
