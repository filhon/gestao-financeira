"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { Check, Plus, X, CheckCircle2, Zap, MinusCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BankTransaction } from "@/lib/types";

interface ReconciliationTableProps {
  transactions: BankTransaction[];
  onAction: (
    id: string,
    action: "confirm" | "create" | "ignore",
    matchedId?: string,
  ) => void;
}

export function ReconciliationTable({
  transactions,
  onAction,
}: ReconciliationTableProps) {
  // const { transactions } = useReconciliationStore(); // Props passed from parent now

  const getMatchedEntityName = (
    matchedDetails: BankTransaction["matchedDetails"],
  ) => {
    if (!matchedDetails) return undefined;
    const withEntityName = matchedDetails as unknown as { entityName?: string };
    return withEntityName.entityName;
  };

  const getStatusBadge = (status: BankTransaction["status"]) => {
    switch (status) {
      case "matched":
        return (
          <Badge className="bg-green-500 hover:bg-green-600 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Corresp.
          </Badge>
        );
      case "potential_match":
        return (
          <Badge
            variant="secondary"
            className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 gap-1"
          >
            <Zap className="h-3 w-3" />
            Sugestão
          </Badge>
        );
      case "ignored":
        return (
          <Badge variant="outline" className="gap-1">
            <MinusCircle className="h-3 w-3" />
            Ignorado
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Circle className="h-3 w-3" />
            Novo
          </Badge>
        );
    }
  };

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Data</TableHead>
            <TableHead className="w-[40%]">Descrição (Banco)</TableHead>
            <TableHead className="w-[120px]">Valor</TableHead>
            <TableHead className="w-[100px]">Status</TableHead>
            <TableHead className="w-[30%]">Sugestão Sistema</TableHead>
            <TableHead className="text-right w-[120px]">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx) => (
            <TableRow
              key={tx.id}
              className={cn(
                "transition-all duration-500",
                tx.status === "matched"
                  ? "bg-green-50/50 dark:bg-green-900/10 opacity-70 border-l-4 border-l-green-500"
                  : "",
                tx.status === "ignored" ? "opacity-50 grayscale" : "",
              )}
            >
              <TableCell>{format(new Date(tx.date), "dd/MM/yyyy")}</TableCell>

              <TableCell>
                <div
                  className="truncate font-medium max-w-[400px]"
                  title={tx.description}
                >
                  {tx.description}
                </div>
              </TableCell>

              <TableCell
                className={cn(
                  "font-medium",
                  tx.amount < 0 ? "text-red-600" : "text-green-600",
                )}
              >
                <span className="text-xs mr-1 opacity-70">
                  {tx.amount < 0 ? "▼" : "▲"}
                </span>
                {formatCurrency(Math.abs(tx.amount))}
              </TableCell>
              <TableCell>{getStatusBadge(tx.status)}</TableCell>
              <TableCell>
                {tx.matchedTransactionIds &&
                  tx.matchedTransactionIds.length > 0 ? (
                  <div className="flex flex-col gap-1 text-sm bg-muted/50 p-2 rounded">
                    <span className="font-medium text-green-700">
                      Combo ({tx.matchedTransactionIds.length} itens)
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatCurrency(tx.amount)} (Total)
                    </span>
                    {tx.matchedBundleDetails && (
                      <div className="flex flex-col gap-1 mt-1 border-t pt-2 scroll-m-0">
                        {tx.matchedBundleDetails.map((sub, i) => (
                          <div
                            key={sub.id || i}
                            className="text-xs flex justify-between gap-2"
                          >
                            <span
                              className="truncate max-w-[180px]"
                              title={sub.description}
                            >
                              {sub.description}
                            </span>
                            <span className="whitespace-nowrap">
                              {formatCurrency(sub.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : tx.matchedDetails ? (
                  <div className="flex flex-col text-sm bg-muted/50 p-2 rounded group relative">
                    <span
                      className="font-semibold truncate w-full block"
                      title={tx.matchedDetails.description}
                    >
                      {tx.matchedDetails.description || "Sem descrição"}
                    </span>
                    <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                      <span>
                        {format(
                          new Date(tx.matchedDetails.dueDate),
                          "dd/MM/yyyy",
                        )}
                      </span>
                      <span>{formatCurrency(tx.matchedDetails.amount)}</span>
                    </div>
                    {/* Entity Name if available */}
                    {getMatchedEntityName(tx.matchedDetails) && (
                      <span className="text-xs text-blue-600 block mt-1">
                        {getMatchedEntityName(tx.matchedDetails)}
                      </span>
                    )}
                    {tx.confidence && tx.confidence < 100 && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div className="h-1 rounded-full bg-muted flex-1 overflow-hidden">
                          <div
                            className={cn(
                              "h-1 rounded-full transition-all",
                              tx.confidence >= 80
                                ? "bg-green-500"
                                : tx.confidence >= 60
                                  ? "bg-yellow-500"
                                  : "bg-red-400",
                            )}
                            style={{ width: `${tx.confidence}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {tx.confidence}%
                        </span>
                      </div>
                    )}
                  </div>
                ) : tx.matchedTransactionId ? (
                  <div className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded">
                    <span className="font-mono text-xs text-muted-foreground">
                      ID: {tx.matchedTransactionId.slice(0, 8)}...
                    </span>
                    {tx.confidence && tx.confidence < 100 && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="h-1 rounded-full bg-muted flex-1 overflow-hidden">
                          <div
                            className={cn(
                              "h-1 rounded-full",
                              tx.confidence >= 80
                                ? "bg-green-500"
                                : tx.confidence >= 60
                                  ? "bg-yellow-500"
                                  : "bg-red-400",
                            )}
                            style={{ width: `${tx.confidence}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {tx.confidence}%
                        </span>
                      </div>
                    )}
                  </div>
                ) : tx.matchCandidates && tx.matchCandidates.length > 0 ? (
                  <div className="flex flex-col gap-2 text-xs bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">
                      Sugestões ({tx.matchCandidates.length})
                    </span>
                    {tx.matchCandidates.map((c, i) => (
                      <div
                        key={`${c.id}-${i}`}
                        className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="flex justify-between gap-2">
                          <span
                            className="truncate max-w-[200px] font-medium"
                            title={c.transaction.description}
                          >
                            {c.transaction.description}
                          </span>
                          <span className="whitespace-nowrap">
                            {formatCurrency(c.transaction.amount)}
                          </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>
                            {format(
                              new Date(c.transaction.dueDate),
                              "dd/MM/yyyy",
                            )}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 rounded-full bg-muted w-12 overflow-hidden">
                              <div
                                className={cn(
                                  "h-1 rounded-full",
                                  c.score >= 80
                                    ? "bg-green-500"
                                    : c.score >= 60
                                      ? "bg-yellow-500"
                                      : "bg-red-400",
                                )}
                                style={{ width: `${c.score}%` }}
                              />
                            </div>
                            <span>{c.score}%</span>
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px]"
                            onClick={() => onAction(tx.id, "confirm", c.id)}
                          >
                            Selecionar
                          </Button>
                        </div>
                        {c.reasons.length > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            {c.reasons.join(" • ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">-</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {/* Logic: If potential match, show confirm/ignore. If unmatched, show create. If matched, show success. */}
                  {tx.status === "potential_match" && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-100"
                        title="Confirmar Match"
                        onClick={() => onAction(tx.id, "confirm")}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-100"
                        title="Ignorar"
                        onClick={() => onAction(tx.id, "ignore")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}

                  {tx.status === "unmatched" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => onAction(tx.id, "create")}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Criar
                    </Button>
                  )}

                  {tx.status === "matched" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground opacity-50"
                      disabled
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}

                  {/* Also allow ignore on unmatched if needed, but usually just leave it. */}
                  {tx.status === "unmatched" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => onAction(tx.id, "ignore")}
                      title="Ignorar"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
