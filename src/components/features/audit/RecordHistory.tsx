"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, History, Loader2 } from "lucide-react";
import { auditService } from "@/lib/services/auditService";
import { useAuditNames } from "@/hooks/useAuditNames";
import {
  ACTION_NOUNS,
  ACTOR_KIND_LABELS,
  actorKind,
  detailRows,
  getActionSummary,
} from "@/lib/auditFormatter";
import { AuditDetailTable } from "./AuditDetailTable";
import { cn } from "@/lib/utils";

/**
 * Histórico de auditoria de um registro, dentro do próprio registro. Só busca
 * quando aberto: a maioria das consultas a uma transação não precisa dele.
 */
export function RecordHistory({
  companyId,
  recordId,
}: {
  companyId: string;
  recordId: string;
}) {
  const [open, setOpen] = useState(false);
  const { names } = useAuditNames(open ? companyId : undefined);
  const {
    data: logs,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["audit-record", companyId, recordId],
    queryFn: () => auditService.getForRecord(companyId, recordId),
    enabled: open,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <History className="h-4 w-4" />
        Histórico de alterações
        {logs && (
          <span className="tabular-nums text-xs font-normal">
            ({logs.length})
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-3">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isError ? (
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar o histórico.
            </p>
          ) : !logs?.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum registro de auditoria para esta conta.
            </p>
          ) : (
            <ol className="space-y-4">
              {logs.map((log) => {
                const kind = actorKind(log);
                const rows = detailRows(log.details, names);
                const summary = getActionSummary(
                  log.action,
                  log.details,
                  names,
                );
                return (
                  <li key={log.id} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {format(log.createdAt, "dd/MM/yy HH:mm")}
                      </span>
                      <span className="font-medium text-foreground">
                        {kind === "user"
                          ? (names.get(log.userId) ??
                            log.userName ??
                            log.userEmail)
                          : ACTOR_KIND_LABELS[kind]}
                      </span>
                      <span>{ACTION_NOUNS[log.action] ?? log.action}</span>
                      {log.entityId !== recordId && log.subject && (
                        <span>via {log.subject}</span>
                      )}
                    </div>
                    {rows.some((r) => r.before !== undefined) ? (
                      <div className="mt-1">
                        <AuditDetailTable rows={rows} />
                      </div>
                    ) : (
                      summary && <p className="mt-0.5">{summary}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
