"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
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
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { Comprovante, Transaction } from "@/lib/types";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { ComprovanteStatusBadge } from "./ComprovanteStatusBadge";
import { formatCurrency, comprovanteProxyUrl } from "@/lib/utils";
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

  const previewUrl = comprovante
    ? comprovanteProxyUrl(comprovante.storagePath, "inline")
    : null;
  const downloadUrl = comprovante
    ? comprovanteProxyUrl(comprovante.storagePath, "download")
    : null;

  const [isProcessing, setIsProcessing] = useState(false);
  const [manualTxs, setManualTxs] = useState<Transaction[]>([]);
  const [txSearch, setTxSearch] = useState("");
  const [isTxOpen, setIsTxOpen] = useState(false);

  // Shown transaction(s): confirmed match (propTx / full group) or suggested
  const [resolvedTxs, setResolvedTxs] = useState<Transaction[]>([]);

  // Derive which transactions are "shown" as the current suggestion/match
  const shownTxs = useMemo<Transaction[]>(
    () => (resolvedTxs.length > 0 ? resolvedTxs : propTx ? [propTx] : []),
    [resolvedTxs, propTx],
  );

  // Cached list of paid/authorized payables — shared across modal opens
  const { data: txCandidates = [], isLoading: isLoadingTx } = useQuery({
    queryKey: ["tx-candidates", selectedCompany?.id],
    queryFn: () =>
      transactionService.getAll({
        companyId: selectedCompany!.id,
        type: "payable",
        statuses: ["paid", "authorized"],
      }),
    enabled: open && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });

  // Resolve suggested/confirmed transaction IDs from the cached list
  useEffect(() => {
    if (!open || txCandidates.length === 0) return;
    setResolvedTxs([]);

    // For confirmed consolidated matches, show all linked transactions
    if (
      comprovante?.matchStatus === "matched" &&
      comprovante.isConsolidated &&
      (comprovante.transactionIds?.length ?? 0) > 1
    ) {
      const found = txCandidates.filter((t) =>
        comprovante.transactionIds!.includes(t.id),
      );
      if (found.length > 0) {
        setResolvedTxs(found);
        return;
      }
    }

    // For pending_review: resolve suggested transaction IDs
    const suggestedIds =
      comprovante?.suggestedTransactionIds ??
      (comprovante?.suggestedTransactionId
        ? [comprovante.suggestedTransactionId]
        : []);

    if (suggestedIds.length > 0) {
      const found = txCandidates.filter((t) => suggestedIds.includes(t.id));
      if (found.length > 0) setResolvedTxs(found);
    }
  }, [
    open,
    txCandidates,
    comprovante?.matchStatus,
    comprovante?.isConsolidated,
    comprovante?.transactionIds,
    comprovante?.suggestedTransactionId,
    comprovante?.suggestedTransactionIds,
  ]);

  const filtered = txCandidates.filter((t) =>
    [t.description, t.supplierOrClient ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(txSearch.toLowerCase()),
  );

  // Effective transaction IDs to confirm (shown suggestion OR manual selection)
  const effectiveTxIds =
    manualTxs.length > 0
      ? manualTxs.map((t) => t.id)
      : shownTxs.map((t) => t.id);

  const handleConfirm = useCallback(async () => {
    if (!user || !comprovante || effectiveTxIds.length === 0) return;
    const effectiveTxs = manualTxs.length > 0 ? manualTxs : shownTxs;
    try {
      setIsProcessing(true);
      await comprovanteService.confirmMatch(
        comprovante.id,
        effectiveTxIds,
        effectiveTxs,
        user.uid,
        comprovante.storagePath,
        selectedCompany
          ? { companyId: selectedCompany.id, userEmail: user.email ?? "" }
          : undefined,
      );
      toast.success("Associação confirmada com sucesso!");
      onUpdated();
      onClose();
    } catch {
      toast.error("Erro ao confirmar associação.");
    } finally {
      setIsProcessing(false);
    }
  }, [
    user,
    comprovante,
    effectiveTxIds,
    manualTxs,
    shownTxs,
    onUpdated,
    onClose,
    selectedCompany,
  ]);

  const handleReject = useCallback(async () => {
    if (!user || !comprovante) return;
    try {
      setIsProcessing(true);
      await comprovanteService.rejectMatch(
        comprovante.id,
        user.uid,
        selectedCompany
          ? { companyId: selectedCompany.id, userEmail: user.email ?? "" }
          : undefined,
      );
      toast.info("Sugestão rejeitada. Comprovante permanece na fila.");
      onUpdated();
      onClose();
    } catch {
      toast.error("Erro ao rejeitar sugestão.");
    } finally {
      setIsProcessing(false);
    }
  }, [user, comprovante, onUpdated, onClose, selectedCompany]);

  const toggleManualTx = (tx: Transaction) => {
    setManualTxs((prev) => {
      const exists = prev.find((t) => t.id === tx.id);
      if (exists) return prev.filter((t) => t.id !== tx.id);

      // Consolidated matches must belong to the same entity
      if (prev.length > 0) {
        const refEntityId = prev[0].entityId ?? null;
        const refName = prev[0].supplierOrClient ?? null;
        const sameEntity =
          refEntityId !== null
            ? tx.entityId === refEntityId
            : refName !== null && tx.supplierOrClient === refName;
        if (!sameEntity) {
          toast.error(
            "Associação consolidada exige transações do mesmo fornecedor.",
          );
          return prev;
        }
      }

      return [...prev, tx];
    });
  };

  if (!comprovante) return null;

  const isConsolidatedSuggestion =
    (comprovante.suggestedTransactionIds?.length ?? 0) > 1 ||
    comprovante.isConsolidated;

  const hasConfirmTarget = effectiveTxIds.length > 0;

  // For the suggested transactions section
  const suggestedTotal = shownTxs.reduce(
    (sum, tx) => sum + (tx.finalAmount ?? tx.amount),
    0,
  );
  const manualTotal = manualTxs.reduce(
    (sum, tx) => sum + (tx.finalAmount ?? tx.amount),
    0,
  );

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="sm:max-w-[780px] max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Revisar Comprovante</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Página {comprovante.pageNumber} de {comprovante.totalPages} ·{" "}
            <ComprovanteStatusBadge status={comprovante.matchStatus} />
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
          {/* ── PDF preview ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Comprovante
            </p>
            <div className="rounded-lg border overflow-hidden bg-muted/30 h-[480px] flex flex-col">
              {previewUrl && (
                <object
                  data={previewUrl}
                  type="application/pdf"
                  className="flex-1 w-full"
                  title={`Comprovante página ${comprovante.pageNumber}`}
                >
                  <div className="flex flex-col items-center justify-center gap-2 h-full text-muted-foreground">
                    <FileText className="h-8 w-8 opacity-40" />
                    <p className="text-sm">Pré-visualização não disponível.</p>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline"
                    >
                      Abrir PDF
                    </a>
                  </div>
                </object>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 flex-1"
                asChild
              >
                <a
                  href={previewUrl ?? ""}
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
                <a href={downloadUrl ?? ""} download>
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </a>
              </Button>
            </div>
          </div>

          {/* ── Right panel ────────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Confidence & extracted data */}
            {comprovante.matchConfidenceLevel && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Sugestão automática</p>
                    {isConsolidatedSuggestion && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        <Layers className="h-2.5 w-2.5" />
                        Consolidada
                      </span>
                    )}
                  </div>
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
                    {isConsolidatedSuggestion && (
                      <span className="ml-1 text-blue-600 dark:text-blue-400">
                        (soma de{" "}
                        {comprovante.suggestedTransactionIds?.length ??
                          shownTxs.length}{" "}
                        transações)
                      </span>
                    )}
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

            {/* Suggested transaction(s) */}
            {shownTxs.length > 0 ? (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {shownTxs.length > 1
                      ? `${shownTxs.length} transações sugeridas`
                      : "Transação sugerida"}
                  </p>
                  {shownTxs.length > 1 && (
                    <span className="text-xs font-medium text-foreground">
                      Total: {formatCurrency(suggestedTotal)}
                    </span>
                  )}
                </div>
                <Separator />
                <div className="space-y-2 max-h-[180px] overflow-y-auto">
                  {shownTxs.map((tx) => (
                    <div key={tx.id} className="space-y-1">
                      <p className="text-sm font-medium">{tx.description}</p>
                      {tx.supplierOrClient && (
                        <p className="text-xs text-muted-foreground">
                          {tx.supplierOrClient}
                        </p>
                      )}
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>
                          {formatCurrency(tx.finalAmount ?? tx.amount)}
                        </span>
                        <span>
                          {format(tx.paymentDate ?? tx.dueDate, "dd/MM/yyyy", {
                            locale: ptBR,
                          })}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-4 text-[10px] px-1"
                        >
                          {tx.status === "paid" ? "Pago" : "Autorizado"}
                        </Badge>
                      </div>
                      {shownTxs.length > 1 && <Separator className="mt-2" />}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-3 flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                <p className="text-sm">Nenhuma sugestão automática</p>
              </div>
            )}

            <Separator />

            {/* Manual link — supports multi-select for consolidated */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Vincular a transação(ões)</p>
                {manualTxs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {manualTxs.length} selecionada
                      {manualTxs.length !== 1 ? "s" : ""} ·{" "}
                      {formatCurrency(manualTotal)}
                    </span>
                    <button
                      onClick={() => setManualTxs([])}
                      className="text-xs text-destructive hover:underline"
                    >
                      Limpar
                    </button>
                  </div>
                )}
              </div>
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
                    ) : manualTxs.length > 0 ? (
                      <span className="truncate">
                        {manualTxs.length === 1
                          ? manualTxs[0].description
                          : `${manualTxs.length} transações selecionadas`}
                      </span>
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
                        {filtered.slice(0, 20).map((t) => {
                          const selected = !!manualTxs.find(
                            (m) => m.id === t.id,
                          );
                          return (
                            <CommandItem
                              key={t.id}
                              value={t.id}
                              onSelect={() => {
                                toggleManualTx(t);
                              }}
                              className={cn(
                                "flex flex-col items-start gap-0.5",
                                selected && "bg-primary/5",
                              )}
                            >
                              <div className="flex items-center gap-2 w-full">
                                <div
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0 rounded-sm border",
                                    selected
                                      ? "border-primary bg-primary"
                                      : "border-muted-foreground",
                                  )}
                                >
                                  {selected && (
                                    <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                                  )}
                                </div>
                                <span className="text-sm font-medium flex-1">
                                  {t.description}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground pl-5">
                                {t.supplierOrClient} ·{" "}
                                {formatCurrency(t.finalAmount ?? t.amount)}
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {manualTxs.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Associação consolidada: este comprovante cobrirá{" "}
                  {manualTxs.length} transações do mesmo fornecedor (
                  {formatCurrency(manualTotal)}).
                </p>
              )}
            </div>
          </div>
        </div>

        <ResponsiveModalFooter className="mt-4 flex flex-wrap gap-2 sm:justify-between">
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

            {hasConfirmTarget && (
              <Button
                onClick={handleConfirm}
                disabled={isProcessing}
                className="gap-1.5"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                {manualTxs.length > 0
                  ? `Vincular ${manualTxs.length} transaç${manualTxs.length !== 1 ? "ões" : "ão"}`
                  : "Confirmar associação"}
              </Button>
            )}
          </div>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
