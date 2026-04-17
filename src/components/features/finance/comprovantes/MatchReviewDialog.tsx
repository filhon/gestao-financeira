"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CheckCircle2,
  XCircle,
  Link2,
  FileText,
  ChevronsUpDown,
  Loader2,
  ExternalLink,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { Comprovante, Transaction } from "@/lib/types";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { ComprovanteStatusBadge } from "./ComprovanteStatusBadge";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Props {
  comprovante: Comprovante | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  /** Pre-loaded transaction if already known */
  matchedTransaction?: Transaction | null;
}

export function MatchReviewDialog({
  comprovante,
  open,
  onClose,
  onUpdated,
  matchedTransaction: propTx,
}: Props) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();

  const [isProcessing, setIsProcessing] = useState(false);
  const [manualTx, setManualTx] = useState<Transaction | null>(null);
  const [txSearch, setTxSearch] = useState("");
  const [txCandidates, setTxCandidates] = useState<Transaction[]>([]);
  const [isTxOpen, setIsTxOpen] = useState(false);
  const [isLoadingTx, setIsLoadingTx] = useState(false);

  // Shown transaction: confirmed match (propTx) or the suggested one from the algorithm
  const [suggestedTx, setSuggestedTx] = useState<Transaction | null>(null);
  const shownTx = propTx ?? suggestedTx;

  // Load paid/authorized payables for manual linking; resolve suggested tx
  useEffect(() => {
    if (!open || !selectedCompany) return;
    setSuggestedTx(null);
    setIsLoadingTx(true);
    transactionService
      .getAll({ companyId: selectedCompany.id, type: "payable" })
      .then((all) => {
        const candidates = all.filter(
          (t) => t.status === "paid" || t.status === "authorized",
        );
        setTxCandidates(candidates);
        if (comprovante?.suggestedTransactionId) {
          const found = candidates.find(
            (t) => t.id === comprovante.suggestedTransactionId,
          );
          if (found) setSuggestedTx(found);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoadingTx(false));
  }, [open, selectedCompany, comprovante?.suggestedTransactionId]);

  const filtered = txCandidates.filter((t) =>
    [t.description, t.supplierOrClient ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(txSearch.toLowerCase()),
  );

  const handleConfirm = useCallback(async () => {
    if (!user || !comprovante || !shownTx) return;
    try {
      setIsProcessing(true);
      await comprovanteService.confirmMatch(
        comprovante.id,
        shownTx.id,
        comprovante.storageUrl,
        user.uid,
      );
      toast.success("Associação confirmada com sucesso!");
      onUpdated();
      onClose();
    } catch {
      toast.error("Erro ao confirmar associação.");
    } finally {
      setIsProcessing(false);
    }
  }, [user, comprovante, shownTx, onUpdated, onClose]);

  const handleReject = useCallback(async () => {
    if (!user || !comprovante) return;
    try {
      setIsProcessing(true);
      await comprovanteService.rejectMatch(comprovante.id, user.uid);
      toast.info("Sugestão rejeitada. Comprovante permanece na fila.");
      onUpdated();
      onClose();
    } catch {
      toast.error("Erro ao rejeitar sugestão.");
    } finally {
      setIsProcessing(false);
    }
  }, [user, comprovante, onUpdated, onClose]);

  const handleManualLink = useCallback(async () => {
    if (!user || !comprovante || !manualTx) return;
    try {
      setIsProcessing(true);
      await comprovanteService.confirmMatch(
        comprovante.id,
        manualTx.id,
        comprovante.storageUrl,
        user.uid,
      );
      toast.success("Comprovante vinculado manualmente!");
      onUpdated();
      onClose();
    } catch {
      toast.error("Erro ao vincular comprovante.");
    } finally {
      setIsProcessing(false);
    }
  }, [user, comprovante, manualTx, onUpdated, onClose]);

  if (!comprovante) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[780px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar Comprovante</DialogTitle>
          <DialogDescription>
            Página {comprovante.pageNumber} de {comprovante.totalPages} ·{" "}
            <ComprovanteStatusBadge status={comprovante.matchStatus} />
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
          {/* ── PDF preview ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Comprovante
            </p>
            <div className="rounded-lg border overflow-hidden bg-muted/30 h-[360px] flex flex-col">
              <iframe
                src={comprovante.storageUrl}
                className="flex-1 w-full"
                title={`Comprovante página ${comprovante.pageNumber}`}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 flex-1"
                asChild
              >
                <a
                  href={comprovante.storageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 flex-1"
                asChild
              >
                <a href={comprovante.storageUrl} download>
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </a>
              </Button>
            </div>
          </div>

          {/* ── Right panel ────────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Confidence & suggestion */}
            {comprovante.matchConfidenceLevel && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Sugestão automática</p>
                  <ConfidenceBadge
                    level={comprovante.matchConfidenceLevel}
                    score={comprovante.matchConfidence}
                  />
                </div>
                {comprovante.matchedAmount && (
                  <p className="text-xs text-muted-foreground">
                    Valor encontrado:{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(comprovante.matchedAmount)}
                    </span>
                  </p>
                )}
                {comprovante.matchedDate && (
                  <p className="text-xs text-muted-foreground">
                    Data encontrada:{" "}
                    <span className="font-medium text-foreground">
                      {format(comprovante.matchedDate, "dd/MM/yyyy", {
                        locale: ptBR,
                      })}
                    </span>
                  </p>
                )}
                {comprovante.matchedEntity && (
                  <p className="text-xs text-muted-foreground">
                    Beneficiário:{" "}
                    <span className="font-medium text-foreground">
                      {comprovante.matchedEntity}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Matched transaction */}
            {shownTx ? (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">Transação sugerida</p>
                <Separator />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{shownTx.description}</p>
                  {shownTx.supplierOrClient && (
                    <p className="text-xs text-muted-foreground">
                      {shownTx.supplierOrClient}
                    </p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>
                      {formatCurrency(shownTx.finalAmount ?? shownTx.amount)}
                    </span>
                    <span>
                      {format(
                        shownTx.paymentDate ?? shownTx.dueDate,
                        "dd/MM/yyyy",
                        { locale: ptBR },
                      )}
                    </span>
                    <Badge variant="outline" className="h-4 text-[10px] px-1">
                      {shownTx.status === "paid" ? "Pago" : "Autorizado"}
                    </Badge>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-3 flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                <p className="text-sm">Nenhuma sugestão automática</p>
              </div>
            )}

            <Separator />

            {/* Manual link */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Vincular a outra transação</p>
              <Popover open={isTxOpen} onOpenChange={setIsTxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal text-left"
                    disabled={isLoadingTx}
                  >
                    {isLoadingTx ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Carregando…
                      </span>
                    ) : manualTx ? (
                      <span className="truncate">{manualTx.description}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        Buscar transação…
                      </span>
                    )}
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Buscar por descrição ou fornecedor…"
                      value={txSearch}
                      onValueChange={setTxSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Nenhuma transação encontrada.</CommandEmpty>
                      <CommandGroup>
                        {filtered.slice(0, 20).map((t) => (
                          <CommandItem
                            key={t.id}
                            value={t.id}
                            onSelect={() => {
                              setManualTx(t);
                              setIsTxOpen(false);
                            }}
                            className={cn(
                              "flex flex-col items-start gap-0.5",
                              manualTx?.id === t.id && "bg-primary/5",
                            )}
                          >
                            <span className="text-sm font-medium">
                              {t.description}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t.supplierOrClient} ·{" "}
                              {formatCurrency(t.finalAmount ?? t.amount)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 flex flex-wrap gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isProcessing}
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <XCircle className="h-4 w-4" />
            Rejeitar sugestão
          </Button>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
              Fechar
            </Button>

            {manualTx && (
              <Button
                variant="outline"
                onClick={handleManualLink}
                disabled={isProcessing}
                className="gap-1.5"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Vincular manualmente
              </Button>
            )}

            {shownTx && (
              <Button
                onClick={handleConfirm}
                disabled={isProcessing}
                className="gap-1.5"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Confirmar associação
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
