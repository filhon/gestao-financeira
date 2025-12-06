"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";

export function GlobalSearch() {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const router = useRouter();

    // Handle Ctrl+K / Cmd+K keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    const handleSearch = useCallback(() => {
        if (searchQuery.trim()) {
            router.push(`/busca?q=${encodeURIComponent(searchQuery.trim())}`);
            setOpen(false);
            setSearchQuery("");
        }
    }, [searchQuery, router]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSearch();
        }
    };

    return (
        <CommandDialog
            open={open}
            onOpenChange={setOpen}
            title="Busca Global"
            description="Buscar transações em todo o sistema"
        >
            <CommandInput
                placeholder="Buscar transações..."
                value={searchQuery}
                onValueChange={setSearchQuery}
                onKeyDown={handleKeyDown}
            />
            <CommandList>
                <CommandEmpty>
                    {searchQuery.trim() ? (
                        <div className="py-6 text-center">
                            <p className="text-sm text-muted-foreground mb-2">
                                Pressione <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">Enter</kbd> para buscar
                            </p>
                            <p className="text-xs text-muted-foreground">
                                &quot;{searchQuery}&quot;
                            </p>
                        </div>
                    ) : (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                            Digite para buscar transações...
                        </div>
                    )}
                </CommandEmpty>
                {searchQuery.trim() && (
                    <CommandGroup heading="Ações">
                        <CommandItem onSelect={handleSearch}>
                            <Search className="mr-2 h-4 w-4" />
                            <span>Buscar por &quot;{searchQuery}&quot;</span>
                        </CommandItem>
                    </CommandGroup>
                )}
            </CommandList>
        </CommandDialog>
    );
}
