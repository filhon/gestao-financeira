"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  FilePlus2,
  ListTree,
  MoreHorizontal,
  Pencil,
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
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
  DRE_GROUP_LABEL,
  groupResolver,
  parentCodeOf,
  withLevels,
} from "@/lib/chartOfAccounts";
import { ChartAccount } from "@/lib/types";
import { cn, normalizeText } from "@/lib/utils";

type NatureFilter = "all" | "revenue" | "expense";

export default function ChartOfAccountsPage() {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const { canManageChartOfAccounts: canManage } = usePermissions();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id;
  const { accounts, requiredFrom, isLoading } = useChartOfAccounts(companyId);

  const [search, setSearch] = useState("");
  const [natureFilter, setNatureFilter] = useState<NatureFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [formState, setFormState] = useState<{
    editing: ChartAccount | null;
    parentCode: string | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleting, setDeleting] = useState<ChartAccount | null>(null);
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

  const groupOf = useMemo(() => groupResolver(accounts), [accounts]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of accounts) {
      const p = parentCodeOf(a.code);
      if (p) m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  }, [accounts]);

  // Busca mostra as contas encontradas e o caminho até elas; sem busca, a
  // árvore respeita o que foi recolhido.
  const visible = useMemo(() => {
    const term = normalizeText(search.trim());
    const base = accounts.filter(
      (a) =>
        (showArchived || !a.archived) &&
        (natureFilter === "all" || a.nature === natureFilter),
    );
    if (term) {
      const hits = base.filter(
        (a) => a.code.startsWith(term) || normalizeText(a.name).includes(term),
      );
      const keep = new Set<string>();
      for (const h of hits) {
        for (let c: string | null = h.code; c; c = parentCodeOf(c)) keep.add(c);
      }
      return withLevels(base.filter((a) => keep.has(a.code)));
    }
    return withLevels(base).filter((a) => {
      for (let p = parentCodeOf(a.code); p; p = parentCodeOf(p)) {
        if (collapsed.has(p)) return false;
      }
      return true;
    });
  }, [accounts, search, natureFilter, showArchived, collapsed]);

  const stats = useMemo(
    () => ({
      analytic: accounts.filter((a) => a.type === "analytic" && !a.archived)
        .length,
      synthetic: accounts.filter((a) => a.type === "synthetic" && !a.archived)
        .length,
      archived: accounts.filter((a) => a.archived).length,
    }),
    [accounts],
  );

  const toggle = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const handleSubmit = async (draft: AccountDraft) => {
    if (!companyId || !actor || !formState) return;
    try {
      setIsSaving(true);
      if (formState.editing) {
        await chartOfAccountsService.update(formState.editing.id, draft, actor);
        toast.success("Conta atualizada.");
      } else {
        await chartOfAccountsService.create(draft, companyId, actor);
        toast.success("Conta criada.");
      }
      await refresh();
      setFormState(null);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar a conta.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async (account: ChartAccount) => {
    if (!actor) return;
    try {
      await chartOfAccountsService.setArchived(
        account.id,
        !account.archived,
        actor,
      );
      await refresh();
      toast.success(account.archived ? "Conta reativada." : "Conta arquivada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao arquivar.");
    }
  };

  const handleDelete = async () => {
    if (!deleting || !actor) return;
    try {
      await chartOfAccountsService.delete(deleting.id, actor);
      await refresh();
      toast.success("Conta excluída.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao excluir.");
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

  const thisYear = new Date().getFullYear();
  const yearOptions = [thisYear, thisYear + 1, thisYear + 2];
  if (requiredFrom && !yearOptions.includes(requiredFrom)) {
    yearOptions.unshift(requiredFrom);
  }

  const isEmpty = !isLoading && accounts.length === 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-3xl font-bold tracking-tight">
            Plano de Contas
          </h1>
          {!isLoading && accounts.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1.5">
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

        {canManage && !isEmpty && (
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
            <Button
              onClick={() => setFormState({ editing: null, parentCode: null })}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nova conta</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          </div>
        )}
      </div>

      {/* Vigência */}
      {!isEmpty && !isLoading && (
        <Card>
          <CardContent className="flex flex-col md:flex-row md:items-center gap-4 py-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Classificação obrigatória</p>
              <p className="text-sm text-muted-foreground">
                {requiredFrom
                  ? `Contas a pagar e a receber com vencimento a partir de 01/01/${requiredFrom} só são salvas com conta do plano. Antes disso, a conta é opcional.`
                  : "A conta do plano é opcional em todos os lançamentos. Defina um exercício para torná-la obrigatória a partir dele."}
              </p>
            </div>
            <Select
              value={requiredFrom ? String(requiredFrom) : "optional"}
              onValueChange={handleRequiredFrom}
              disabled={!canManage}
            >
              <SelectTrigger className="w-full md:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="optional">Opcional</SelectItem>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    Obrigatória a partir de {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {canManage && unclassifiedRecurrences.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="text-amber-900 dark:text-amber-200">
            <p className="font-medium">
              {unclassifiedRecurrences.length === 1
                ? "1 recorrência ativa está sem conta"
                : `${unclassifiedRecurrences.length} recorrências ativas estão sem conta`}
            </p>
            <p className="text-amber-800/80 dark:text-amber-300/80">
              As contas geradas por elas chegam sem classificação e ficam fora
              das linhas da DRE. Defina a conta de cada uma em{" "}
              <Link
                href="/financeiro/recorrencias"
                className="underline underline-offset-2"
              >
                Financeiro › Recorrências
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton
                  className="h-4 flex-1 max-w-sm"
                  style={{ marginLeft: (i % 3) * 16 }}
                />
                <Skeleton className="h-4 w-24 hidden md:block" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <EmptyChart
          canManage={canManage}
          onModel={(model) => setImportState({ model })}
          onImport={() => setImportState({ model: null })}
          onCreate={() => setFormState({ editing: null, parentCode: null })}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Filtros */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por código ou nome..."
                  className="pl-8"
                />
              </div>
              <Select
                value={natureFilter}
                onValueChange={(v) => setNatureFilter(v as NatureFilter)}
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="revenue">Receitas</SelectItem>
                  <SelectItem value="expense">Despesas</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-4">
                {stats.archived > 0 && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                    <Checkbox
                      checked={showArchived}
                      onCheckedChange={(v) => setShowArchived(!!v)}
                    />
                    Arquivadas
                  </label>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={!!search}
                  onClick={() =>
                    setCollapsed(
                      collapsed.size > 0
                        ? new Set()
                        : new Set(
                            accounts
                              .filter(
                                (a) =>
                                  a.type === "synthetic" &&
                                  !parentCodeOf(a.code),
                              )
                              .map((a) => a.code),
                          ),
                    )
                  }
                >
                  {collapsed.size > 0 ? (
                    <>
                      <ChevronsUpDown className="h-4 w-4" /> Expandir
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="h-4 w-4" /> Recolher
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Cabeçalho da tabela */}
            <div className="hidden md:grid grid-cols-[140px_minmax(0,1fr)_110px_100px_minmax(0,260px)_56px] gap-4 px-4 py-2.5 border-b bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>Código</span>
              <span>Conta</span>
              <span>Tipo</span>
              <span>Natureza</span>
              <span>Linha da DRE</span>
              <span />
            </div>

            {visible.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma conta encontrada.
              </p>
            ) : (
              <ul className="divide-y">
                {visible.map((a) => {
                  const isSynthetic = a.type === "synthetic";
                  const children = childCount.get(a.code) ?? 0;
                  const group = a.dreGroup ?? groupOf(a.code);
                  return (
                    <li
                      key={a.id}
                      className={cn(
                        "group grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[140px_minmax(0,1fr)_110px_100px_minmax(0,260px)_56px] gap-x-4 gap-y-0.5 items-center px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors",
                        a.archived && "text-muted-foreground",
                      )}
                    >
                      <span
                        className="font-mono text-xs text-muted-foreground md:text-sm md:text-foreground/80 col-start-1 md:col-auto pl-5 md:pl-0"
                        style={{ marginLeft: `${a.level * 14}px` }}
                      >
                        {a.code}
                      </span>

                      <div
                        className="flex items-center gap-1 min-w-0 col-start-1 md:col-auto"
                        style={{ paddingLeft: `${a.level * 14}px` }}
                      >
                        {isSynthetic && children > 0 && !search ? (
                          <button
                            type="button"
                            onClick={() => toggle(a.code)}
                            className="h-6 w-6 -ml-1 flex items-center justify-center rounded hover:bg-muted shrink-0"
                            aria-label={
                              collapsed.has(a.code) ? "Expandir" : "Recolher"
                            }
                          >
                            <ChevronRight
                              className={cn(
                                "h-4 w-4 transition-transform",
                                !collapsed.has(a.code) && "rotate-90",
                              )}
                            />
                          </button>
                        ) : (
                          <span className="w-5 shrink-0" />
                        )}
                        <span
                          className={cn(
                            "truncate",
                            isSynthetic && "font-semibold",
                          )}
                          title={a.description || a.name}
                        >
                          {a.name}
                        </span>
                        {a.archived && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1 ml-1 shrink-0"
                          >
                            Arquivada
                          </Badge>
                        )}
                      </div>

                      <span className="hidden md:block">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px] font-normal",
                            isSynthetic
                              ? "text-muted-foreground"
                              : "border-primary/40 text-primary",
                          )}
                        >
                          {isSynthetic ? "Sintética" : "Analítica"}
                        </Badge>
                      </span>
                      <span
                        className={cn(
                          "hidden md:block text-xs",
                          a.nature === "revenue"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700 dark:text-rose-400",
                        )}
                      >
                        {ACCOUNT_NATURE_LABEL[a.nature]}
                      </span>
                      <span
                        className={cn(
                          "hidden md:block truncate text-xs",
                          !a.dreGroup && "text-muted-foreground",
                        )}
                      >
                        {group ? DRE_GROUP_LABEL[group] : "—"}
                      </span>

                      <div className="row-span-2 md:row-span-1 col-start-2 md:col-auto row-start-1 md:row-start-auto flex justify-end">
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                aria-label={`Ações da conta ${a.code}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  setFormState({ editing: a, parentCode: null })
                                }
                              >
                                <Pencil className="h-4 w-4" /> Editar
                              </DropdownMenuItem>
                              {isSynthetic && !a.archived && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setFormState({
                                      editing: null,
                                      parentCode: a.code,
                                    })
                                  }
                                >
                                  <FilePlus2 className="h-4 w-4" /> Adicionar
                                  subconta
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleArchive(a)}
                              >
                                {a.archived ? (
                                  <>
                                    <ArchiveRestore className="h-4 w-4" />{" "}
                                    Reativar
                                  </>
                                ) : (
                                  <>
                                    <Archive className="h-4 w-4" /> Arquivar
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleting(a)}
                                className="text-red-600 focus:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {/* Mobile: tipo e DRE numa linha secundária */}
                      <span
                        className="md:hidden col-start-1 text-xs text-muted-foreground truncate"
                        style={{ paddingLeft: `${a.level * 14 + 20}px` }}
                      >
                        {isSynthetic ? "Sintética" : "Analítica"} ·{" "}
                        {ACCOUNT_NATURE_LABEL[a.nature]}
                        {group && <> · {DRE_GROUP_LABEL[group]}</>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Criar / editar */}
      <ResponsiveModal
        open={!!formState}
        onOpenChange={(o) => !o && setFormState(null)}
      >
        <ResponsiveModalContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              {formState?.editing ? "Editar conta" : "Nova conta"}
            </ResponsiveModalTitle>
          </ResponsiveModalHeader>
          {formState && (
            <AccountForm
              key={formState.editing?.id ?? `new-${formState.parentCode}`}
              accounts={accounts}
              editing={formState.editing}
              parentCode={formState.parentCode}
              isLoading={isSaving}
              onSubmit={handleSubmit}
              onCancel={() => setFormState(null)}
            />
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>

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
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir conta"
        description={
          deleting
            ? `Excluir ${deleting.code} · ${deleting.name}? Só é possível para contas sem lançamentos — para as demais, use Arquivar.`
            : ""
        }
        confirmText="Excluir"
        variant="destructive"
        onConfirm={handleDelete}
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
    <Card>
      <CardContent className="py-10 px-6">
        <div className="flex flex-col items-center text-center max-w-xl mx-auto">
          <div className="rounded-full bg-muted p-4 mb-4">
            <ListTree className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">
            Nenhum plano de contas cadastrado
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            O plano de contas classifica cada receita e despesa — energia,
            salários, doações, tarifas — e é a base da DRE gerencial. Os centros
            de custo continuam dizendo <em>quem</em> gastou; o plano diz{" "}
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
                className="text-left rounded-xl border p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="text-left rounded-xl border p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4" /> Importar planilha
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Excel ou CSV no modelo do sistema — o seu plano atual ou o do
                seu contador.
              </p>
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="text-left rounded-xl border p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      </CardContent>
    </Card>
  );
}
