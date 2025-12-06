"use client";

import { useRouter } from "next/navigation";

import { Search, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/components/providers/AuthProvider";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ModeToggle } from "@/components/mode-toggle";

export function Header() {
    const { user, logout } = useAuth();
    const router = useRouter();

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .substring(0, 2);
    };

    return (
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
            <div
                className="flex w-96 items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
                onClick={() => {
                    // Dispatch Ctrl+K event to open global search
                    const event = new KeyboardEvent('keydown', {
                        key: 'k',
                        ctrlKey: true,
                        bubbles: true,
                    });
                    document.dispatchEvent(event);
                }}
            >
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm text-muted-foreground">Buscar transações...</span>
                <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
                    <span className="text-xs">⌘</span>K
                </kbd>
            </div>

            <div className="flex items-center gap-4">
                <ModeToggle />
                <NotificationBell />

                <div className="flex items-center gap-3 border-l pl-4">
                    <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium">{user?.displayName || "Usuário"}</p>
                        <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace('_', ' ') || "Visitante"}</p>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                                <Avatar>
                                    <AvatarImage src={user?.photoURL || ""} />
                                    <AvatarFallback>{user?.displayName ? getInitials(user.displayName) : "U"}</AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-56" align="end" forceMount>
                            <DropdownMenuLabel className="font-normal">
                                <div className="flex flex-col space-y-1">
                                    <p className="text-sm font-medium leading-none">{user?.displayName}</p>
                                    <p className="text-xs leading-none text-muted-foreground">
                                        {user?.email}
                                    </p>
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => router.push(`/perfil/${user?.uid}`)} className="cursor-pointer">
                                <User className="mr-2 h-4 w-4" />
                                <span>Meu Perfil</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={logout} className="text-red-600 cursor-pointer">
                                <LogOut className="mr-2 h-4 w-4" />
                                <span>Sair</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </header>
    );
}
