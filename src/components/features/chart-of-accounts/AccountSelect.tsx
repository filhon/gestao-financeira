"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AccountNature, ChartAccount } from "@/lib/types";
import { natureFitsSide, withLevels } from "@/lib/chartOfAccounts";

interface AccountSelectProps {
  accounts: ChartAccount[];
  /** Despesa vê contas de despesa; receita, de receita; os dois, as patrimoniais. */
  nature: AccountNature;
  value?: string;
  onChange: (accountId: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Mostra "Sem conta" para limpar a escolha. */
  allowClear?: boolean;
  className?: string;
}

/**
 * Seletor de conta analítica. As sintéticas aparecem para dar o contexto da
 * árvore, mas não são selecionáveis — sintética não recebe lançamento.
 * Arquivada só aparece quando já é a conta do lançamento.
 */
export function AccountSelect({
  accounts,
  nature,
  value,
  onChange,
  placeholder = "Selecione a conta...",
  disabled,
  allowClear,
  className,
}: AccountSelectProps) {
  const [open, setOpen] = useState(false);

  const options = useMemo(
    () =>
      withLevels(
        accounts.filter(
          (a) =>
            natureFitsSide(a.nature, nature) && (!a.archived || a.id === value),
        ),
      ),
    [accounts, nature, value],
  );
  const selected = accounts.find((a) => a.id === value);
  const minLevel = Math.min(...options.map((o) => o.level));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? (
              <>
                <span className="font-mono text-xs text-muted-foreground mr-1.5">
                  {selected.code}
                </span>
                {selected.name}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-[320px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar por código ou nome..." />
          <CommandList
            onWheel={(e) => {
              e.stopPropagation();
              e.currentTarget.scrollTop += e.deltaY;
            }}
          >
            <CommandEmpty>Nenhuma conta encontrada.</CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem
                  value="__sem_conta__"
                  onSelect={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  Sem conta
                </CommandItem>
              )}
              {options.map((a) => {
                const isSynthetic = a.type === "synthetic";
                return (
                  <CommandItem
                    key={a.id}
                    value={`${a.code} ${a.name}`}
                    title={a.description}
                    disabled={isSynthetic}
                    onSelect={() => {
                      if (isSynthetic) return;
                      onChange(a.id);
                      setOpen(false);
                    }}
                    className={cn(
                      isSynthetic &&
                        "font-medium text-foreground/70 data-[disabled=true]:opacity-100",
                    )}
                  >
                    <div
                      className="flex items-center gap-1.5 w-full min-w-0"
                      style={{ paddingLeft: `${(a.level - minLevel) * 14}px` }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          a.id === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {a.code}
                      </span>
                      <span className="truncate">{a.name}</span>
                      {a.archived && (
                        <span className="ml-auto text-xs text-muted-foreground shrink-0">
                          arquivada
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
