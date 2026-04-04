"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Search, LogOut, User, MessageSquare } from "lucide-react";
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
import { cn } from "@/lib/utils";

export function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isMac] = useState(
    () =>
      typeof navigator !== "undefined" &&
      navigator.platform.toUpperCase().indexOf("MAC") >= 0
  );

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  const translateRole = (role: string | undefined): string => {
    const roleTranslations: Record<string, string> = {
      admin: "Administrador",
      financial_manager: "Gestor Financeiro",
      approver: "Aprovador",
      releaser: "Liberador",
      auditor: "Auditor",
      user: "Usuário",
    };
    return role ? roleTranslations[role] || role : "Visitante";
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-5 gap-4">
      {/* Search */}
      <div
        className="flex w-72 items-center gap-2 px-2.5 py-1.5 rounded-md border bg-muted/40 cursor-pointer hover:bg-muted/70 hover:border-border/80 transition-colors group"
        onClick={() => {
          const event = new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
          });
          document.dispatchEvent(event);
        }}
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-sm text-muted-foreground/70">
          Buscar transações...
        </span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border/60 bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground/60 sm:flex">
          {isMac ? "⌘K" : "Ctrl+K"}
        </kbd>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <ModeToggle />
        <NotificationBell />

        <div className="flex items-center gap-2.5 border-l ml-1 pl-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-tight">
              {user?.displayName || "Usuário"}
            </p>
            <p className="text-xs text-muted-foreground leading-tight">
              {translateRole(user?.role)}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                )}
              >
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.photoURL || undefined} />
                  <AvatarFallback className="text-xs">
                    {user?.displayName ? getInitials(user.displayName) : "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-0.5">
                  <p className="text-sm font-medium leading-none">
                    {user?.displayName}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => router.push(`/perfil/${user?.uid}`)}
                className="cursor-pointer"
              >
                <User className="mr-2 h-3.5 w-3.5" />
                <span>Meu Perfil</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push("/feedback")}
                className="cursor-pointer"
              >
                <MessageSquare className="mr-2 h-3.5 w-3.5" />
                <span>Feedback</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logout}
                className="text-destructive cursor-pointer focus:text-destructive"
              >
                <LogOut className="mr-2 h-3.5 w-3.5" />
                <span>Sair</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
