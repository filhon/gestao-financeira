"use client";

import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
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
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BankTransaction } from "@/lib/types";

interface ReconciliationTableProps {
  onAction: (id: string, action: "confirm" | "create" | "ignore") => void;
}

export function ReconciliationTable({ onAction }: ReconciliationTableProps) {
  const { transactions } = useReconciliationStore();

  const getStatusBadge = (status: BankTransaction["status"]) => {
    switch (status) {
      case "matched":
        return (
          <Badge className="bg-green-500 hover:bg-green-600">Corresp.</Badge>
        );
      case "potential_match":
        return (
          <Badge
            variant="secondary"
            className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
          >
            Sugestão
          </Badge>
        ); // yellow
      case "ignored":
        return <Badge variant="outline">Ignorado</Badge>;
      default:
        return <Badge variant="secondary">Novo</Badge>;
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Descrição (Banco)</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sugestão Sistema</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx) => (
            <TableRow key={tx.id}>
              <TableCell>{format(new Date(tx.date), "dd/MM/yyyy")}</TableCell>
              <TableCell className="font-medium">{tx.description}</TableCell>
              <TableCell
                className={cn(
                  tx.amount < 0 ? "text-red-600" : "text-green-600",
                )}
              >
                {formatCurrency(tx.amount)}
              </TableCell>
              <TableCell>{getStatusBadge(tx.status)}</TableCell>
              <TableCell>
                {tx.matchedTransactionIds &&
                tx.matchedTransactionIds.length > 0 ? (
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-green-700">
                      Combo ({tx.matchedTransactionIds.length} itens)
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatCurrency(tx.amount)} (Total)
                    </span>
                  </div>
                ) : tx.matchedTransactionId ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      ID: {tx.matchedTransactionId.slice(0, 8)}...
                    </span>
                    {tx.confidence && tx.confidence < 100 && (
                      <span className="text-yellow-600 text-xs">
                        ({tx.confidence}%)
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">-</span>
                )}
              </TableCell>
              <TableCell className="text-right space-x-2">
                {tx.status === "matched" || tx.status === "potential_match" ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-green-600"
                    onClick={() => onAction(tx.id, "confirm")}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => onAction(tx.id, "create")}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Criar
                  </Button>
                )}

                {tx.status !== "ignored" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => onAction(tx.id, "ignore")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
