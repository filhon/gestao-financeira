"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Layers,
  Link2,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Comprovante, Transaction } from "@/lib/types";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { transactionService } from "@/lib/services/transactionService";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { ComprovanteStatusBadge } from "./ComprovanteStatusBadge";
import { ReadFieldsEditor } from "./ReadFieldsEditor";
import { DocumentPreview } from "../DocumentPreview";
import {
  amountDifference,
  linkedTransactionIds,
  receiptInsight,
  titlesTotal,
} from "./receiptInsight";
import { cn, formatCurrency, comprovanteProxyUrl } from "@/lib/utils";

export type ReviewResult =
  | {
      kind: "confirmed";
      id: string;
      patch: Partial<Comprovante>;
      undo: () => Promise<void>;
    }
  | { kind: "rejected"; id: string; patch: Partial<Comprovante> };

interface Props {
  comprovante: Comprovante | null;
  /** Posição na lista carregada, para "3 de 25". */
  position: { index: number; total: number } | null;
  canEdit: boolean;
  onClose: () => void;
  onNavigate: (dir: 1 | -1) => void;
  onDone: (result: ReviewResult) => void;
  /** Atualização no lugar (leitura corrigida, nova sugestão). */
  onPatch: (id: string, patch: Partial<Comprovante>) => void;
}

/** Lista de pagáveis pagos/autorizados, compartilhada com a página. */
export const txCandidatesKey = (companyId?: string) => [
  "tx-candidates",
  companyId,
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1.5 hidden rounded border border-current/25 px-1 font-sans text-[11px] leading-4 opacity-70 sm:inline">
      {children}
    </kbd>
  );
}

export function MatchReviewPanel(props: Props) {
  const { comprovante, onClose } = props;
  const focusRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet open={!!comprovante} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-[min(1120px,96vw)]"
        // O título já descreve o painel; sem isto o Radix avisa no console.
        aria-describedby={undefined}
        // O foco vai para o painel, não para o primeiro botão: senão Enter
        // acionaria "fechar" em vez de confirmar.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusRef.current?.focus();
        }}
      >
        <div
          ref={focusRef}
          tabIndex={-1}
          className="flex h-full min-h-0 flex-col outline-none"
        >
          {comprovante && (
            <ReviewBody key={comprovante.id} {...props} c={comprovante} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReviewBody({
  c,
  position,
  canEdit,
  onNavigate,
  onDone,
  onPatch,
}: Props & { c: Comprovante }) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();

  const previewUrl = comprovanteProxyUrl(c.storagePath, "inline");
  const downloadUrl = comprovanteProxyUrl(c.storagePath, "download");

  const [isProcessing, setIsProcessing] = useState(false);
  const [manualTxs, setManualTxs] = useState<Transaction[]>([]);
  const [txSearch, setTxSearch] = useState("");

  const { data: txCandidates = [], isLoading: isLoadingTx } = useQuery({
    queryKey: txCandidatesKey(selectedCompany?.id),
    queryFn: () =>
      transactionService.getAll({
        companyId: selectedCompany!.id,
        type: "payable",
        statuses: ["paid", "authorized"],
      }),
    enabled: !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });

  const byId = useMemo(
    () => new Map(txCandidates.map((t) => [t.id, t])),
    [txCandidates],
  );

  // Sugestão (pendente) ou associação confirmada.
  const linkedIds = linkedTransactionIds(c);
  const shownTxs = linkedIds
    .map((id) => byId.get(id))
    .filter((t): t is Transaction => !!t);

  const alternatives = useMemo(() => {
    const shown = new Set(linkedIds);
    return (c.matchAlternatives ?? [])
      .map((alt) => ({
        ...alt,
        transactions: alt.transactionIds
          .map((id) => byId.get(id))
          .filter((t): t is Transaction => !!t),
      }))
      .filter(
        (alt) =>
          alt.transactions.length === alt.transactionIds.length &&
          alt.transactions.length > 0 &&
          !alt.transactionIds.every((id) => shown.has(id)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.matchAlternatives, byId]);

  // Busca manual: sem termo, os mais próximos do valor lido aparecem primeiro;
  // títulos que já têm comprovante vão para o fim.
  const searchResults = useMemo(() => {
    const terms = txSearch.toLowerCase().split(/\s+/).filter(Boolean);
    const target = c.matchedAmount;
    const day = c.matchedDate?.getTime();
    const shown = new Set(linkedIds);
    const dayGap = (t: Transaction) =>
      day == null ? 0 : Math.abs((t.paymentDate ?? t.dueDate).getTime() - day);
    return txCandidates
      .filter((t) => {
        if (shown.has(t.id)) return false;
        if (!terms.length) return true;
        const hay = [
          t.description,
          t.supplierOrClient ?? "",
          formatCurrency(t.finalAmount ?? t.amount),
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => hay.includes(term));
      })
      .sort((a, b) => {
        const taken = Number(!!a.comprovanteId) - Number(!!b.comprovanteId);
        if (taken !== 0) return taken;
        const byAmount =
          target == null
            ? 0
            : Math.abs((a.finalAmount ?? a.amount) - target) -
              Math.abs((b.finalAmount ?? b.amount) - target);
        // Parcelas do mesmo valor: a paga mais perto da data lida primeiro.
        return byAmount || dayGap(a) - dayGap(b);
      })
      .slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    txCandidates,
    txSearch,
    c.matchedAmount,
    c.matchedDate,
    linkedIds.join(),
  ]);

  const effectiveTxs = manualTxs.length > 0 ? manualTxs : shownTxs;
  const actionable = canEdit && c.matchStatus !== "matched";
  const canReject =
    actionable && c.matchStatus === "pending_review" && shownTxs.length > 0;
  const hasConfirmTarget = actionable && effectiveTxs.length > 0;
  const insight = receiptInsight(c, shownTxs);
  const diff = amountDifference(c, shownTxs);

  const actor =
    selectedCompany && user
      ? { companyId: selectedCompany.id, userEmail: user.email ?? "" }
      : undefined;

  const handleConfirm = useCallback(async () => {
    if (!user || effectiveTxs.length === 0 || isProcessing) return;
    const ids = effectiveTxs.map((t) => t.id);
    const previous = c.matchStatus;
    try {
      setIsProcessing(true);
      await comprovanteService.confirmMatch(
        c.id,
        ids,
        effectiveTxs,
        user.uid,
        c.storagePath,
        actor,
      );
      // A leitura não achou o beneficiário, mas o usuário acabou de dizer
      // quem é: o comprovante ensina a entidade para os próximos.
      const entityIds = new Set(effectiveTxs.map((t) => t.entityId));
      const entityId = effectiveTxs[0].entityId;
      if (
        !c.matchedEntity &&
        entityId &&
        entityIds.size === 1 &&
        selectedCompany
      ) {
        comprovanteService
          .calibrate(selectedCompany.id, {
            comprovanteId: c.id,
            entityId,
            learnOnly: true,
          })
          .catch((err) => console.error("[learn on confirm]", err));
      }
      onDone({
        kind: "confirmed",
        id: c.id,
        patch: {
          matchStatus: "matched",
          transactionId: ids[0],
          transactionIds: ids,
          isConsolidated: ids.length > 1,
          autoConfirmed: false,
          reviewedAt: new Date(),
        },
        undo: () =>
          comprovanteService.removeMatch(
            c.id,
            ids,
            user.uid,
            actor,
            previous === "matched" ? "unmatched" : previous,
          ),
      });
    } catch {
      toast.error("Erro ao confirmar associação.");
      setIsProcessing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveTxs, isProcessing, c, onDone]);

  const handleReject = useCallback(async () => {
    if (!user || isProcessing) return;
    try {
      setIsProcessing(true);
      await comprovanteService.rejectMatch(c.id, user.uid, actor);
      onDone({
        kind: "rejected",
        id: c.id,
        patch: {
          matchStatus: "rejected_match",
          suggestedTransactionId: undefined,
          suggestedTransactionIds: undefined,
        },
      });
    } catch {
      toast.error("Erro ao rejeitar sugestão.");
      setIsProcessing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isProcessing, c.id, onDone]);

  // Atalhos: J/K navegam, Enter confirma, R rejeita. Campos de texto e botões
  // focados mantêm o comportamento nativo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        e.preventDefault();
        onNavigate(key === "j" ? 1 : -1);
      } else if (
        e.key === "Enter" &&
        hasConfirmTarget &&
        !target.closest("button, a, [role=option]")
      ) {
        e.preventDefault();
        handleConfirm();
      } else if (key === "r" && canReject) {
        e.preventDefault();
        handleReject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNavigate, hasConfirmTarget, canReject, handleConfirm, handleReject]);

  const toggleManualTx = (tx: Transaction) => {
    setManualTxs((prev) => {
      if (prev.some((t) => t.id === tx.id)) {
        return prev.filter((t) => t.id !== tx.id);
      }
      // Associação consolidada exige o mesmo fornecedor.
      if (prev.length > 0) {
        const ref = prev[0];
        const sameEntity = ref.entityId
          ? tx.entityId === ref.entityId
          : !!ref.supplierOrClient &&
            tx.supplierOrClient === ref.supplierOrClient;
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

  const selectedAltKey = manualTxs
    .map((t) => t.id)
    .sort()
    .join(",");

  return (
    <>
      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b px-4 py-3 pr-12">
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base">
            {position
              ? `Comprovante ${position.index + 1} de ${position.total}`
              : "Comprovante"}
          </SheetTitle>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ComprovanteStatusBadge status={c.matchStatus} />
            <span>
              Página {c.pageNumber} de {c.totalPages} · enviado em{" "}
              {format(c.createdAt, "dd/MM/yyyy")}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(-1)}
            aria-label="Comprovante anterior (K)"
          >
            <ChevronUp className="h-4 w-4" />
            <Kbd>K</Kbd>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(1)}
            aria-label="Próximo comprovante (J)"
          >
            <ChevronDown className="h-4 w-4" />
            <Kbd>J</Kbd>
          </Button>
        </div>
      </div>

      {/* ── Corpo ─────────────────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_400px] md:overflow-hidden">
        {/* Prévia */}
        <div className="flex min-h-[60vh] flex-col gap-2 bg-muted/30 p-3 md:min-h-0">
          <DocumentPreview
            key={previewUrl}
            url={previewUrl}
            name={c.storagePath}
            title={`Comprovante página ${c.pageNumber}`}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir em nova aba
              </a>
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <a href={downloadUrl} download>
                <Download className="h-3.5 w-3.5" />
                Baixar
              </a>
            </Button>
          </div>
        </div>

        {/* Decisão */}
        <div className="space-y-5 border-l p-4 md:overflow-y-auto">
          <ReadFieldsEditor
            c={c}
            insight={insight}
            canEdit={canEdit}
            onPatch={(patch) => {
              setManualTxs([]);
              onPatch(c.id, patch);
            }}
          />

          {c.matchStatus === "needs_manual" && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              Não foi possível ler o texto deste arquivo. Confira a prévia e
              vincule o título abaixo.
            </p>
          )}

          {/* Sugestão ou associação */}
          {shownTxs.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  {c.matchStatus === "matched"
                    ? "Associado a"
                    : shownTxs.length > 1
                      ? `${shownTxs.length} títulos sugeridos`
                      : "Título sugerido"}
                  {shownTxs.length > 1 && (
                    <Layers
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-label="Consolidada"
                    />
                  )}
                </h3>
                {shownTxs.length > 1 && (
                  <span className="font-financial text-sm">
                    {formatCurrency(titlesTotal(shownTxs))}
                  </span>
                )}
              </div>
              <ul
                className={cn(
                  "divide-y rounded-md border",
                  manualTxs.length > 0 && "opacity-50",
                )}
              >
                {shownTxs.map((tx) => (
                  <TxRow key={tx.id} tx={tx} />
                ))}
              </ul>
              {diff !== null && (
                <p className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Comprovante {formatCurrency(c.matchedAmount!)}, títulos{" "}
                  {formatCurrency(titlesTotal(shownTxs))}. Diferença de{" "}
                  {formatCurrency(Math.abs(diff))}.
                </p>
              )}
            </section>
          )}

          {(c.matchReasons?.length ?? 0) > 0 && c.matchStatus !== "matched" && (
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Por que esta sugestão</h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {c.matchReasons!.map((reason, i) => {
                  const warn = reason.startsWith("⚠");
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex gap-1.5",
                        warn && "text-amber-800 dark:text-amber-300",
                      )}
                    >
                      {warn ? (
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      )}
                      <span>{reason.replace(/^⚠\s*/, "")}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {actionable && alternatives.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Outras possibilidades</h3>
              <div className="space-y-1">
                {alternatives.map((alt) => {
                  const key = [...alt.transactionIds].sort().join(",");
                  const selected = key === selectedAltKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setManualTxs(selected ? [] : alt.transactions)
                      }
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {alt.transactions[0].description}
                          {alt.transactions.length > 1 &&
                            ` e mais ${alt.transactions.length - 1}`}
                        </span>
                        <span className="shrink-0 font-financial text-sm">
                          {formatCurrency(titlesTotal(alt.transactions))}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {alt.entityName ?? alt.transactions[0].supplierOrClient}
                        {alt.reason && ` · ${alt.reason}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {actionable && (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Vincular a outro título
                </h3>
                {manualTxs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setManualTxs([])}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Limpar seleção ({manualTxs.length} ·{" "}
                    {formatCurrency(titlesTotal(manualTxs))})
                  </button>
                )}
              </div>
              <Command shouldFilter={false} className="rounded-md border">
                <CommandInput
                  placeholder="Descrição, fornecedor ou valor…"
                  value={txSearch}
                  onValueChange={setTxSearch}
                />
                <CommandList className="max-h-64">
                  {isLoadingTx ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando títulos…
                    </div>
                  ) : (
                    <CommandEmpty>Nenhum título encontrado.</CommandEmpty>
                  )}
                  {searchResults.map((t) => {
                    const selected = manualTxs.some((m) => m.id === t.id);
                    return (
                      <CommandItem
                        key={t.id}
                        value={t.id}
                        onSelect={() => toggleManualTx(t)}
                        aria-selected={selected}
                        className={cn(
                          "flex items-start gap-2",
                          selected && "bg-primary/5",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground",
                          )}
                        >
                          {selected && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex justify-between gap-2">
                            <span className="truncate text-sm">
                              {t.description}
                            </span>
                            <span className="shrink-0 font-financial text-sm">
                              {formatCurrency(t.finalAmount ?? t.amount)}
                            </span>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.supplierOrClient}
                            {t.paymentDate &&
                              ` · pago em ${format(t.paymentDate, "dd/MM/yyyy")}`}
                            {t.comprovanteId && " · já tem comprovante"}
                          </span>
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandList>
              </Command>
            </section>
          )}
        </div>
      </div>

      {/* ── Rodapé ────────────────────────────────────────────────────── */}
      {actionable && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          {canReject ? (
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={isProcessing}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <XCircle className="h-4 w-4" />
              Rejeitar sugestão
              <Kbd>R</Kbd>
            </Button>
          ) : (
            <span />
          )}
          <Button
            onClick={handleConfirm}
            disabled={isProcessing || !hasConfirmTarget}
            className="gap-1.5"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {manualTxs.length > 0
              ? `Vincular ${manualTxs.length} título${manualTxs.length !== 1 ? "s" : ""}`
              : "Confirmar associação"}
            <Kbd>↵</Kbd>
          </Button>
        </div>
      )}
    </>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  return (
    <li className="space-y-0.5 px-3 py-2">
      <div className="flex justify-between gap-2">
        <p className="text-sm font-medium">{tx.description}</p>
        <p className="shrink-0 font-financial text-sm">
          {formatCurrency(tx.finalAmount ?? tx.amount)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {tx.supplierOrClient && `${tx.supplierOrClient} · `}
        {tx.paymentDate
          ? `pago em ${format(tx.paymentDate, "dd/MM/yyyy")}`
          : `vence em ${format(tx.dueDate, "dd/MM/yyyy")} (autorizado, ainda não pago)`}
      </p>
    </li>
  );
}
