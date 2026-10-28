"use client";

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import currency from "currency.js";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BudgetRequest, CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import {
  buildCostCenterTree,
  committedOf,
  costCenterLedgerService,
  parentOf,
} from "@/lib/services/costCenterLedgerService";
import { budgetRequestService } from "@/lib/services/budgetRequestService";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useCostCenterBalances, useCostCenters } from "@/hooks/useCostCenters";
import {
  CostCenterFormDialog,
  toFormData,
} from "@/components/features/finance/CostCenterFormDialog";

const add = (a: number, b: number) => currency(a).add(b).value;
const subtract = (a: number, ...rest: number[]) =>
  rest.reduce((acc, v) => acc.subtract(v), currency(a)).value;

/** Tolerância de um centavo, para não sinalizar ruído de arredondamento. */
const isNegative = (v: number) => v < -0.005;
const isZero = (v: number) => Math.abs(v) <= 0.005;

/** Busca sem acento e sem caixa: "saude" acha "Saúde". */
const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Alçada: com a folha 85% comprometida, aprovar despesa nova ali passa a ser
 * do gestor financeiro ou do administrador. Espelha `ALCADA_RATIO` em
 * functions/src/transactionLedger.ts, que é quem decide de fato.
 */
const ALCADA_RATIO = 0.85;

/** O prefixo "CC-" se repete em todo código; sem ele, o código se lê. */
const shortCode = (code?: string) => (code || "").replace(/^CC-/i, "");

// Todas as colunas crescem, não só a de nome. Com largura fixa nas numéricas,
// o espaço extra de um monitor largo se acumulava num vão único entre o centro
// de custo e seus valores; repartido em frações, ele some.
const GRID =
  "grid grid-cols-[minmax(220px,2.4fr)_minmax(160px,1fr)_minmax(150px,1fr)_minmax(110px,0.8fr)_minmax(150px,1fr)_40px] items-center gap-x-4";

interface Row {
  cc: CostCenter;
  depth: number;
  hasChildren: boolean;
  /** Último filho do seu pai: a guia vertical para no meio da linha. */
  isLast: boolean;
  /** Por nível ancestral, se aquele ramo ainda continua abaixo desta linha. */
  guides: boolean[];
  /** Posição entre os irmãos, para o leitor de tela (aria-posinset/setsize). */
  posInSet: number;
  setSize: number;
}

/** Achata a árvore na ordem de leitura. O raiz fica de fora: ele é o caixa. */
function flatten(tree: ReturnType<typeof buildCostCenterTree>): Row[] {
  const rows: Row[] = [];

  const walk = (id: string, depth: number, guides: boolean[]) => {
    const children = (tree.childrenOf.get(id) || [])
      .slice()
      .sort((a, b) => (a.code || "").localeCompare(b.code || "", "pt-BR"));

    children.forEach((child, i) => {
      const isLast = i === children.length - 1;
      rows.push({
        cc: child,
        depth,
        hasChildren: (tree.childrenOf.get(child.id) || []).length > 0,
        isLast,
        guides,
        posInSet: i + 1,
        setSize: children.length,
      });
      walk(child.id, depth + 1, [...guides, !isLast]);
    });
  };

  walk(tree.rootId, 0, []);
  return rows;
}

const INDENT = 22;

/**
 * Guias de hierarquia. Com 22 linhas em três níveis, a indentação sozinha não
 * diz de quem cada folha descende — mas o cotovelo completo de um file tree
 * pesa demais numa tabela financeira. Só as verticais, bem claras.
 */
function TreeGuides({ row }: { row: Row }) {
  if (row.depth === 0) return null;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-4"
      style={{ width: row.depth * INDENT }}
    >
      {row.guides.map(
        (continues, i) =>
          continues && (
            <span
              key={i}
              className="absolute inset-y-0 w-px bg-border"
              style={{ left: i * INDENT + 11 }}
            />
          ),
      )}
      <span
        className="absolute top-0 w-px bg-border"
        style={{
          left: (row.depth - 1) * INDENT + 11,
          height: row.isLast ? "50%" : "100%",
        }}
      />
      <span
        className="absolute h-px w-2 bg-border"
        style={{ left: (row.depth - 1) * INDENT + 11, top: "50%" }}
      />
    </span>
  );
}

// Não há barra de utilização, e a ausência é deliberada. Percentual de folga
// não mede aperto: 15% de um envelope de R$ 4 milhões são R$ 600 mil, enquanto
// 15% de R$ 2 mil são R$ 300. O percentual aparece em texto, como informação;
// o aperto que decide é binário — disponível zerado ou negativo — e vem escrito
// ao lado do número, não só na cor. A exceção é a alçada: ali o percentual
// decide quem aprova, então ele vem marcado em texto quando passa do limite.

/**
 * Cabeçalho com definição. Clique (não hover) para funcionar no toque e no
 * teclado; o texto explica a coluna em termos de quem fecha o mês.
 */
function ColumnHelp({
  label,
  align = "end",
  children,
}: {
  label: string;
  align?: "start" | "end";
  children: ReactNode;
}) {
  return (
    <div
      role="columnheader"
      className={align === "end" ? "text-right" : "text-left"}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-sm underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-72 text-left text-sm font-normal normal-case tracking-normal text-foreground"
        >
          {children}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RowActions({
  cc,
  isRoot,
  onEdit,
  onArchive,
  onDelete,
}: {
  cc: CostCenter;
  isRoot: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          aria-label={`Ações de ${cc.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Editar
        </DropdownMenuItem>
        {!isRoot && (
          <DropdownMenuItem onSelect={onArchive}>
            {cc.archived ? (
              <>
                <ArchiveRestore className="mr-2 h-4 w-4" /> Desarquivar
              </>
            ) : (
              <>
                <Archive className="mr-2 h-4 w-4" /> Arquivar
              </>
            )}
          </DropdownMenuItem>
        )}
        {!isRoot && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Nome no aviso de "sem folga", já com o remédio. Quem distribui ajusta o
 * envelope ali mesmo (só no desktop, onde a distribuição existe); os demais
 * vão ao detalhe, onde pedem suplementação.
 */
function FixLink({
  cc,
  canAdjust,
  onAdjust,
}: {
  cc: CostCenter;
  canAdjust: boolean;
  onAdjust: (id: string) => void;
}) {
  const linkClass =
    "font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
  const detail = (
    <Link href={`/centros-custo/${cc.id}`} className={linkClass}>
      {cc.name}
    </Link>
  );
  if (!canAdjust) return detail;
  return (
    <>
      <span className="md:hidden">{detail}</span>
      <button
        type="button"
        onClick={() => onAdjust(cc.id)}
        className={`hidden md:inline ${linkClass}`}
        aria-label={`Ajustar envelope de ${cc.name}`}
      >
        {cc.name}
      </button>
    </>
  );
}

/**
 * Pedidos de suplementação abertos. Fica no topo da árvore porque decidir um
 * pedido é distribuir recurso: o gestor vê o saldo do pai na mesma tela.
 */
function PendingRequests({
  requests,
  nameOf,
  sourceOf,
  onDecided,
}: {
  requests: BudgetRequest[];
  nameOf: (id: string) => string;
  /** De onde o dinheiro sai ao aprovar: o pai e o que ele tem a distribuir. */
  sourceOf: (req: BudgetRequest) => { name: string; available: number } | null;
  onDecided: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<BudgetRequest | null>(null);
  const [note, setNote] = useState("");

  const decide = async (req: BudgetRequest, approve: boolean, msg?: string) => {
    setBusyId(req.id);
    try {
      await budgetRequestService.decide(req.id, approve, msg);
      toast.success(
        approve
          ? `${formatCurrency(req.amount)} somados ao envelope de ${nameOf(req.costCenterId)}.`
          : "Pedido recusado.",
      );
      onDecided();
    } catch (error) {
      toast.error(friendlyError(error, "Não foi possível decidir o pedido."));
      throw error;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-labelledby="pedidos-title"
      className="rounded-lg border border-amber-500/40 bg-amber-500/5"
    >
      <h2
        id="pedidos-title"
        className="border-b border-amber-500/20 px-4 py-2.5 text-sm font-medium"
      >
        {requests.length === 1
          ? "1 pedido de suplementação"
          : `${requests.length} pedidos de suplementação`}
      </h2>
      <ul className="divide-y divide-amber-500/15">
        {requests.map((req) => {
          const source = sourceOf(req);
          // Só sabemos o saldo do exercício em tela; de outro ano, o servidor
          // confere na aprovação.
          const short = !!source && source.available + 0.005 < req.amount;
          return (
            <li
              key={req.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 text-sm">
                <p>
                  <span className="font-financial font-semibold tabular-nums">
                    {formatCurrency(req.amount)}
                  </span>{" "}
                  para{" "}
                  <Link
                    href={`/centros-custo/${req.costCenterId}`}
                    className="font-medium hover:underline"
                  >
                    {nameOf(req.costCenterId)}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    · {req.requestedByName} · exercício {req.year}
                  </span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{req.reason}</p>
                {source && (
                  <p
                    id={`pedido-origem-${req.id}`}
                    className={`mt-1 text-xs ${short ? "font-medium text-destructive" : "text-muted-foreground"}`}
                  >
                    {short
                      ? `${source.name} tem só ${formatCurrency(source.available)} a distribuir. Distribua recurso para ${source.name} antes de aprovar.`
                      : `Sai de ${source.name}, que tem ${formatCurrency(source.available)} a distribuir.`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => {
                    setNote("");
                    setRejecting(req);
                  }}
                >
                  Recusar
                </Button>
                <Button
                  size="sm"
                  loading={busyId === req.id}
                  disabled={busyId !== null || short}
                  aria-describedby={
                    source ? `pedido-origem-${req.id}` : undefined
                  }
                  onClick={() => decide(req, true).catch(() => {})}
                >
                  Aprovar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="Recusar pedido"
        description="Quem pediu recebe o motivo como notificação."
        confirmText="Recusar pedido"
        variant="destructive"
        confirmDisabled={!note.trim()}
        onConfirm={() => decide(rejecting!, false, note.trim())}
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Motivo da recusa"
          aria-label="Motivo da recusa"
        />
      </ConfirmDialog>
    </section>
  );
}

/**
 * Centros de custo: uma árvore só para ler e distribuir. Lê por padrão; o
 * modo distribuição troca o envelope por um campo editável e projeta o saldo
 * do pai enquanto o gestor digita.
 */
export function CostCentersScreen({
  initialEditing = false,
}: {
  initialEditing?: boolean;
}) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canManageCostCenters, onlyOwnPayables } = usePermissions();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id;

  const [year, setYear] = useState(new Date().getFullYear());
  const [editing, setEditing] = useState(initialEditing);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  /** Exercício escolhido com rascunhos na mesa: espera confirmar o descarte. */
  const [pendingYear, setPendingYear] = useState<number | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formTarget, setFormTarget] = useState<CostCenter | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CostCenter | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CostCenter | null>(null);

  // A árvore precisa de todos os centros para fechar no raiz, inclusive para
  // o papel `user`: as rules deixam ler, e o recorte dele é feito na exibição.
  const centersQuery = useCostCenters(companyId);
  const costCenters = centersQuery.costCenters;
  const balancesQuery = useCostCenterBalances(companyId, costCenters, year);
  const balances = balancesQuery.data;

  const requestsQuery = useQuery({
    queryKey: ["budget-requests", companyId, "pending"],
    queryFn: () => budgetRequestService.getPending(companyId!),
    enabled: !!companyId && canManageCostCenters,
  });
  const pendingRequests = requestsQuery.data ?? [];

  const tree = useMemo(() => {
    if (costCenters.length === 0) return null;
    try {
      return buildCostCenterTree(costCenters);
    } catch {
      return null;
    }
  }, [costCenters]);

  const rows = useMemo(() => (tree ? flatten(tree) : []), [tree]);

  /**
   * Recalcula a árvore com os rascunhos aplicados. É o que faz o saldo do pai
   * responder enquanto o gestor digita, antes de qualquer gravação.
   */
  const projected = useMemo(() => {
    if (!tree || !balances) return {};

    const envelopeOf = (id: string) =>
      drafts[id] ?? balances[id]?.received ?? 0;

    const result: Record<
      string,
      { received: number; allocated: number; available: number }
    > = {};

    for (const cc of costCenters) {
      const base = balances[cc.id];
      if (!base) continue;
      const isRoot = cc.id === tree.rootId;
      const children = tree.childrenOf.get(cc.id) || [];
      const allocated = children.reduce(
        (acc, child) => add(acc, envelopeOf(child.id)),
        0,
      );
      const received = isRoot
        ? add(base.received, base.carryIn)
        : envelopeOf(cc.id);

      result[cc.id] = {
        received,
        allocated,
        available: subtract(received, allocated, base.spentDirect),
      };
    }
    return result;
  }, [costCenters, balances, drafts, tree]);

  /**
   * Linhas a mostrar: a busca e o recorte do `user` mostram o que casa mais os
   * ancestrais, para a linha não aparecer solta da hierarquia.
   */
  const shown = useMemo(() => {
    if (!tree) return null;
    const term = fold(search.trim());
    const allowed = (cc: CostCenter) =>
      !onlyOwnPayables || !!(user && cc.allowedUserIds?.includes(user.uid));
    const matches = (cc: CostCenter) =>
      !term || fold(`${cc.name} ${cc.code}`).includes(term);

    if (!term && !onlyOwnPayables) return null;
    const set = new Set<string>();
    for (const cc of costCenters) {
      if (!allowed(cc) || !matches(cc)) continue;
      set.add(cc.id);
      tree.ancestorsOf(cc.id).forEach((id) => set.add(id));
    }
    return set;
  }, [tree, search, onlyOwnPayables, user, costCenters]);

  const hidden = useMemo(() => {
    const set = new Set<string>();
    // Na busca tudo que casa fica à vista, mesmo dentro de ramo recolhido.
    if (!tree || search.trim()) return set;
    const hide = (id: string) => {
      for (const child of tree.childrenOf.get(id) || []) {
        set.add(child.id);
        hide(child.id);
      }
    };
    collapsed.forEach(hide);
    return set;
  }, [collapsed, tree, search]);

  const visibleRows = rows.filter(
    (row) => !hidden.has(row.cc.id) && (!shown || shown.has(row.cc.id)),
  );

  const changed = useMemo(
    () =>
      Object.entries(drafts).filter(
        ([id, value]) =>
          Math.abs(subtract(value, balances?.[id]?.received ?? 0)) > 0.005,
      ),
    [drafts, balances],
  );

  const overdrawn = useMemo(
    () =>
      costCenters.filter((cc) => isNegative(projected[cc.id]?.available ?? 0)),
    [costCenters, projected],
  );

  /** Centros sem nenhuma folga: o que a distribuição existe para resolver. */
  const tight = useMemo(
    () =>
      rows.filter(
        (row) =>
          !row.hasChildren && isZero(projected[row.cc.id]?.available ?? -1),
      ),
    [rows, projected],
  );

  /**
   * Folhas com folga mas acima da alçada: despesa nova ali só é aprovada pelo
   * gestor financeiro ou pelo administrador. Sem folga já é aviso próprio.
   */
  const overAlcada = useMemo(
    () =>
      rows.filter((row) => {
        const proj = projected[row.cc.id];
        const base = balances?.[row.cc.id];
        if (row.hasChildren || !proj || !base || proj.available <= 0.005)
          return false;
        return (
          committedOf({
            received: proj.received,
            carryIn: 0,
            allocatedToChildren: proj.allocated,
            spentDirect: base.spentDirect,
          }).ratio >= ALCADA_RATIO
        );
      }),
    [rows, projected, balances],
  );

  // Rascunho de distribuição é trabalho: fechar a aba não pode apagá-lo calado.
  // ponytail: cobre recarregar e fechar a aba; a navegação interna do Next não
  // dispara beforeunload — interceptar exigiria embrulhar o router.
  const hasDrafts = changed.length > 0;
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const parents = rows.filter((r) => r.hasChildren).map((r) => r.cc.id);
  const allCollapsed = parents.length > 0 && collapsed.size >= parents.length;

  /**
   * Setas no teclado: ↑/↓ andam entre as linhas, → abre e ← fecha o ramo.
   * O foco fica no link do nome, que continua abrindo o detalhe com Enter.
   */
  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const rowId = target.dataset.rowId;
    if (!rowId) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const links = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>("[data-row-id]"),
      );
      const i = links.indexOf(target);
      links[i + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const row = rows.find((r) => r.cc.id === rowId);
      const open = e.key === "ArrowRight";
      if (row?.hasChildren && collapsed.has(rowId) === open) {
        toggle(rowId);
        e.preventDefault();
      }
    }
  };

  const nameOf = (id: string) =>
    costCenters.find((cc) => cc.id === id)?.name || "centro de custo";

  const refreshBalances = () =>
    queryClient.invalidateQueries({ queryKey: ["cost-center-balances"] });

  const canApply = changed.length > 0 && overdrawn.length === 0 && !isSaving;

  /**
   * Um commit só no servidor: ou a distribuição inteira desce, ou nada muda e
   * os rascunhos ficam na mesa para corrigir.
   */
  const apply = async () => {
    if (!selectedCompany || !canApply) return;
    setIsSaving(true);
    try {
      const { changed: count } = await costCenterLedgerService.setEnvelopes(
        selectedCompany.id,
        year,
        changed.map(([costCenterId, amount]) => ({ costCenterId, amount })),
      );
      toast.success(
        count === 1
          ? "Envelope atualizado."
          : `${count} envelopes atualizados.`,
      );
      setDrafts({});
      setEditing(false);
    } catch (error) {
      toast.error("Nenhum envelope foi alterado.", {
        description: friendlyError(
          error,
          "Não foi possível aplicar a distribuição. Tente de novo.",
        ),
      });
    } finally {
      setIsSaving(false);
      await refreshBalances();
    }
  };

  const changeYear = (y: number) => {
    if (y === year) return;
    if (hasDrafts) {
      setPendingYear(y);
      return;
    }
    setDrafts({});
    setYear(y);
  };

  /**
   * "Ajustar envelope" do aviso: entra na distribuição com o campo daquele
   * centro já em foco, abrindo os ramos que o escondiam.
   */
  const adjustEnvelope = (id: string) => {
    setEditing(true);
    setSearch("");
    const ancestors = tree?.ancestorsOf(id) ?? [];
    setCollapsed((prev) => {
      const next = new Set(prev);
      ancestors.forEach((a) => next.delete(a));
      return next;
    });
    // Depois do commit do React, quando o campo já existe.
    setTimeout(() => {
      const el = document.getElementById(
        `envelope-${id}`,
      ) as HTMLInputElement | null;
      el?.scrollIntoView({ block: "center" });
      el?.focus();
      el?.select();
    }, 0);
  };

  const revertDraft = (id: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  /** Ctrl/⌘+Enter aplica de qualquer campo da distribuição. */
  const onScreenKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const fromEnvelope = (e.target as HTMLElement).id?.startsWith("envelope-");
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      fromEnvelope &&
      canApply
    ) {
      e.preventDefault();
      apply();
    }
  };

  const openForm = (cc: CostCenter | null) => {
    setFormTarget(cc);
    setFormOpen(true);
  };

  const handleArchive = async () => {
    const cc = archiveTarget!;
    try {
      await costCenterService.update(cc.id, {
        ...toFormData(cc),
        archived: !cc.archived,
      });
      await queryClient.invalidateQueries({ queryKey: ["cost-centers"] });
      toast.success(
        cc.archived ? `${cc.name} desarquivado.` : `${cc.name} arquivado.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível arquivar.",
      );
      throw error;
    }
  };

  const handleDelete = async () => {
    const cc = deleteTarget!;
    try {
      await costCenterService.delete(cc.id);
      await queryClient.invalidateQueries({ queryKey: ["cost-centers"] });
      toast.success(`${cc.name} excluído.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível excluir.",
      );
      throw error;
    }
  };

  const dialogs = (
    <>
      <CostCenterFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={formTarget}
        costCenters={costCenters}
      />
      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={
          archiveTarget?.archived
            ? `Desarquivar ${archiveTarget?.name}`
            : `Arquivar ${archiveTarget?.name}`
        }
        description={
          archiveTarget?.archived
            ? "Ele volta aos formulários de despesa nova."
            : "Ele sai dos formulários de despesa nova. As contas já lançadas seguem podendo ser aprovadas, pagas e editadas, e o centro ainda pode receber envelope."
        }
        confirmText={archiveTarget?.archived ? "Desarquivar" : "Arquivar"}
        onConfirm={handleArchive}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Excluir ${deleteTarget?.name}`}
        description="Só é possível excluir um centro sem filhos, lançamentos, envelope ou recorrências. Com histórico, arquive em vez de excluir. A exclusão não pode ser desfeita."
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={pendingYear !== null}
        onOpenChange={(open) => !open && setPendingYear(null)}
        title={`Trocar para o exercício ${pendingYear}`}
        description={
          changed.length === 1
            ? `A alteração de envelope em ${year} ainda não foi aplicada e será descartada.`
            : `As ${changed.length} alterações de envelope em ${year} ainda não foram aplicadas e serão descartadas.`
        }
        confirmText="Descartar e trocar"
        variant="destructive"
        onConfirm={() => {
          setDrafts({});
          setYear(pendingYear!);
          setPendingYear(null);
        }}
      />
    </>
  );

  // ── Carregamento, erro e vazio ────────────────────────────────────────────

  const isLoading =
    centersQuery.isLoading ||
    (costCenters.length > 0 && balancesQuery.isLoading);

  if (isLoading) {
    return (
      <div className="space-y-6" role="status">
        <span className="sr-only">Carregando centros de custo…</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="space-y-2 pt-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!centersQuery.isError && costCenters.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight">Centros de Custo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Comece pelo centro raiz. Ele recebe todas as receitas da empresa, e
          dele o recurso desce para os demais centros em envelopes anuais.
        </p>
        {canManageCostCenters && (
          <Button className="mt-6" onClick={() => openForm(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Criar centro raiz
          </Button>
        )}
        {dialogs}
      </div>
    );
  }

  const queryError = centersQuery.error || balancesQuery.error;
  // Erro do Firestore traz detalhe de implementação; o operador só precisa
  // saber o que falhou e que pode tentar de novo.
  const loadError = queryError
    ? "Não foi possível carregar os saldos. Verifique a conexão e tente de novo."
    : null;

  if (loadError || !tree || !balances) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Não foi possível montar a hierarquia</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError ||
                "A árvore exige exatamente um centro de custo raiz, do qual todos os outros descendem."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                centersQuery.refetch();
                balancesQuery.refetch();
              }}
            >
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const rootCc = tree.byId.get(tree.rootId)!;
  const rootBase = balances[tree.rootId];
  const rootProj = projected[tree.rootId];

  const totalCash = rootProj?.received ?? 0;
  const distributed = rootProj?.allocated ?? 0;
  const free = rootProj?.available ?? 0;
  const years = Array.from(
    { length: 5 },
    (_, i) => new Date().getFullYear() - 2 + i,
  );

  return (
    <div className="w-full space-y-6 pb-4" onKeyDown={onScreenKeyDown}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Centros de Custo
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todo recurso desce de {rootCc.name}. Um centro de custo só gasta o
            que recebeu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(year)}
            onValueChange={(v) => changeYear(Number(v))}
            disabled={isSaving}
          >
            <SelectTrigger className="w-[150px]" aria-label="Exercício">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  Exercício {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManageCostCenters && (
            <>
              <Button
                variant={editing ? "secondary" : "outline"}
                className="hidden md:inline-flex"
                aria-pressed={editing}
                disabled={isSaving || hasDrafts}
                aria-describedby={editing ? "distribuicao-dica" : undefined}
                onClick={() => {
                  setDrafts({});
                  setEditing((v) => !v);
                }}
              >
                <Wallet className="mr-2 h-4 w-4" />
                {editing ? "Concluir distribuição" : "Distribuir recursos"}
              </Button>
              <Button onClick={() => openForm(null)}>
                <Plus className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Novo centro de custo</span>
                <span className="sm:hidden">Novo</span>
              </Button>
            </>
          )}
        </div>
      </header>

      {/*
        O raiz não é uma linha da tabela: ele é o caixa de onde tudo desce, e
        nunca se edita o envelope dele. Tratá-lo como cabeçalho resolve a
        hierarquia e elimina a linha com o campo de envelope vazio.
      */}
      {/* Número em tom neutro: dinheiro parado em {rootCc.name} não é bom nem
          ruim. Cor só quando negativo, que é o único estado que exige ação. */}
      <section className="rounded-lg border bg-card px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-sm text-muted-foreground">
              A distribuir em {rootCc.name}
            </p>
            <p
              className={`font-financial mt-0.5 text-2xl font-semibold tabular-nums ${
                isNegative(free) ? "text-destructive" : "text-foreground"
              }`}
            >
              {formatCurrency(free)}
            </p>
          </div>

          <div className="flex items-end gap-x-8">
            <dl className="flex gap-x-8 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Caixa do exercício
                </dt>
                <dd className="font-financial mt-0.5 tabular-nums">
                  {formatCurrency(totalCash)}
                </dd>
                {rootBase?.carryIn > 0 && (
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    inclui {formatCurrency(rootBase.carryIn)} do ano anterior
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Distribuído</dt>
                <dd className="font-financial mt-0.5 tabular-nums">
                  {formatCurrency(distributed)}
                </dd>
              </div>
            </dl>
            {canManageCostCenters && (
              <RowActions
                cc={rootCc}
                isRoot
                onEdit={() => openForm(rootCc)}
                onArchive={() => {}}
                onDelete={() => {}}
              />
            )}
          </div>
        </div>

        {(tight.length > 0 || overAlcada.length > 0) && (
          <ul className="mt-5 space-y-2 border-t pt-4 text-sm text-muted-foreground">
            {tight.length > 0 && (
              <li className="flex items-start gap-2">
                <TriangleAlert
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                />
                <span>
                  {tight.length === 1
                    ? "Sem folga, não aceita novas despesas: "
                    : "Sem folga, não aceitam novas despesas: "}
                  {tight.map((row, i) => (
                    <span key={row.cc.id}>
                      {i > 0 && ", "}
                      <FixLink
                        cc={row.cc}
                        canAdjust={canManageCostCenters}
                        onAdjust={adjustEnvelope}
                      />
                    </span>
                  ))}
                  .
                </span>
              </li>
            )}
            {overAlcada.length > 0 && (
              <li className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-semibold text-foreground/70"
                >
                  %
                </span>
                <span>
                  {overAlcada.length === 1
                    ? `${overAlcada[0].cc.name} passou de ${ALCADA_RATIO * 100}% do envelope`
                    : `${overAlcada.length} centros de custo passaram de ${ALCADA_RATIO * 100}% do envelope`}
                  : despesa nova{overAlcada.length === 1 ? " nele" : " neles"}{" "}
                  só é aprovada pelo gestor financeiro ou pelo administrador.
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      {canManageCostCenters && pendingRequests.length > 0 && (
        <PendingRequests
          requests={pendingRequests}
          nameOf={nameOf}
          sourceOf={(req) => {
            if (req.year !== year) return null;
            const parentId = parentOf(tree.byId.get(req.costCenterId));
            const parentBase = parentId ? balances[parentId] : undefined;
            return parentId && parentBase
              ? { name: nameOf(parentId), available: parentBase.available }
              : null;
          }}
          onDecided={() => {
            queryClient.invalidateQueries({ queryKey: ["budget-requests"] });
            refreshBalances();
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou código"
            aria-label="Buscar centro de custo"
            className="pl-8"
          />
        </div>
        {parents.length > 0 && !search.trim() && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() =>
              setCollapsed(allCollapsed ? new Set() : new Set(parents))
            }
          >
            {allCollapsed ? (
              <ChevronsUpDown className="mr-2 h-4 w-4" />
            ) : (
              <ChevronsDownUp className="mr-2 h-4 w-4" />
            )}
            {allCollapsed ? "Expandir tudo" : "Recolher tudo"}
          </Button>
        )}
        {editing && (
          <p
            id="distribuicao-dica"
            className="hidden text-sm text-muted-foreground md:block"
          >
            {hasDrafts
              ? "Aplique ou descarte as alterações para concluir a distribuição."
              : "Edite os envelopes; o saldo de cada pai se ajusta enquanto você digita. Esc desfaz o campo."}
          </p>
        )}
      </div>

      {/* ── Árvore: desktop ─────────────────────────────────────────────── */}
      <div
        className="hidden md:block"
        role="treegrid"
        aria-label={`Centros de custo, exercício ${year}`}
        aria-readonly={!editing}
      >
        <div role="rowgroup">
          <div
            role="row"
            className={`${GRID} border-b px-4 pb-2 text-xs font-medium text-muted-foreground`}
          >
            <div role="columnheader">Centro de custo</div>
            <ColumnHelp label="Envelope">
              Quanto o centro recebeu do pai para o exercício. É o teto: o
              centro só distribui ou gasta até esse valor.
            </ColumnHelp>
            <ColumnHelp label="Saída">
              <p>
                Nos centros com filhos, o que já foi distribuído a eles. Nas
                folhas, as despesas lançadas no exercício, de rascunho a pago:
                toda despesa reserva o envelope desde o rascunho.
              </p>
              <p className="mt-2 text-muted-foreground">
                Abaixo do valor, quanto disso já foi pago.
              </p>
            </ColumnHelp>
            <ColumnHelp label="% usado">
              <p>
                Saída sobre envelope, só nas folhas. Nos centros com filhos o
                percentual mediria distribuição, não consumo, e por isso não
                aparece.
              </p>
              <p className="mt-2 text-muted-foreground">
                Acima de {ALCADA_RATIO * 100}%, despesa nova só é aprovada pelo
                gestor financeiro ou pelo administrador.
              </p>
            </ColumnHelp>
            <ColumnHelp label="Disponível">
              Envelope menos saída. Nas folhas, o que ainda pode ser gasto; nos
              centros com filhos, o que ainda pode ser distribuído.
            </ColumnHelp>
            <div role="columnheader">
              <span className="sr-only">Ações</span>
            </div>
          </div>
        </div>

        {visibleRows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum centro de custo encontrado para “{search}”.
          </p>
        )}

        <div
          role="rowgroup"
          className="divide-y divide-border/60"
          onKeyDown={onTreeKeyDown}
        >
          {visibleRows.map((row) => {
            const base = balances[row.cc.id];
            const proj = projected[row.cc.id];
            if (!base || !proj) return null;

            const isCollapsed = collapsed.has(row.cc.id) && !search.trim();
            const draft = drafts[row.cc.id];
            const isChanged =
              draft !== undefined &&
              Math.abs(subtract(draft, base.received)) > 0.005;
            const negative = isNegative(proj.available);
            const noSlack = !row.hasChildren && isZero(proj.available);
            const { ratio } = committedOf({
              received: proj.received,
              carryIn: 0,
              allocatedToChildren: proj.allocated,
              spentDirect: base.spentDirect,
            });
            const isLeaf = !row.hasChildren;
            const outflow = add(proj.allocated, base.spentDirect);
            const aboveAlcada =
              isLeaf && !negative && !noSlack && ratio >= ALCADA_RATIO;

            return (
              <div
                key={row.cc.id}
                role="row"
                aria-level={row.depth + 1}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-expanded={row.hasChildren ? !isCollapsed : undefined}
                className={`${GRID} relative px-4 transition-colors ${
                  row.depth === 0 ? "border-t border-foreground/15" : ""
                } ${
                  negative
                    ? "bg-destructive/6"
                    : isChanged
                      ? "bg-primary/8"
                      : "hover:bg-muted/50"
                }`}
                style={{ minHeight: "3rem" }}
              >
                {/* As guias vivem na linha, não na célula: presas à célula
                    elas paravam no fim do conteúdo e ficavam picotadas. */}
                <TreeGuides row={row} />

                <div
                  role="gridcell"
                  className="flex min-w-0 items-center gap-2 py-2"
                  style={{ paddingLeft: `${row.depth * INDENT}px` }}
                >
                  {row.hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggle(row.cc.id)}
                      className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={!isCollapsed}
                      aria-label={
                        isCollapsed
                          ? `Expandir ${row.cc.name}`
                          : `Recolher ${row.cc.name}`
                      }
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
                          isCollapsed ? "" : "rotate-90"
                        }`}
                      />
                    </button>
                  ) : (
                    <span className="-ml-1 w-6 shrink-0" />
                  )}

                  <Link
                    href={`/centros-custo/${row.cc.id}`}
                    data-row-id={row.cc.id}
                    className={`truncate rounded-sm text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      row.depth === 0 ? "font-semibold" : "font-normal"
                    } ${row.cc.archived ? "text-muted-foreground" : ""}`}
                  >
                    {row.cc.name}
                  </Link>
                  <span
                    className="shrink-0 font-mono text-xs text-muted-foreground"
                    title={row.cc.code}
                  >
                    {shortCode(row.cc.code)}
                  </span>
                  {row.cc.archived && (
                    <Badge
                      variant="secondary"
                      className="h-4 shrink-0 px-1 py-0 text-[10px]"
                    >
                      Arquivado
                    </Badge>
                  )}
                </div>

                {/* Envelope. Alterado, o valor original fica escrito embaixo:
                    a marca não depende só da cor, e ninguém precisa lembrar
                    de quanto partiu. */}
                <div
                  role="gridcell"
                  className="flex flex-col items-end justify-center py-2"
                >
                  {editing ? (
                    <CurrencyInput
                      id={`envelope-${row.cc.id}`}
                      value={draft ?? base.received}
                      onChange={(v) =>
                        setDrafts((prev) => ({ ...prev, [row.cc.id]: v }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && draft !== undefined) {
                          e.preventDefault();
                          revertDraft(row.cc.id);
                        }
                      }}
                      disabled={isSaving}
                      aria-label={`Envelope de ${row.cc.name}`}
                      aria-describedby={
                        isChanged ? `envelope-era-${row.cc.id}` : undefined
                      }
                      className={`font-financial h-8 rounded-md bg-background px-2 text-right text-sm tabular-nums transition-colors ${
                        isChanged
                          ? "border-primary ring-1 ring-primary/30"
                          : "border-input"
                      }`}
                    />
                  ) : (
                    <span className="font-financial text-sm tabular-nums">
                      {formatCurrency(base.received)}
                    </span>
                  )}
                  {isChanged && (
                    <span
                      id={`envelope-era-${row.cc.id}`}
                      className="font-financial mt-0.5 text-xs tabular-nums text-muted-foreground"
                    >
                      era {formatCurrency(base.received)}
                    </span>
                  )}
                </div>

                {/* Saída: distribuição nos pais, despesa nas folhas. Um nó
                    só tem uma das duas, então são uma coluna; zero aparece
                    como zero, e vazio fica para "não se aplica". */}
                <div
                  role="gridcell"
                  className="flex flex-col items-end justify-center py-2"
                >
                  <span className="font-financial text-sm tabular-nums text-muted-foreground">
                    {formatCurrency(outflow)}
                  </span>
                  {row.hasChildren ? (
                    <span className="text-xs text-muted-foreground">
                      aos filhos
                    </span>
                  ) : (
                    base.spentDirect > 0 && (
                      <span className="font-financial text-xs tabular-nums text-muted-foreground">
                        {formatCurrency(base.spentDirectPaid)} pago
                      </span>
                    )
                  )}
                </div>

                <div
                  role="gridcell"
                  className="flex flex-col items-end justify-center py-2"
                >
                  {isLeaf && (
                    <span className="font-financial text-sm tabular-nums text-muted-foreground">
                      {formatPercent(ratio)}
                    </span>
                  )}
                  {aboveAlcada && (
                    <span className="text-xs text-foreground/80">
                      acima da alçada
                    </span>
                  )}
                </div>

                {/* Disponível: o dado que dirige a decisão. Peso só nas
                    exceções, e o estado vem escrito, não só na cor. Nos pais
                    é dinheiro a distribuir, não a gastar, e diz isso. */}
                <div
                  role="gridcell"
                  className="flex flex-col items-end justify-center py-2"
                >
                  <span
                    className={`font-financial text-sm tabular-nums ${
                      negative
                        ? "font-semibold text-destructive"
                        : noSlack
                          ? "font-semibold text-amber-800 dark:text-amber-400"
                          : row.hasChildren
                            ? "text-muted-foreground"
                            : "text-foreground"
                    }`}
                  >
                    {formatCurrency(proj.available)}
                  </span>
                  {negative || noSlack ? (
                    <span
                      className={`text-xs ${negative ? "text-destructive" : "text-amber-800 dark:text-amber-400"}`}
                    >
                      {negative ? "estourado" : "sem folga"}
                    </span>
                  ) : (
                    row.hasChildren && (
                      <span className="text-xs text-muted-foreground">
                        a distribuir
                      </span>
                    )
                  )}
                </div>

                <div role="gridcell" className="flex justify-end">
                  {canManageCostCenters && (
                    <RowActions
                      cc={row.cc}
                      isRoot={false}
                      onEdit={() => openForm(row.cc)}
                      onArchive={() => setArchiveTarget(row.cc)}
                      onDelete={() => setDeleteTarget(row.cc)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Leitura: mobile ─────────────────────────────────────────────── */}
      <div className="md:hidden">
        <div className="divide-y divide-border/60 border-y">
          {visibleRows.map((row) => {
            const proj = projected[row.cc.id];
            if (!proj) return null;
            const negative = isNegative(proj.available);
            const noSlack = !row.hasChildren && isZero(proj.available);
            return (
              <Link
                key={row.cc.id}
                href={`/centros-custo/${row.cc.id}`}
                className="block py-3 pr-1"
                style={{ paddingLeft: `${row.depth * 14}px` }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`truncate text-sm ${row.depth === 0 ? "font-semibold" : ""} ${row.cc.archived ? "text-muted-foreground" : ""}`}
                  >
                    {row.cc.name}
                  </span>
                  <span
                    className={`font-financial shrink-0 text-sm font-medium tabular-nums ${
                      negative
                        ? "text-destructive"
                        : noSlack
                          ? "text-amber-800 dark:text-amber-400"
                          : ""
                    }`}
                  >
                    {formatCurrency(proj.available)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {negative
                    ? "estourado · "
                    : noSlack
                      ? "sem folga · "
                      : row.hasChildren
                        ? "a distribuir · "
                        : ""}
                  de {formatCurrency(proj.received)} recebidos
                </p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Barra de commit ─────────────────────────────────────────────── */}
      {hasDrafts && (
        <div
          className="sticky bottom-4 z-10 rounded-lg border bg-card px-4 py-3 shadow-lg"
          role="region"
          aria-label="Distribuição pendente"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0" aria-live="polite">
              {overdrawn.length > 0 ? (
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
                  {overdrawn.length === 1
                    ? `${overdrawn[0].name} ficaria com ${formatCurrency(projected[overdrawn[0].id].available)}`
                    : `${overdrawn.length} centros de custo ficariam negativos`}
                </p>
              ) : (
                <p className="text-sm font-medium">
                  {changed.length === 1
                    ? "1 envelope alterado"
                    : `${changed.length} envelopes alterados`}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {overdrawn.length > 0
                  ? "Reduza a alocação ou aumente o envelope do centro de custo pai."
                  : `A distribuir em ${rootCc.name} após aplicar: ${formatCurrency(free)}. Tudo é gravado junto, ou nada.`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrafts({})}
                disabled={isSaving}
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Descartar
              </Button>
              <Button
                size="sm"
                onClick={apply}
                disabled={!canApply}
                loading={isSaving}
                aria-keyshortcuts="Control+Enter"
              >
                Aplicar distribuição
                <kbd className="ml-2 hidden rounded border border-primary-foreground/30 px-1 font-sans text-[11px] opacity-80 lg:inline">
                  Ctrl ↵
                </kbd>
              </Button>
            </div>
          </div>

          {/* De/para antes de gravar: quem confere a distribuição vê o que
              muda sem sair da barra. */}
          <details className="group mt-2 border-t pt-2">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              Ver alterações
            </summary>
            <table className="mt-2 w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Centro de custo</th>
                  <th>Era</th>
                  <th>Fica</th>
                  <th>Diferença</th>
                </tr>
              </thead>
              <tbody>
                {changed.map(([id, value]) => {
                  const was = balances[id]?.received ?? 0;
                  const diff = subtract(value, was);
                  return (
                    <tr key={id}>
                      <td className="py-0.5 pr-4">{nameOf(id)}</td>
                      <td className="font-financial py-0.5 pr-4 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(was)}
                      </td>
                      <td className="font-financial py-0.5 pr-4 text-right tabular-nums">
                        {formatCurrency(value)}
                      </td>
                      <td className="font-financial py-0.5 text-right tabular-nums text-muted-foreground">
                        {diff > 0 ? "+" : ""}
                        {formatCurrency(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        </div>
      )}

      {dialogs}
    </div>
  );
}
