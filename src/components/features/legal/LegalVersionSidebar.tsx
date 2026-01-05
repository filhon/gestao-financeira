"use client";

import React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History } from "lucide-react";
import { LegalDocumentVersion } from "@/lib/services/legalService";

interface LegalVersionSidebarProps {
  versions: LegalDocumentVersion[];
  currentVersionId: string | null;
  onSelectVersion: (version: LegalDocumentVersion) => void;
  className?: string;
}

export function LegalVersionSidebar({
  versions,
  currentVersionId,
  onSelectVersion,
  className,
}: LegalVersionSidebarProps) {
  return (
    <div
      className={cn(
        "flex flex-col w-full md:w-64 border bg-card rounded-xl px-4 py-6",
        className
      )}
    >
      <div className="mb-6 flex items-center gap-2 px-2">
        <History className="h-4 w-4" />
        <span className="text-lg font-bold">Versões</span>
      </div>

      <ScrollArea className="h-[300px] md:h-[calc(100vh-300px)]">
        <nav className="space-y-1 pr-3">
          {versions.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma versão anterior encontrada.
            </div>
          ) : (
            versions.map((version, index) => {
              const isCurrent = currentVersionId === version.id;
              const isLatest = index === 0;

              return (
                <button
                  key={version.id}
                  onClick={() => onSelectVersion(version)}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <span>
                      {format(version.createdAt, "dd MMM, yyyy", {
                        locale: ptBR,
                      })}
                    </span>
                    {isLatest && (
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                          isCurrent
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        Atual
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs",
                      isCurrent
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground"
                    )}
                  >
                    {format(version.createdAt, "HH:mm", { locale: ptBR })}
                  </span>
                </button>
              );
            })
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
