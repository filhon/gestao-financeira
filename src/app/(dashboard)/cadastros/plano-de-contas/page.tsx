"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  Download,
  FilePlus2,
  ListTree,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { chartOfAccountsService } from "@/lib/services/chartOfAccountsService";
import { recurrenceService } from "@/lib/services/recurrenceService";
import { AccountForm } from "@/components/features/chart-of-accounts/AccountForm";
import { ImportChartDialog } from "@/components/features/chart-of-accounts/ImportChartDialog";
import { CHART_MODELS, ChartModelKey } from "@/lib/chartOfAccountsModels";
import {
  ACCOUNT_NATURE_LABEL,
  AccountDraft,
  depthOf,
  DRE_GROUP_LABEL,
  groupResolver,
  parentCodeOf,
  withLevels,
} from "@/lib/chartOfAccounts";
import { AccountNature, ChartAccount } from "@/lib/types";
import { cn, normalizeText } from "@/lib/utils";

type NatureFilter = "all" | AccountNature;

/** Até que nível a árvore abre; `ALL` = tudo. */
const ALL = 99;
const DEPTH_OPTIONS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: ALL, label: "Tudo" },
];

const NATURE_CLASS: Record<AccountNature, string> = {
  revenue: "text-emerald-700 dark:text-emerald-400",
  expense: "text-rose-700 dark:text-rose-400",
  balance: "text-foreground/70",
};

const GRID =
  "md:grid md:grid-cols-[7.5rem_minmax(0,1.6fr)_7rem_minmax(0,1fr)] md:gap-x-4 md:items-center";

export default function ChartOfAccountsPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canManageChartOfAccounts: canManage } = usePermissions();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id;
  const {
    accounts,
    requiredFrom,
    requiredFromLoading,
    isPending,
    isError,
    isSuccess,
    refetch,
  } = useChartOfAccounts(companyId);

  const [search, setSearch] = useState("");
  const [natureFilter, setNatureFilter] = useState<NatureFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [depth, setDepth] = useState(2);
  // Contas abertas ou fechadas à mão, ao contrário do que o nível pede.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [panel, setPanel] = useState<{
    editing: ChartAccount | null;
    parentCode: string | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(
    null,
  );
  const [archiving, setArchiving] = useState<ChartAccount | null>(null);
  const [deleting, setDeleting] = useState<ChartAccount | null>(null);
  const [pendingRequired, setPendingRequired] = useState<string | null>(null);
  const [importState, setImportState] = useState<{
    model: ChartModelKey | null;
  } | null>(null);

  const actor = user ? { uid: user.uid, email: user.email } : null;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });

  // Recorrências ativas sem conta: são elas que gerariam lançamentos sem
  // classificação depois que o plano passar a ser obrigatório.
  const { data: unclassifiedRecurrences = [] } = useQuery({
    queryKey: ["recurrences-without-account", companyId],
    queryFn: async () =>
      (
        await recurrenceService.getTemplates(companyId!, { active: true })
      ).filter((t) => !t.baseTransactionData?.accountId),
    enabled: !!companyId && canManage && accounts.length > 0,
  });

  const byCode = useMemo(
    () => new Map(accounts.map((a) => [a.code, a])),
    [accounts],
  );
  const groupOf = useMemo(() => groupResolver(accounts), [accounts]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of accounts) {
      const p = parentCodeOf(a.code);
      if (p) m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  }, [accounts]);
  const descendantsOf = (a: ChartAccount) =>
    accounts.filter((d) => d.code.startsWith(`${a.code}.`)).length;

  const isCollapsed = (code: string) =>
    depthOf(code) >= depth - 1 !== toggled.has(code);

  // Busca mostra as contas encontradas e o caminho até elas; sem busca, a
  // árvore respeita o nível e o que foi aberto ou fechado à mão.
  const visible = useMemo(() => {
    const term = normalizeText(search.trim());
    const base = accounts.filter(
      (a) =>
        (showArchived || !a.archived) &&
        (natureFilter === "all" || a.nature === natureFilter),
    );
    if (term) {
      const hits = base.filter(
        (a) => a.code.includes(term) || normalizeText(a.name).includes(term),
      );
      const keep = new Set<string>();
      for (const h of hits) {
        for (let c: string | null = h.code; c; c = parentCodeOf(c)) keep.add(c);
      }
      return withLevels(base.filter((a) => keep.has(a.code)));
    }
    const collapsed = (code: string) =>
      depthOf(code) >= depth - 1 !== toggled.has(code);
    return withLevels(base).filter((a) => {
      for (let p = parentCodeOf(a.code); p; p = parentCodeOf(p)) {
        if (collapsed(p)) return false;
      }
      return true;
    });
  }, [accounts, search, natureFilter, showArchived, depth, toggled]);

  const stats = useMemo(
    () => ({
      analytic: accounts.filter((a) => a.type === "analytic" && !a.archived)
        .length,
      synthetic: accounts.filter((a) => a.type === "synthetic" && !a.archived)
        .length,
      archived: accounts.filter((a) => a.archived).length,
      hasBalance: accounts.some((a) => a.nature === "balance"),
    }),
    [accounts],
  );

  // "/" leva à busca, como nas demais listas densas.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.key !== "/" ||
        el.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (code: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Fechar ou trocar de conta com alterações não salvas pede confirmação.
  const guard = (action: () => void) =>
    isDirty ? setPendingDiscard(() => action) : action();
  const closePanel = () => {
    setIsDirty(false);
    setPanel(null);
  };
  const openPanel = (editing: ChartAccount | null, parentCode: string | null) =>
    guard(() => {
      setIsDirty(false);
      setPanel({ editing, parentCode });
    });

  const handleSubmit = async (draft: AccountDraft) => {
    if (!companyId || !actor || !panel) return;
    try {
      setIsSaving(true);
      if (panel.editing) {
        await chartOfAccountsService.update(panel.editing.id, draft, actor);
        toast.success("Conta atualizada.");
      } else {
        await chartOfAccountsService.create(draft, companyId, actor);
        toast.success("Conta criada.");
      }
      await refresh();
      closePanel();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar a conta.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const setArchived = async (account: ChartAccount, archived: boolean) => {
    if (!actor) return;
    try {
      await chartOfAccountsService.setArchived(account.id, archived, actor);
      await refresh();
      closePanel();
      toast.success(archived ? "Conta arquivada." : "Conta reativada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao arquivar a conta.",
      );
    }
  };

  const handleDelete = async () => {
    if (!deleting || !actor) return;
    try {
      await chartOfAccountsService.delete(deleting.id, actor);
      await refresh();
      closePanel();
      toast.success("Conta excluída.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao excluir a conta.",
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleRequiredFrom = async (value: string) => {
    if (!companyId || !actor) return;
    try {
      await chartOfAccountsService.setRequiredFrom(
        companyId,
        value === "optional" ? null : Number(value),
        actor,
      );
      await refresh();
      toast.success(
        value === "optional"
          ? "A conta passou a ser opcional nos lançamentos."
          : `A conta passa a ser obrigatória nos lançamentos com vencimento a partir de 01/01/${value}.`,
      );
    } catch (error) {
      console.error(error);
      toast.error("Erro ao salvar a configuração.");
    }
  };

  // Navegação da árvore pelo teclado (padrão WAI-ARIA de tree view).
  const activeCode = visible.some((a) => a.code === focused)
    ? focused
    : (visible[0]?.code ?? null);
  const focusRow = (code: string) => {
    setFocused(code);
    document.getElementById(`conta-${code}`)?.focus();
  };
  const onTreeKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = visible.findIndex((a) => a.code === activeCode);
    if (i === -1) return;
    const a = visible[i];
    const expandable = !search && (childCount.get(a.code) ?? 0) > 0;
    const at = (j: number) =>
      focusRow(visible[Math.max(0, Math.min(visible.length - 1, j))].code);
    switch (e.key) {
      case "ArrowDown":
        at(i + 1);
        break;
      case "ArrowUp":
        at(i - 1);
        break;
      case "Home":
        at(0);
        break;
      case "End":
        at(visible.length - 1);
        break;
      case "ArrowRight":
        if (expandable && isCollapsed(a.code)) toggle(a.code);
        else if (expandable) at(i + 1);
        break;
      case "ArrowLeft": {
        const parent = parentCodeOf(a.code);
        if (expandable && !isCollapsed(a.code)) toggle(a.code);
        else if (parent && visible.some((v) => v.code === parent))
          focusRow(parent);
        break;
      }
      case "Enter":
        if (canManage) openPanel(a, null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const thisYear = new Date().getFullYear();
  const yearOptions = [thisYear, thisYear + 1, thisYear + 2];
  if (requiredFrom && !yearOptions.includes(requiredFrom)) {
    yearOptions.unshift(requiredFrom);
  }

  const isEmpty = isSuccess && accounts.length === 0;
  const hasPlan = isSuccess && accounts.length > 0;
  const editing = panel?.editing ?? null;
  const panelParent = panel?.parentCode
    ? byCode.get(panel.parentCode)
    : undefined;
  const unclassifiedCount = unclassifiedRecurrences.length;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Plano de Contas
          </h1>
          {hasPlan && (
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-medium text-foreground">
                {stats.analytic}
              </span>{" "}
              analíticas ·{" "}
              <span className="font-medium text-foreground">
                {stats.synthetic}
              </span>{" "}
              sintéticas
              {stats.archived > 0 && <> · {stats.archived} arquivadas</>}
            </p>
          )}
        </div>

        {canManage && hasPlan && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setImportState({ model: null })}
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar</span>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                chartOfAccountsService.downloadSpreadsheet({
                  kind: "current",
                  accounts,
                  companyName: selectedCompany?.name ?? "",
                })
              }
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar</span>
            </Button>
            <Button onClick={() => openPanel(null, null)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nova conta</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          </div>
        )}
      </div>

      {/* Vigência e o que falta para ela */}
      {hasPlan && !requiredFromLoading && (
        <section
          aria-label="Obrigatoriedade da conta"
          className="flex flex-col gap-2 border-y py-3 text-sm lg:flex-row lg:items-center lg:gap-6"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span id="required-from-label" className="font-medium">
              Conta obrigatória nos lançamentos
            </span>
            <Select
              value={requiredFrom ? String(requiredFrom) : "optional"}
              onValueChange={(v) =>
                v !== (requiredFrom ? String(requiredFrom) : "optional") &&
                setPendingRequired(v)
              }
              disabled={!canManage}
            >
              <SelectTrigger
                aria-labelledby="required-from-label"
                className="h-8 w-fit"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="optional">Não, opcional</SelectItem>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    A partir de 01/01/{y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canManage && unclassifiedCount > 0 && (
            <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                {unclassifiedCount === 1
                  ? "1 recorrência ativa sem conta: os lançamentos que ela gera ficam fora das linhas da DRE."
                  : `${unclassifiedCount} recorrências ativas sem conta: os lançamentos que elas geram ficam fora das linhas da DRE.`}{" "}
                <Link
                  href="/financeiro/recorrencias?filtro=sem-conta"
                  className="font-medium underline underline-offset-2"
                >
                  Classificar
                </Link>
              </span>
            </p>
          )}
        </section>
      )}

      {isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm"
        >
          <p className="font-medium">
            Não foi possível carregar o plano de contas.
          </p>
          <p className="text-muted-foreground mt-1">
            Verifique a conexão e tente de novo. Nada foi alterado.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : isPending ? (
        <div className="rounded-lg border bg-background">
          <div className="h-[53px] border-b" />
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className={cn(GRID, "px-4 py-3 border-b last:border-0")}
            >
              <Skeleton className="h-4 w-16" />
              <Skeleton
                className="h-4 max-w-sm"
                style={{ marginLeft: (i % 3) * 16 }}
              />
              <Skeleton className="h-4 w-14 hidden md:block" />
              <Skeleton className="h-4 w-32 hidden md:block" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyChart
          canManage={canManage}
          onModel={(model) => setImportState({ model })}
          onImport={() => setImportState({ model: null })}
          onCreate={() => openPanel(null, null)}
        />
      ) : hasPlan ? (
        <div className="rounded-lg border bg-background">
          {/* Filtros */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-3 border-b">
            <div className="relative flex-1">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por código ou nome"
                aria-label="Buscar conta por código ou nome"
                aria-keyshortcuts="/"
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Select
                value={natureFilter}
                onValueChange={(v) => setNatureFilter(v as NatureFilter)}
              >
                <SelectTrigger aria-label="Natureza" className="w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as naturezas</SelectItem>
                  <SelectItem value="revenue">Receitas</SelectItem>
                  <SelectItem value="expense">Despesas</SelectItem>
                  {stats.hasBalance && (
                    <SelectItem value="balance">Patrimoniais</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {stats.archived > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                  <Checkbox
                    checked={showArchived}
                    onCheckedChange={(v) => setShowArchived(!!v)}
                  />
                  Arquivadas
                </label>
              )}
              <div
                role="group"
                aria-label="Abrir a árvore até o nível"
                className="flex items-center gap-1 text-sm"
              >
                <span className="text-muted-foreground mr-1">Abrir até</span>
                {DEPTH_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    variant={depth === o.value ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 min-w-8 px-2"
                    aria-pressed={depth === o.value}
                    disabled={!!search}
                    onClick={() => {
                      setDepth(o.value);
                      setToggled(new Set());
                    }}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Cabeçalho da tabela: fica visível ao rolar */}
          <div
            aria-hidden
            className={cn(
              GRID,
              "hidden sticky top-0 z-10 px-4 py-2.5 border-b bg-muted text-xs font-medium text-muted-foreground uppercase tracking-wide",
            )}
          >
            <span>Código</span>
            <span>Conta</span>
            <span>Natureza</span>
            <span>Linha da DRE</span>
          </div>

          {visible.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma conta encontrada
              {search ? ` para "${search.trim()}"` : ""}.
            </p>
          ) : (
            <ul
              role="tree"
              aria-label="Plano de contas"
              className="divide-y"
              onKeyDown={onTreeKeyDown}
            >
              {visible.map((a) => {
                const isSynthetic = a.type === "synthetic";
                const expandable = !search && (childCount.get(a.code) ?? 0) > 0;
                const collapsed = expandable && isCollapsed(a.code);
                const parentCode = parentCodeOf(a.code);
                const parent = parentCode ? byCode.get(parentCode) : undefined;
                // Natureza e linha da DRE só onde são declaradas; nas filhas
                // que herdam, o valor fica para leitores de tela e no title.
                const showNature = !parent || parent.nature !== a.nature;
                const inheritedGroup = parentCode
                  ? groupOf(parentCode)
                  : undefined;
                const showGroup = !!a.dreGroup && a.dreGroup !== inheritedGroup;
                const group = a.dreGroup ?? inheritedGroup;
                const groupLabel = group ? DRE_GROUP_LABEL[group] : undefined;
                return (
                  <li
                    key={a.id}
                    id={`conta-${a.code}`}
                    role="treeitem"
                    aria-level={a.level + 1}
                    aria-expanded={expandable ? !collapsed : undefined}
                    aria-selected={false}
                    tabIndex={a.code === activeCode ? 0 : -1}
                    onFocus={() => setFocused(a.code)}
                    onClick={() => canManage && openPanel(a, null)}
                    className={cn(
                      GRID,
                      "flex flex-col px-4 py-2 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      canManage && "cursor-pointer",
                      a.level === 0 && "bg-muted/25",
                      a.archived && "text-muted-foreground",
                    )}
                  >
                    <span className="font-financial tabular-nums text-xs text-muted-foreground md:text-sm">
                      {a.code}
                    </span>

                    <div
                      className="flex items-center gap-1 min-w-0"
                      style={{ paddingLeft: `${a.level * 16}px` }}
                    >
                      {expandable ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(a.code);
                          }}
                          className="h-6 w-6 -ml-1 flex items-center justify-center rounded hover:bg-muted shrink-0"
                          aria-label={
                            collapsed ? `Abrir ${a.name}` : `Fechar ${a.name}`
                          }
                        >
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform",
                              !collapsed && "rotate-90",
                            )}
                          />
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "truncate",
                          a.level === 0
                            ? "font-semibold"
                            : isSynthetic && "font-medium",
                        )}
                        title={a.description || a.name}
                      >
                        {a.name}
                      </span>
                      {collapsed && (
                        <span className="ml-1 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {childCount.get(a.code)}
                        </span>
                      )}
                      {a.archived && (
                        <Badge
                          variant="secondary"
                          className="text-xs h-5 px-1.5 ml-1 shrink-0"
                        >
                          Arquivada
                        </Badge>
                      )}
                    </div>

                    {/* A célula existe sempre: um `sr-only` direto na grade
                        sai do fluxo e empurra a coluna seguinte para cá. */}
                    <span
                      className={cn(
                        "text-xs font-medium",
                        NATURE_CLASS[a.nature],
                      )}
                    >
                      {showNature ? (
                        ACCOUNT_NATURE_LABEL[a.nature]
                      ) : (
                        <span className="sr-only">
                          Natureza{" "}
                          {ACCOUNT_NATURE_LABEL[a.nature].toLowerCase()},
                          herdada
                        </span>
                      )}
                    </span>
                    <span className="text-xs md:truncate" title={groupLabel}>
                      {showGroup ? (
                        groupLabel
                      ) : groupLabel ? (
                        <span className="sr-only">
                          Linha da DRE {groupLabel}, herdada
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* Criar / editar: painel lateral, a árvore continua à vista */}
      <Sheet open={!!panel} onOpenChange={(open) => !open && guard(closePanel)}>
        <SheetContent
          overlayClassName="bg-black/10"
          className="w-full gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-6 py-4 pr-12">
            <SheetTitle className="text-lg">
              {editing ? (
                <>
                  <span className="font-financial tabular-nums text-muted-foreground mr-2">
                    {editing.code}
                  </span>
                  {editing.name}
                </>
              ) : (
                "Nova conta"
              )}
            </SheetTitle>
            <SheetDescription>
              {editing
                ? editing.type === "synthetic"
                  ? `Sintética · ${childCount.get(editing.code) ?? 0} subcontas diretas`
                  : "Analítica · recebe lançamentos"
                : panelParent
                  ? `Dentro de ${panelParent.code} · ${panelParent.name}`
                  : "Escolha a conta superior ou deixe no primeiro nível."}
            </SheetDescription>
            {editing?.type === "synthetic" && !editing.archived && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 self-start"
                onClick={() => openPanel(null, editing.code)}
              >
                <FilePlus2 className="h-4 w-4" /> Adicionar subconta
              </Button>
            )}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5">
            {panel && (
              <AccountForm
                key={editing?.id ?? `new-${panel.parentCode}`}
                accounts={accounts}
                editing={editing}
                parentCode={panel.parentCode}
                isLoading={isSaving}
                onSubmit={handleSubmit}
                onCancel={() => guard(closePanel)}
                onDirtyChange={setIsDirty}
                footerStart={
                  editing && (
                    <>
                      {editing.archived ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setArchived(editing, false)}
                        >
                          <ArchiveRestore className="h-4 w-4" /> Reativar
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setArchiving(editing)}
                        >
                          <Archive className="h-4 w-4" /> Arquivar
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        disabled={(childCount.get(editing.code) ?? 0) > 0}
                        title={
                          (childCount.get(editing.code) ?? 0) > 0
                            ? "Exclua ou mova as subcontas primeiro"
                            : undefined
                        }
                        onClick={() => setDeleting(editing)}
                      >
                        <Trash2 className="h-4 w-4" /> Excluir
                      </Button>
                    </>
                  )
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {companyId && actor && (
        <ImportChartDialog
          open={!!importState}
          onOpenChange={(o) => !o && setImportState(null)}
          companyId={companyId}
          actor={actor}
          model={importState?.model}
          onImported={refresh}
        />
      )}

      <ConfirmDialog
        open={!!pendingDiscard}
        onOpenChange={(open) => !open && setPendingDiscard(null)}
        title="Descartar alterações?"
        description="O que foi alterado nesta conta será perdido."
        confirmText="Descartar"
        cancelText="Continuar editando"
        variant="destructive"
        onConfirm={() => {
          setIsDirty(false);
          pendingDiscard?.();
          setPendingDiscard(null);
        }}
      />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => !open && setArchiving(null)}
        title="Arquivar conta"
        description={
          archiving
            ? (() => {
                const n = descendantsOf(archiving);
                return n > 0
                  ? `Arquivar ${archiving.code} · ${archiving.name} e as ${n} subcontas? Elas saem dos formulários de lançamento; a DRE de períodos passados continua fechando.`
                  : `Arquivar ${archiving.code} · ${archiving.name}? Ela sai dos formulários de lançamento; a DRE de períodos passados continua fechando.`;
              })()
            : ""
        }
        confirmText={
          archiving && descendantsOf(archiving) > 0
            ? `Arquivar ${descendantsOf(archiving) + 1} contas`
            : "Arquivar"
        }
        onConfirm={async () => {
          if (archiving) await setArchived(archiving, true);
          setArchiving(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir conta"
        description={
          deleting
            ? `Excluir ${deleting.code} · ${deleting.name}? Só é possível para contas sem lançamentos; para as demais, use Arquivar.`
            : ""
        }
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!pendingRequired}
        onOpenChange={(open) => !open && setPendingRequired(null)}
        title={
          pendingRequired === "optional"
            ? "Tornar a conta opcional?"
            : `Tornar a conta obrigatória a partir de ${pendingRequired}?`
        }
        description={
          pendingRequired === "optional"
            ? "Contas a pagar e a receber poderão ser salvas sem conta do plano. Elas entram na DRE como lançamentos sem conta."
            : `Contas a pagar e a receber com vencimento a partir de 01/01/${pendingRequired} só poderão ser salvas com conta do plano.` +
              (unclassifiedCount > 0
                ? ` ${unclassifiedCount === 1 ? "1 recorrência ativa ainda está" : `${unclassifiedCount} recorrências ativas ainda estão`} sem conta e vai gerar lançamentos sem classificação.`
                : "")
        }
        confirmText={
          pendingRequired === "optional"
            ? "Tornar opcional"
            : "Tornar obrigatória"
        }
        onConfirm={async () => {
          if (pendingRequired) await handleRequiredFrom(pendingRequired);
          setPendingRequired(null);
        }}
      />
    </div>
  );
}

function EmptyChart({
  canManage,
  onModel,
  onImport,
  onCreate,
}: {
  canManage: boolean;
  onModel: (model: ChartModelKey) => void;
  onImport: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-lg border bg-background py-10 px-6">
      <div className="flex flex-col items-center text-center max-w-xl mx-auto">
        <ListTree className="h-8 w-8 text-muted-foreground mb-3" aria-hidden />
        <h2 className="text-lg font-semibold">
          Nenhum plano de contas cadastrado
        </h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          O plano de contas classifica cada receita e despesa (energia,
          salários, doações, tarifas) e é a base da DRE gerencial. Os centros de
          custo continuam dizendo <em>quem</em> gastou; o plano diz{" "}
          <em>no quê</em>.
        </p>
      </div>

      {canManage ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 max-w-3xl mx-auto">
          {(Object.keys(CHART_MODELS) as ChartModelKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onModel(key)}
              className="text-left rounded-lg border p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Começar com um modelo
              </p>
              <p className="font-semibold mt-1">{CHART_MODELS[key].label}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {CHART_MODELS[key].description}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {CHART_MODELS[key].accounts.length} contas, editáveis depois
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={onImport}
            className="text-left rounded-lg border p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4" /> Importar planilha
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Excel ou CSV no modelo do sistema: o seu plano atual ou o do seu
              contador.
            </p>
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="text-left rounded-lg border p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" /> Criar do zero
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Cadastre conta por conta, começando pelos grupos de primeiro
              nível.
            </p>
          </button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground mt-4">
          Peça ao gestor financeiro para cadastrar o plano.
        </p>
      )}
    </div>
  );
}
