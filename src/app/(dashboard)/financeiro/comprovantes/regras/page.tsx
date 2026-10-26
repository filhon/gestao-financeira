"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { companyService } from "@/lib/services/companyService";
import { entityService } from "@/lib/services/entityService";
import { transactionService } from "@/lib/services/transactionService";
import { entityIdentifiers } from "@/lib/matching";
import { normalizePixKey } from "@/lib/matching/brazilian";
import { normalize } from "@/lib/matching/text";
import { formatCnpj, validateCnpj } from "@/lib/validations/cnpj";
import { Entity, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { txCandidatesKey } from "@/components/features/finance/comprovantes/MatchReviewPanel";
import {
  lacksReceipt,
  receiptsStartKey,
  suggestedReceiptsStart,
} from "@/components/features/finance/comprovantes/receiptInsight";

type AliasKind = "documents" | "pixKeys" | "names";
type Aliases = NonNullable<Entity["receiptAliases"]>;

const KIND_LABEL: Record<AliasKind, string> = {
  documents: "CNPJ/CPF",
  pixKeys: "Pix",
  names: "Grafia",
};

const formatDocument = (digits: string) =>
  digits.length === 11
    ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    : formatCnpj(digits);

const displayAlias = (kind: AliasKind, value: string) =>
  kind === "documents" ? formatDocument(value) : value;

const aliasCount = (e: Entity) =>
  (e.receiptAliases?.documents?.length ?? 0) +
  (e.receiptAliases?.pixKeys?.length ?? 0) +
  (e.receiptAliases?.names?.length ?? 0);

const ymd = (d: Date | null | undefined) => (d ? format(d, "yyyy-MM-dd") : "");
const fromYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

// ── Página ────────────────────────────────────────────────────────────────────

export default function ComprovanteRulesPage() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const { isAdmin, isFinancialManager } = usePermissions();
  const canEdit = isAdmin || isFinancialManager;
  const companyId = selectedCompany?.id;
  const actor = user ? { uid: user.uid, email: user.email ?? "" } : null;

  const { data: txCandidates = [], isLoading: txLoading } = useQuery({
    queryKey: txCandidatesKey(companyId),
    queryFn: () =>
      transactionService.getAll({
        companyId: companyId!,
        type: "payable",
        statuses: ["paid", "authorized"],
      }),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/financeiro/comprovantes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Comprovantes
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight md:text-2xl">
          Regras de comprovantes
        </h1>
      </div>

      {companyId && actor && (
        <>
          <StartDateSection
            companyId={companyId}
            actor={actor}
            canEdit={canEdit}
            txCandidates={txCandidates}
            txLoading={txLoading}
          />
          <LearnedSection
            companyId={companyId}
            actor={actor}
            canEdit={canEdit}
          />
        </>
      )}
    </div>
  );
}

// ── Início do controle ────────────────────────────────────────────────────────

function StartDateSection({
  companyId,
  actor,
  canEdit,
  txCandidates,
  txLoading,
}: {
  companyId: string;
  actor: { uid: string; email: string };
  canEdit: boolean;
  txCandidates: Transaction[];
  txLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: saved, isLoading } = useQuery({
    queryKey: receiptsStartKey(companyId),
    queryFn: () => companyService.getReceiptsStartDate(companyId),
    staleTime: 5 * 60 * 1000,
  });
  const suggested = useMemo(
    () => suggestedReceiptsStart(txCandidates),
    [txCandidates],
  );

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!isLoading) setDraft(ymd(saved ?? suggested));
  }, [isLoading, saved, suggested]);

  // Prévia do efeito: quantos pagamentos sem comprovante a data deixa de fora.
  const impact = useMemo(() => {
    const unpaid = txCandidates.filter(lacksReceipt);
    if (!draft) return { counted: unpaid.length, excluded: 0 };
    const cut = fromYmd(draft);
    const counted = unpaid.filter(
      (t) => t.paymentDate && t.paymentDate >= cut,
    ).length;
    return { counted, excluded: unpaid.length - counted };
  }, [txCandidates, draft]);

  const persist = async (date: Date | null) => {
    setSaving(true);
    try {
      await companyService.setReceiptsStartDate(companyId, date, actor);
      queryClient.setQueryData(receiptsStartKey(companyId), date);
      toast.success(
        date
          ? `Controle de comprovantes a partir de ${format(date, "dd/MM/yyyy")}.`
          : "Data removida. Vale a sugestão automática.",
      );
    } catch {
      toast.error("Não foi possível salvar a data.");
    } finally {
      setSaving(false);
    }
  };

  const dirty = draft !== ymd(saved);

  return (
    <section id="inicio" className="scroll-mt-20 space-y-3">
      <div>
        <h2 className="text-base font-semibold">Início do controle</h2>
        <p className="mt-0.5 max-w-[70ch] text-sm text-muted-foreground">
          Pagamentos anteriores a esta data não aparecem em Pagos sem
          comprovante. Eles continuam no sistema e podem receber comprovante
          normalmente.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-9 w-72" />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label
              htmlFor="receipts-start"
              className="text-xs text-muted-foreground"
            >
              Controlar comprovantes a partir de
            </Label>
            <Input
              id="receipts-start"
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canEdit}
              className="w-48"
            />
          </div>
          {canEdit && (
            <>
              <Button
                onClick={() => persist(draft ? fromYmd(draft) : null)}
                disabled={!dirty || saving}
                className="gap-1.5"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </Button>
              {saved && (
                <Button
                  variant="ghost"
                  onClick={() => persist(null)}
                  disabled={saving}
                >
                  Remover data
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground tabular-nums">
        {txLoading ? (
          "Calculando o efeito…"
        ) : (
          <>
            {impact.counted} pagamento{impact.counted !== 1 ? "s" : ""} sem
            comprovante a partir desta data
            {impact.excluded > 0 &&
              `; ${impact.excluded} anteriores deixam de contar`}
            .
            {!saved && suggested && (
              <>
                {" "}
                Sem data definida, o sistema usa{" "}
                {format(suggested, "dd/MM/yyyy")}, o mês do primeiro pagamento
                com comprovante.
              </>
            )}
            {saved && suggested && ymd(saved) !== ymd(suggested) && canEdit && (
              <>
                {" "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-2 hover:no-underline"
                  onClick={() => setDraft(ymd(suggested))}
                >
                  Usar a sugestão ({format(suggested, "dd/MM/yyyy")})
                </button>
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}

// ── O que o sistema aprendeu ──────────────────────────────────────────────────

function LearnedSection({
  companyId,
  actor,
  canEdit,
}: {
  companyId: string;
  actor: { uid: string; email: string };
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const entitiesKey = ["entities", companyId, "supplier"];
  const {
    data: entities = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: entitiesKey,
    queryFn: () => entityService.getAll(companyId, "supplier"),
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const withRules = entities.filter(
    (e) => aliasCount(e) > 0 || e.autoConfirmReceipts,
  );
  const rows = useMemo(() => {
    const term = normalize(search);
    const digits = search.replace(/\D/g, "");
    return (showAll || term ? entities : withRules).filter((e) => {
      if (!term) return true;
      const ids = entityIdentifiers(e);
      return (
        normalize(e.name).includes(term) ||
        ids.names.some((n) => n.includes(term)) ||
        (digits.length >= 3 && ids.documents.some((d) => d.includes(digits)))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, search, showAll]);

  const totalAliases = withRules.reduce((sum, e) => sum + aliasCount(e), 0);
  const trusted = withRules.filter((e) => e.autoConfirmReceipts).length;

  // Atualização otimista: a lista responde na hora; erro desfaz.
  const patchEntity = async (
    entity: Entity,
    patch: Pick<Entity, "receiptAliases"> | Pick<Entity, "autoConfirmReceipts">,
  ) => {
    const previous = queryClient.getQueryData<Entity[]>(entitiesKey);
    queryClient.setQueryData<Entity[]>(entitiesKey, (list) =>
      list?.map((e) => (e.id === entity.id ? { ...e, ...patch } : e)),
    );
    try {
      await entityService.update(entity.id, patch, actor, companyId);
    } catch (err) {
      queryClient.setQueryData(entitiesKey, previous);
      throw err;
    }
  };

  const setAliases = (entity: Entity, kind: AliasKind, values: string[]) =>
    patchEntity(entity, {
      receiptAliases: {
        ...(entity.receiptAliases ?? {}),
        [kind]: values,
      } as Aliases,
    });

  const removeAlias = async (
    entity: Entity,
    kind: AliasKind,
    value: string,
  ) => {
    const before = entity.receiptAliases?.[kind] ?? [];
    try {
      await setAliases(
        entity,
        kind,
        before.filter((v) => v !== value),
      );
      toast.success(`${KIND_LABEL[kind]} removido de ${entity.name}.`, {
        action: {
          label: "Desfazer",
          onClick: () => {
            const current =
              queryClient
                .getQueryData<Entity[]>(entitiesKey)
                ?.find((e) => e.id === entity.id) ?? entity;
            setAliases(current, kind, [
              ...(current.receiptAliases?.[kind] ?? []),
              value,
            ]).catch(() => toast.error("Não foi possível desfazer."));
          },
        },
      });
    } catch {
      toast.error("Não foi possível remover.");
    }
  };

  const toggleTrusted = (entity: Entity, value: boolean) =>
    patchEntity(entity, { autoConfirmReceipts: value }).catch(() =>
      toast.error("Não foi possível salvar."),
    );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">
          Reconhecimento de fornecedores
        </h2>
        <p className="mt-0.5 max-w-[70ch] text-sm text-muted-foreground">
          Quando você informa o beneficiário de um comprovante, o CNPJ, a chave
          Pix e o nome como o banco escreveu passam a identificar o fornecedor
          nos próximos. Remova o que estiver errado; o sistema para de usar na
          hora.
        </p>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="relative min-w-0 flex-1 md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Fornecedor, CNPJ ou grafia…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Buscar fornecedor"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={showAll}
              onCheckedChange={(v) => setShowAll(v === true)}
            />
            Mostrar todos os fornecedores
          </label>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {withRules.length} fornecedor{withRules.length !== 1 ? "es" : ""} ·{" "}
            {totalAliases} identificador{totalAliases !== 1 ? "es" : ""}{" "}
            aprendido
            {totalAliases !== 1 ? "s" : ""} · {trusted} com confirmação
            automática
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm font-medium text-destructive">
              Não foi possível carregar os fornecedores.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search ? (
              "Nenhum fornecedor encontrado."
            ) : (
              <div className="mx-auto max-w-[60ch] space-y-2">
                <p className="font-medium text-foreground">
                  Nada aprendido ainda.
                </p>
                <p>
                  Na revisão de um comprovante, use “Corrigir leitura” para
                  informar o beneficiário, ou confirme um título quando o
                  beneficiário não foi lido. O que o sistema aprender aparece
                  aqui.
                </p>
                {canEdit && (
                  <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => setShowAll(true)}
                  >
                    Ou adicione manualmente a um fornecedor
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%] pl-4">Fornecedor</TableHead>
                <TableHead>Reconhecido também por</TableHead>
                <TableHead className="w-56">Confirmação automática</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className="align-top hover:bg-transparent">
                  <TableCell className="max-w-0 pl-4">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        e.document &&
                          `Cadastro: ${formatDocument(e.document.replace(/\D/g, ""))}`,
                        e.pixKey && `Pix ${e.pixKey}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sem CNPJ ou Pix no cadastro"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(["documents", "pixKeys", "names"] as const).flatMap(
                        (kind) =>
                          (e.receiptAliases?.[kind] ?? []).map((value) => (
                            <span
                              key={`${kind}:${value}`}
                              className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
                            >
                              <span className="text-muted-foreground">
                                {KIND_LABEL[kind]}
                              </span>
                              <span className="truncate font-medium">
                                {displayAlias(kind, value)}
                              </span>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => removeAlias(e, kind, value)}
                                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={`Remover ${KIND_LABEL[kind]} ${displayAlias(kind, value)}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          )),
                      )}
                      {aliasCount(e) === 0 && adding !== e.id && (
                        <span className="text-xs text-muted-foreground">
                          Só pelo cadastro
                        </span>
                      )}
                      {canEdit && adding !== e.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                          onClick={() => setAdding(e.id)}
                        >
                          <Plus className="h-3 w-3" />
                          Adicionar
                        </Button>
                      )}
                    </div>
                    {adding === e.id && (
                      <AddAliasForm
                        entity={e}
                        entities={entities}
                        onCancel={() => setAdding(null)}
                        onAdd={async (kind, value) => {
                          await setAliases(e, kind, [
                            ...(e.receiptAliases?.[kind] ?? []),
                            value,
                          ]);
                          setAdding(null);
                          toast.success(
                            `${KIND_LABEL[kind]} adicionado a ${e.name}.`,
                          );
                        }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <label
                      className={cn(
                        "flex items-start gap-2 text-sm",
                        !canEdit && "opacity-60",
                      )}
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={!!e.autoConfirmReceipts}
                        disabled={!canEdit}
                        onCheckedChange={(v) => toggleTrusted(e, v === true)}
                      />
                      <span>
                        Confirmar sem revisão
                        <span className="block text-xs text-muted-foreground">
                          valor exato, sem empate
                        </span>
                      </span>
                    </label>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

// ── Adicionar identificador ───────────────────────────────────────────────────

function AddAliasForm({
  entity,
  entities,
  onAdd,
  onCancel,
}: {
  entity: Entity;
  entities: Entity[];
  onAdd: (kind: AliasKind, value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<AliasKind>("names");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Mesmas regras do aprendizado automático: valor normalizado e nunca algo
  // que já identifica outro fornecedor.
  const prepare = (): string | { error: string } => {
    let value: string;
    if (kind === "documents") {
      value = raw.replace(/\D/g, "");
      if (value.length !== 11 && value.length !== 14) {
        return { error: "Informe um CNPJ (14 dígitos) ou CPF (11)." };
      }
      if (value.length === 14 && !validateCnpj(value))
        return { error: "CNPJ inválido." };
    } else if (kind === "pixKeys") {
      value = normalizePixKey(raw);
      if (!value) return { error: "Informe a chave Pix." };
    } else {
      value = normalize(raw);
      if (value.length < 3) return { error: "Informe ao menos 3 letras." };
    }
    if (entityIdentifiers(entity)[kind].includes(value)) {
      return { error: "Este fornecedor já é reconhecido por isso." };
    }
    const other = entities.find(
      (e) => e.id !== entity.id && entityIdentifiers(e)[kind].includes(value),
    );
    if (other) return { error: `Já identifica ${other.name}.` };
    return value;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const result = prepare();
    if (typeof result !== "string") {
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      await onAdd(kind, result);
    } catch {
      setError("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v as AliasKind);
            setError(null);
          }}
        >
          <SelectTrigger
            className="h-8 w-36"
            aria-label="Tipo de identificador"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="names">Grafia do nome</SelectItem>
            <SelectItem value="documents">CNPJ/CPF</SelectItem>
            <SelectItem value="pixKeys">Chave Pix</SelectItem>
          </SelectContent>
        </Select>
        <Input
          autoFocus
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setError(null);
          }}
          placeholder={
            kind === "names"
              ? "Como aparece no comprovante"
              : kind === "documents"
                ? "00.000.000/0000-00"
                : "e-mail, telefone, CPF/CNPJ ou chave aleatória"
          }
          aria-invalid={!!error}
          className="h-8 min-w-0 flex-1 md:max-w-xs"
        />
        <Button
          type="submit"
          size="sm"
          className="h-8"
          disabled={saving || !raw.trim()}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Adicionar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={onCancel}
        >
          Cancelar
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
