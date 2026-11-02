"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccuracyRow } from "@/lib/matching/queue";
import { cn } from "@/lib/utils";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Acerto das sugestões por faixa de pontuação, a partir do que as pessoas
 * fizeram com elas. Faixa forte acertando pouco = peso a recalibrar.
 */
export function MatchAccuracy({
  rows,
  labels,
}: {
  rows: AccuracyRow[];
  /** Nome de cada faixa, na mesma ordem (ex.: "Forte"). */
  labels: string[];
}) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Ainda não há sugestões confirmadas ou recusadas para medir.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Faixa</TableHead>
          <TableHead className="text-right">Sugestões</TableHead>
          <TableHead className="text-right">Acerto</TableHead>
          <TableHead className="text-right">Trocadas</TableHead>
          <TableHead className="text-right">Recusadas</TableHead>
          <TableHead className="text-right">Desfeitas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.min}>
            <TableCell>
              {labels[i]}{" "}
              <span className="text-xs text-muted-foreground tabular-nums">
                {r.min}–{r.max}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.total}</TableCell>
            <TableCell
              className={cn(
                "text-right font-medium tabular-nums",
                r.total > 0 && r.rate < 0.8 && "text-destructive",
              )}
            >
              {r.total ? pct(r.rate) : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.changed}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.rejected}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.undone}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
