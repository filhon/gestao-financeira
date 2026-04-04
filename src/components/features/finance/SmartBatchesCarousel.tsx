"use client";

/**
 * SmartBatchesCarousel
 *
 * Exibe um carrossel horizontal de sugestões de lotes geradas pela Cloud Function
 * `suggestPaymentBatches` (CRON noturno). Cada card mostra:
 *  - Ícone do tipo de agrupamento (fornecedor, data, impostos)
 *  - Label descritivo, total em R$ e contagem de itens
 *  - Botão "Aceitar Lote" que cria o PaymentBatch oficial e navega para ele
 *
 * Os dados são lidos de `companies/{companyId}/suggested_batches` diretamente
 * via SDK do Firebase Client (sem API route extra — é uma leitura pequena/eventual).
 */

import { useEffect, useState, useRef } from "react";
import { db } from "@/lib/firebase/client";
import {
  collection,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { paymentBatchService } from "@/lib/services/paymentBatchService";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  Building2,
  Calendar,
  ReceiptText,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type SuggestionReason = "same_supplier" | "same_due_date" | "tax_group";

interface SuggestedBatch {
  id: string;
  reason: SuggestionReason;
  label: string;
  transactionIds: string[];
  totalAmount: number;
  dueDate: Date | null;
  supplierOrClient: string | null;
  generatedAt: Date;
}

// ─── Reason helpers ────────────────────────────────────────────────────────────

const REASON_META: Record<
  SuggestionReason,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  same_supplier: {
    label: "Mesmo Fornecedor",
    icon: Building2,
    color: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
  },
  same_due_date: {
    label: "Mesmo Vencimento",
    icon: Calendar,
    color:
      "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
  },
  tax_group: {
    label: "Obrigações Tributárias",
    icon: ReceiptText,
    color:
      "bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SmartBatchesCarouselProps {
  /** Callback chamado após aceitar uma sugestão (para atualizar a lista de transações) */
  onBatchAccepted?: () => void;
}

export function SmartBatchesCarousel({ onBatchAccepted }: SmartBatchesCarouselProps) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<SuggestedBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Track which suggestion id is being accepted right now
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  // Track which suggestions were dismissed locally
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Fetch suggestions ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!selectedCompany) return;
      setIsLoading(true);
      try {
        const snap = await getDocs(
          collection(db, "companies", selectedCompany.id, "suggested_batches"),
        );
        const loaded: SuggestedBatch[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            reason: data.reason as SuggestionReason,
            label: data.label ?? "",
            transactionIds: (data.transactionIds as string[]) ?? [],
            totalAmount: Number(data.totalAmount ?? 0),
            dueDate: data.dueDate
              ? (data.dueDate as Timestamp).toDate()
              : null,
            supplierOrClient: data.supplierOrClient ?? null,
            generatedAt: data.generatedAt
              ? (data.generatedAt as Timestamp).toDate()
              : new Date(),
          };
        });
        // Sort: tax first, then by totalAmount desc
        loaded.sort((a, b) => {
          if (a.reason === "tax_group" && b.reason !== "tax_group") return -1;
          if (b.reason === "tax_group" && a.reason !== "tax_group") return 1;
          return b.totalAmount - a.totalAmount;
        });
        setSuggestions(loaded);
      } catch (e) {
        console.error("SmartBatchesCarousel: failed to load suggestions", e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [selectedCompany]);

  // ── Scroll helpers ─────────────────────────────────────────────────────────
  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -320 : 320, behavior: "smooth" });
  };

  // ── Accept a suggestion ────────────────────────────────────────────────────
  const handleAccept = async (suggestion: SuggestedBatch) => {
    if (!user || !selectedCompany) return;

    setAcceptingId(suggestion.id);
    try {
      // 1 — Cria o PaymentBatch oficial com as transações sugeridas
      const batchName = `${suggestion.label} (sugestão automática)`;
      const batchRef = await paymentBatchService.acceptSuggested(
        batchName,
        selectedCompany.id,
        user.uid,
        suggestion.transactionIds,
      );

      toast.success(
        `Lote "${batchName}" criado com ${suggestion.transactionIds.length} conta(s)!`,
      );

      // 2 — Remove da lista local (otimistic UI)
      setDismissedIds((prev) => new Set([...prev, suggestion.id]));

      // 3 — Notifica a página pai para refrescar a lista de transações
      onBatchAccepted?.();

      // 4 — Navega para os Lotes de Pagamento para visualizar o recém-criado
      router.push(`/financeiro/lotes?highlight=${batchRef.id}`);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar lote a partir da sugestão.");
    } finally {
      setAcceptingId(null);
    }
  };

  // ── Dismiss locally ────────────────────────────────────────────────────────
  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  };

  const visible = suggestions.filter((s) => !dismissedIds.has(s.id));

  // ── Render: nothing to show ────────────────────────────────────────────────
  if (!isLoading && visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">Sugestões de Lotes</span>
          <Badge variant="secondary" className="text-xs">
            Automático
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => scroll("left")}
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => scroll("right")}
            aria-label="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Scroll track */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scroll-smooth
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {isLoading
          ? /* Skeleton cards */
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="min-w-[280px] h-[130px] rounded-lg border bg-muted/30
                           animate-pulse shrink-0"
              />
            ))
          : visible.map((s) => {
              const meta = REASON_META[s.reason] ?? REASON_META.same_due_date;
              const Icon = meta.icon;
              const isAccepting = acceptingId === s.id;

              return (
                <div
                  key={s.id}
                  className={`min-w-[280px] max-w-[280px] rounded-lg border p-4 shrink-0
                              flex flex-col gap-3 relative transition-all
                              hover:shadow-md ${meta.color}`}
                >
                  {/* Dismiss button */}
                  <button
                    onClick={() => handleDismiss(s.id)}
                    className="absolute top-2 right-2 text-muted-foreground
                               hover:text-foreground transition-colors"
                    aria-label="Dispensar sugestão"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>

                  {/* Type badge + icon */}
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                      {meta.label}
                    </span>
                  </div>

                  {/* Label + amounts */}
                  <div className="flex-1">
                    <p
                      className="text-sm font-semibold leading-snug line-clamp-2"
                      title={s.label}
                    >
                      {s.label}
                    </p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-base font-bold font-financial">
                        {formatCurrency(s.totalAmount)}
                      </span>
                      <span className="text-xs opacity-60">
                        {s.transactionIds.length} item
                        {s.transactionIds.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Accept button */}
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    disabled={isAccepting || !!acceptingId}
                    onClick={() => handleAccept(s)}
                  >
                    {isAccepting ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        Criando lote...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-1.5 h-3 w-3" />
                        Aceitar Lote
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
      </div>
    </div>
  );
}
