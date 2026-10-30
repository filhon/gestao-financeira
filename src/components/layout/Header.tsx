"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import {
  Search,
  LogOut,
  User,
  MessageSquare,
  TrendingUp,
  Building2,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  financial_manager: "Gestor Financeiro",
  approver: "Aprovador",
  releaser: "Liberador",
  auditor: "Auditor",
  user: "Usuário",
};

const THEMES = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Padrão do dispositivo", icon: Monitor },
] as const;

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);

export function Header() {
  const { user, logout } = useAuth();
  const { selectedCompany } = useCompany();
  const { currentRole } = usePermissions();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [isMac] = useState(
    () =>
      typeof navigator !== "undefined" &&
      navigator.platform.toUpperCase().indexOf("MAC") >= 0,
  );

  const roleLabel = currentRole ? ROLE_LABELS[currentRole] : "Visitante";
  const displayName = user?.displayName || "Usuário";

  const openSearch = () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:px-5 gap-3">
      {/* Mobile: Compact logo | Desktop: Search bar */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary shrink-0">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-sm font-semibold tracking-tight">
          Fin Control
        </span>
      </div>

      <button
        type="button"
        className="hidden md:flex w-72 items-center gap-2 px-2.5 py-1.5 rounded-md border bg-muted/40 cursor-pointer hover:bg-muted/70 hover:border-border/80 transition-colors group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={openSearch}
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-left text-sm text-muted-foreground/70">
          Buscar ou ir para…
        </span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border/60 bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground/60 sm:flex">
          {isMac ? "⌘K" : "Ctrl+K"}
        </kbd>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        {/* Mobile: Search icon button */}
        <button
          onClick={openSearch}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Buscar"
        >
          <Search className="h-4.5 w-4.5" />
        </button>

        <NotificationBell />

        <div className="ml-1 border-l pl-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Menu do usuário"
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <div className="hidden sm:block text-right min-w-0">
                  <p className="max-w-48 truncate text-sm font-medium leading-tight">
                    {displayName}
                  </p>
                  <p className="max-w-48 truncate text-xs text-muted-foreground leading-tight">
                    {roleLabel}
                    {selectedCompany && ` · ${selectedCompany.name}`}
                  </p>
                </div>
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={user?.photoURL || undefined} />
                  <AvatarFallback className="text-xs">
                    {user?.displayName ? getInitials(user.displayName) : "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.email}
                </p>
                {selectedCompany && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {roleLabel} em {selectedCompany.name}
                    </span>
                  </p>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => router.push(`/perfil/${user?.uid}`)}
                className="cursor-pointer"
              >
                <User className="mr-2 h-3.5 w-3.5" />
                <span>Meu Perfil</span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <Sun className="mr-2 h-3.5 w-3.5" />
                  <span>Aparência</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={theme ?? "system"}
                    onValueChange={setTheme}
                  >
                    {THEMES.map(({ value, label, icon: Icon }) => (
                      <DropdownMenuRadioItem
                        key={value}
                        value={value}
                        className="cursor-pointer"
                      >
                        <Icon className="mr-2 h-3.5 w-3.5" />
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                onClick={() => router.push("/feedback")}
                className="cursor-pointer"
              >
                <MessageSquare className="mr-2 h-3.5 w-3.5" />
                <span>Enviar feedback</span>
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
