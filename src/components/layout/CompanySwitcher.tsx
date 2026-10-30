"use client";

import { ChevronsUpDown, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCompany } from "@/components/providers/CompanyProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";
import { cn } from "@/lib/utils";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** `compact`: só a sigla da empresa (sidebar recolhida), lista abre ao lado. */
export function CompanySwitcher({ compact = false }: { compact?: boolean }) {
  const { companies, selectedCompany, selectCompany } = useCompany();
  const [open, setOpen] = useState(false);

  if (!selectedCompany) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          title={compact ? selectedCompany.name : undefined}
          aria-label={`Empresa: ${selectedCompany.name}. Trocar empresa`}
          className={
            compact ? "h-9 w-9 p-0" : "w-full justify-between px-2 mb-4"
          }
        >
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className={compact ? "h-7 w-7" : "h-6 w-6 shrink-0"}>
              <AvatarImage src={selectedCompany.logoUrl} />
              <AvatarFallback className="text-[11px] font-semibold">
                {initials(selectedCompany.name)}
              </AvatarFallback>
            </Avatar>
            {!compact && (
              <span className="truncate">{selectedCompany.name}</span>
            )}
          </div>
          {!compact && (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={compact ? "right" : "bottom"}
        align="start"
        sideOffset={compact ? 8 : 4}
        className={cn(
          "p-1",
          compact ? "w-60" : "w-(--radix-popover-trigger-width)",
        )}
      >
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Empresas
        </p>
        {companies.map((company) => (
          <button
            key={company.id}
            onClick={() => {
              selectCompany(company.id);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
              selectedCompany.id === company.id && "font-medium",
            )}
          >
            <Check
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-primary",
                selectedCompany.id === company.id ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate flex-1 text-left">{company.name}</span>
          </button>
        ))}
        <div className="my-1 h-px bg-border" />
        <button
          disabled
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground cursor-not-allowed opacity-60"
        >
          <Plus className="h-4 w-4" />
          Nova Empresa
        </button>
      </PopoverContent>
    </Popover>
  );
}
