"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, TriangleAlert } from "lucide-react";
import type { DetailRow } from "@/lib/auditFormatter";
import { cn } from "@/lib/utils";

const CLAMP_AT = 140;

/** Texto longo (observações, anexos) não estoura a tabela: abre sob demanda. */
function ClampText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_AT;
  return (
    <span className={cn("wrap-break-word", className)}>
      <span className={cn(long && !open && "line-clamp-2")}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {open ? "mostrar menos" : "mostrar tudo"}
        </button>
      )}
    </span>
  );
}

/** Campo | Antes | Depois. Sem diff (logs legados, criação), só Campo | Valor. */
export function AuditDetailTable({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) return null;
  const hasBefore = rows.some((r) => r.before !== undefined);

  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="w-[28%] py-1 pr-3 font-medium">Campo</th>
          {hasBefore && <th className="py-1 pr-3 font-medium">Antes</th>}
          <th className="py-1 font-medium">{hasBefore ? "Depois" : "Valor"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} className="border-t border-border/60 align-top">
            <td className="py-1.5 pr-3">
              <span className="inline-flex items-start gap-1">
                {r.sensitive && (
                  <TriangleAlert
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-label="Campo sensível"
                  />
                )}
                <span className="wrap-break-word">{r.label}</span>
              </span>
            </td>
            {hasBefore && (
              <td className="py-1.5 pr-3 text-muted-foreground">
                {r.before !== undefined && <ClampText text={r.before} />}
              </td>
            )}
            <td className="py-1.5">
              <span className="inline-flex items-start gap-1">
                {r.direction === "up" && (
                  <ArrowUpRight
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                    aria-label="aumentou"
                  />
                )}
                {r.direction === "down" && (
                  <ArrowDownRight
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600"
                    aria-label="diminuiu"
                  />
                )}
                <ClampText text={r.after} className="font-medium" />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
