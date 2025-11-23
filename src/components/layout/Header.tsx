"use client";

import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Header() {
    return (
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
            <div className="flex w-96 items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar transações..."
                    className="bg-transparent border-none shadow-none focus-visible:ring-0"
                />
            </div>

            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5 text-muted-foreground" />
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />
                </Button>

                <div className="flex items-center gap-3 border-l pl-4">
                    <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium">Filipe Honório</p>
                        <p className="text-xs text-muted-foreground">Admin</p>
                    </div>
                    <Avatar>
                        <AvatarImage src="https://github.com/shadcn.png" />
                        <AvatarFallback>FH</AvatarFallback>
                    </Avatar>
                </div>
            </div>
        </header>
    );
}
