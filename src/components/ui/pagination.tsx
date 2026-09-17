"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface PaginationProps {
  /** Página atual (1-based). */
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Se informado, exibe o seletor de itens por página. */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

/** Primeira, última, atual ±1; "…" nos saltos. */
function pageRange(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = [
    ...new Set(
      [1, page - 1, page, page + 1, totalPages].filter(
        (p) => p >= 1 && p <= totalPages,
      ),
    ),
  ].sort((a, b) => a - b);
  return pages.flatMap((p, i) =>
    i > 0 && p - pages[i - 1] > 1 ? ["…" as const, p] : [p],
  );
}

export function Pagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  className,
}: PaginationProps) {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Paginação"
      className={cn(
        "flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {start}–{end} de {totalItems}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger size="sm" className="h-7 px-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            por página
          </label>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="sm:hidden px-2 text-sm tabular-nums">
            {page} / {totalPages}
          </span>

          <div className="hidden sm:flex items-center gap-1">
            {pageRange(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span
                  key={`gap-${i}`}
                  className="w-8 text-center text-sm text-muted-foreground select-none"
                  aria-hidden
                >
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8 tabular-nums"
                  aria-current={p === page ? "page" : undefined}
                  aria-label={`Página ${p}`}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </Button>
              ),
            )}
          </div>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Próxima página"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </nav>
  );
}
