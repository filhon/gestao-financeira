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
import {
  Check,
  Plus,
  X,
  CheckCircle2,
  Zap,
  MinusCircle,
  Circle,
  Undo2,
  HandCoins,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BankTransaction } from "@/lib/types";

export type ReconciliationAction =
  | "confirm"
  | "create"
  | "settle"
  | "ignore"
  | "unreconcile";

interface ReconciliationTableProps {
  transactions: BankTransaction[];
  onAction: (
    id: string,
    action: ReconciliationAction,
    matchedId?: string,
  ) => void;
  readOnly?: boolean;
  isLocked?: (tx: BankTransaction) => boolean;
  canSettle?: (tx: BankTransaction) => boolean;
}

export function StatusBadge({ status }: { status: BankTransaction["status"] }) {
  switch (status) {
    case "matched":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-3 w-3" />
          Conciliado
        </Badge>
      );
    case "potential_match":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          <Zap className="h-3 w-3" />
          Sugestão
        </Badge>
      );
    case "ignored":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <MinusCircle className="h-3 w-3" />
          Ignorado
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Circle className="h-3 w-3" />
          Pendente
        </Badge>
      );
  }
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 rounded-full bg-muted w-12 overflow-hidden">
        <div
          className={cn(
            "h-1 rounded-full",
            value >= 80
              ? "bg-emerald-500"
              : value >= 60
                ? "bg-amber-500"
                : "bg-red-400",
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs tabular-nums">{value}%</span>
    </div>
  );
}

export function ReconciliationTable({
  transactions,
  onAction,
  readOnly,
  isLocked,
  canSettle,
}: ReconciliationTableProps) {
  const getMatchedEntityName = (
    matchedDetails: BankTransaction["matchedDetails"],
  ) => {
    if (!matchedDetails) return undefined;
    const withEntityName = matchedDetails as unknown as { entityName?: string };
    return withEntityName.entityName;
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Data</TableHead>
          <TableHead className="w-[34%]">Descrição no banco</TableHead>
          <TableHead className="w-[130px] text-right">Valor</TableHead>
          <TableHead className="w-[120px]">Situação</TableHead>
          <TableHead className="w-[30%]">No sistema</TableHead>
          <TableHead className="text-right w-[200px]">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={6}
              className="py-10 text-center text-sm text-muted-foreground"
            >
              Nenhuma linha com os filtros selecionados.
            </TableCell>
          </TableRow>
        )}
        {transactions.map((tx) => {
          const locked = isLocked?.(tx) ?? false;
          const editable = !readOnly && !locked;
          return (
            <TableRow
              key={tx.id}
              className={cn(tx.status === "ignored" && "text-muted-foreground")}
            >
              <TableCell className="tabular-nums">
                {format(new Date(tx.date), "dd/MM/yyyy")}
              </TableCell>

              <TableCell>
                <div
                  className="truncate font-medium max-w-[420px]"
                  title={tx.description}
                >
                  {tx.description}
                </div>
              </TableCell>

              <TableCell
                className={cn(
                  "text-right font-medium font-financial tabular-nums whitespace-nowrap",
                  tx.amount < 0
                    ? "text-red-700 dark:text-red-400"
                    : "text-emerald-700 dark:text-emerald-400",
                )}
              >
                {tx.amount < 0 ? "−" : "+"}
                {formatCurrency(Math.abs(tx.amount))}
              </TableCell>
              <TableCell>
                <StatusBadge status={tx.status} />
              </TableCell>
              <TableCell>
                {tx.matchedTransactionIds &&
                tx.matchedTransactionIds.length > 0 ? (
                  <div className="flex flex-col gap-1 text-sm bg-muted/50 p-2 rounded">
                    <span className="font-medium">
                      {tx.matchedTransactionIds.length} lançamentos somados
                    </span>
                    {tx.matchedBundleDetails && (
                      <div className="flex flex-col gap-1 mt-1 border-t pt-2">
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
                            <span className="whitespace-nowrap font-financial tabular-nums">
                              {formatCurrency(sub.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : tx.matchedDetails ? (
                  <div className="flex flex-col text-sm bg-muted/50 p-2 rounded">
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
                      <span className="font-financial tabular-nums">
                        {formatCurrency(tx.matchedDetails.amount)}
                      </span>
                    </div>
                    {getMatchedEntityName(tx.matchedDetails) && (
                      <span className="text-xs text-muted-foreground block mt-1">
                        {getMatchedEntityName(tx.matchedDetails)}
                      </span>
                    )}
                    {tx.confidence !== undefined && tx.confidence < 100 && (
                      <div className="mt-1.5 text-muted-foreground">
                        <ConfidenceBar value={tx.confidence} />
                      </div>
                    )}
                  </div>
                ) : tx.matchedTransactionId ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    ID {tx.matchedTransactionId.slice(0, 8)}
                  </span>
                ) : tx.matchCandidates && tx.matchCandidates.length > 0 ? (
                  <div className="flex flex-col gap-2 text-xs bg-muted/50 p-2 rounded">
                    <span className="text-muted-foreground">
                      {tx.matchCandidates.length} candidato(s)
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
                          <span className="whitespace-nowrap font-financial tabular-nums">
                            {formatCurrency(c.transaction.amount)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-muted-foreground">
                          <span>
                            {format(
                              new Date(c.transaction.dueDate),
                              "dd/MM/yyyy",
                            )}
                          </span>
                          <ConfidenceBar value={c.score} />
                        </div>
                        {c.reasons.length > 0 && (
                          <div className="text-muted-foreground">
                            {c.reasons.join(" · ")}
                          </div>
                        )}
                        {editable && (
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => onAction(tx.id, "confirm", c.id)}
                            >
                              Usar este
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {locked ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                      title="Período fechado"
                    >
                      <Lock className="h-3.5 w-3.5" /> Fechado
                    </span>
                  ) : !editable ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <>
                      {tx.status === "potential_match" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => onAction(tx.id, "confirm")}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Confirmar
                        </Button>
                      )}

                      {tx.status === "unmatched" && (
                        <>
                          {canSettle?.(tx) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => onAction(tx.id, "settle")}
                              title="Quitar um título em aberto com este pagamento"
                            >
                              <HandCoins className="h-3.5 w-3.5 mr-1" />
                              Baixar título
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => onAction(tx.id, "create")}
                            title="Criar um lançamento já pago para esta linha"
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Lançar
                          </Button>
                        </>
                      )}

                      {(tx.status === "potential_match" ||
                        tx.status === "unmatched") && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => onAction(tx.id, "ignore")}
                          aria-label="Ignorar"
                          title="Ignorar (não pede lançamento)"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}

                      {(tx.status === "matched" || tx.status === "ignored") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => onAction(tx.id, "unreconcile")}
                        >
                          <Undo2 className="h-3.5 w-3.5 mr-1" />
                          Desfazer
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
