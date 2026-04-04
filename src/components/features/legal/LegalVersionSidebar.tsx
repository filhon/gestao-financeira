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
        "flex flex-col w-full md:w-64 border bg-card rounded-xl px-4 py-5 shrink-0",
        className
      )}
    >
      <div className="mb-4 flex items-center gap-2 px-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-sm font-semibold">Histórico de versões</span>
      </div>

      <ScrollArea className="h-[260px] md:h-[calc(100vh-300px)]">
        <nav className="pr-2">
          {versions.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma versão encontrada.
            </div>
          ) : (
            <ol className="relative ml-1">
              {/* Timeline line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

              {versions.map((version, index) => {
                const isCurrent = currentVersionId === version.id;
                const isLatest = index === 0;

                return (
                  <li key={version.id} className="relative pl-5 pb-1">
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute left-0 top-2.5 h-3.5 w-3.5 rounded-full border-2 transition-colors",
                        isCurrent
                          ? "border-primary bg-primary"
                          : "border-border bg-card hover:border-primary/50"
                      )}
                    />

                    <button
                      onClick={() => onSelectVersion(version)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        isCurrent
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <span
                          className={cn(
                            "font-medium text-xs",
                            isCurrent && "text-primary"
                          )}
                        >
                          {format(version.createdAt, "dd MMM yyyy", {
                            locale: ptBR,
                          })}
                        </span>
                        {isLatest && (
                          <span
                            className={cn(
                              "shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                              isCurrent
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            Atual
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {format(version.createdAt, "HH:mm", { locale: ptBR })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
