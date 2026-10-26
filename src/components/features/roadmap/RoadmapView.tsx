"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { MessageSquareText, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useGlobalStore } from "@/lib/store/useGlobalStore";
import { roadmapService } from "@/lib/services/roadmapService";
import { normalizeText } from "@/lib/search/query";
import {
  ROADMAP_STATUSES,
  ROADMAP_STATUS_LABEL,
  VOTABLE_STATUSES,
  voterKey,
  votingCompanies,
  type RoadmapItem,
  type RoadmapStatus,
} from "@/lib/roadmap";
import { RoadmapItemPanel, VoteButton } from "./RoadmapItemPanel";
import { SuggestionPanel } from "./SuggestionPanel";

type Sort = "votes" | "recent";

const fmt = (d?: Date) => (d ? format(d, "dd/MM/yyyy") : "");

// Data que importa em cada situação: quando foi pedido, quando mudou, quando saiu
function dateLine(item: RoadmapItem) {
  if (item.status === "done" && item.doneAt) {
    return `entregue em ${fmt(item.doneAt)}`;
  }
  if (item.status === "suggestion") return `sugerida em ${fmt(item.createdAt)}`;
  return `atualizada em ${fmt(item.updatedAt ?? item.createdAt)}`;
}

const time = (d?: Date) => d?.getTime() ?? 0;

export function RoadmapView() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;
  const isAdmin = user?.role === "admin";
  const uid = user?.uid ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const setNovidadesOpen = useGlobalStore((s) => s.setNovidadesOpen);

  const queryKey = useMemo(
    () => ["roadmap", companyId, isAdmin],
    [companyId, isAdmin],
  );
  const {
    data: items = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => roadmapService.getVisible(companyId, isAdmin),
    enabled: !!user,
  });

  const [tab, setTab] = useState<RoadmapStatus>("suggestion");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("votes");
  const [creating, setCreating] = useState(false);
  const openId = searchParams.get("item");
  const openItem = items.find((i) => i.id === openId) ?? null;

  // Link de notificação (?item=) abre o item e a aba em que ele está
  const [tabFollows, setTabFollows] = useState<string | null>(null);
  if (openItem && openItem.id !== tabFollows) {
    setTabFollows(openItem.id);
    setTab(openItem.status);
  }

  const openPanel = (id: string | null) =>
    router.replace(id ? `/roadmap?item=${id}` : "/roadmap", { scroll: false });

  const hasVoted = (item: RoadmapItem) =>
    item.voters.some((v) => v.endsWith(`:${uid}`));
  const isMine = (item: RoadmapItem) => item.userId === uid || hasVoted(item);

  const scoped = mineOnly ? items.filter(isMine) : items;
  const counts = Object.fromEntries(
    ROADMAP_STATUSES.map((s) => [
      s,
      scoped.filter((i) => i.status === s).length,
    ]),
  ) as Record<RoadmapStatus, number>;

  const needle = normalizeText(search.trim());
  const searching = needle.length > 0;
  const rows = scoped
    .filter((i) =>
      searching
        ? normalizeText(`${i.title} ${i.description}`).includes(needle)
        : i.status === tab,
    )
    .sort((a, b) => {
      if (!searching && tab === "done") return time(b.doneAt) - time(a.doneAt);
      if (sort === "votes" && b.voters.length !== a.voters.length) {
        return b.voters.length - a.voters.length;
      }
      return (
        time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt)
      );
    });

  const toggleVote = async (item: RoadmapItem) => {
    const existing = item.voters.find((v) => v.endsWith(`:${uid}`));
    if (!existing && !companyId) return;
    const key = existing ?? voterKey(companyId!, uid);
    const on = !existing;
    const patch = (list: RoadmapItem[] = []) =>
      list.map((i) =>
        i.id === item.id
          ? {
              ...i,
              voters: on
                ? [...i.voters, key]
                : i.voters.filter((v) => v !== key),
            }
          : i,
      );
    queryClient.setQueryData<RoadmapItem[]>(queryKey, patch);
    try {
      await roadmapService.vote(item.id, key, on);
    } catch {
      toast.error("Não foi possível registrar o voto.");
      refetch();
    }
  };

  const refresh = () => {
    refetch();
  };

  const showSort = searching || tab === "suggestion" || tab === "planned";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 md:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Roadmap
          </h1>
          {isLoading ? (
            <Skeleton className="mt-2 h-4 w-72" />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              <Count n={counts.suggestion} /> em votação ·{" "}
              <Count n={counts.planned} />{" "}
              {counts.planned === 1 ? "planejado" : "planejados"} ·{" "}
              <Count n={counts.in_progress} /> em execução ·{" "}
              <Count n={counts.done} />{" "}
              {counts.done === 1 ? "entregue" : "entregues"}
            </p>
          )}
        </div>
        <Button
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setCreating(true)}
          disabled={!companyId}
        >
          <Plus className="size-4" />
          Nova sugestão
        </Button>
      </div>

      <div className="flex flex-col rounded-xl border bg-card">
        <div
          role="tablist"
          aria-label="Situação"
          className="flex overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {ROADMAP_STATUSES.map((s) => {
            const selected = s === tab && !searching;
            return (
              <button
                key={s}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => {
                  setTab(s);
                  setSearch("");
                }}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
                  selected
                    ? "after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ROADMAP_STATUS_LABEL[s]}
                {isLoading ? (
                  <Skeleton className="h-4 w-5 rounded-full" />
                ) : (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                    {counts[s]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar em todas as situações"
              aria-label="Buscar no roadmap"
              className="h-9 pl-8"
            />
          </div>
          <Button
            variant={mineOnly ? "secondary" : "ghost"}
            size="sm"
            className="h-9"
            aria-pressed={mineOnly}
            onClick={() => setMineOnly((v) => !v)}
          >
            Minhas e votadas
          </Button>
          {showSort && (
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="h-9 w-40" aria-label="Ordenar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="votes">Mais votadas</SelectItem>
                <SelectItem value="recent">Mais recentes</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {!searching && tab === "done" && counts.done > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            O que mudou em cada entrega está descrito em Novidades.
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setNovidadesOpen(true)}
            >
              Abrir Novidades
            </Button>
          </div>
        )}

        {isLoading ? (
          <ul className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex gap-4 px-4 py-4">
                <Skeleton className="h-12 w-11 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
            Não foi possível carregar o roadmap.
            <Button variant="outline" size="sm" onClick={refresh}>
              Tentar de novo
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyTab
            tab={tab}
            searching={searching}
            mineOnly={mineOnly}
            onCreate={() => setCreating(true)}
          />
        ) : (
          <ul className="divide-y">
            {rows.map((item) => (
              <Row
                key={item.id}
                item={item}
                voted={hasVoted(item)}
                canVote={
                  VOTABLE_STATUSES.includes(item.status) &&
                  (hasVoted(item) || !!companyId)
                }
                showStatus={searching}
                showAuthor={isAdmin || item.companyId === companyId}
                isAdmin={isAdmin}
                onVote={() => toggleVote(item)}
                onOpen={() => openPanel(item.id)}
              />
            ))}
          </ul>
        )}

        {!searching && (tab === "suggestion" || tab === "planned") && (
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            Sugestões e itens planejados aparecem só para a sua empresa. Quando
            entram em execução, ficam visíveis para todos os clientes.
          </p>
        )}
      </div>

      <RoadmapItemPanel
        key={`${openItem?.id}:${time(openItem?.updatedAt)}`}
        item={openItem}
        items={items}
        uid={uid}
        isAdmin={isAdmin}
        voted={openItem ? hasVoted(openItem) : false}
        canVote={
          !!openItem &&
          VOTABLE_STATUSES.includes(openItem.status) &&
          (hasVoted(openItem) || !!companyId)
        }
        onVote={() => openItem && toggleVote(openItem)}
        onOpenItem={openPanel}
        onClose={() => openPanel(null)}
        onChanged={refresh}
      />

      {companyId && user && (
        <SuggestionPanel
          open={creating}
          onOpenChange={setCreating}
          companyId={companyId}
          user={user}
          items={items}
          hasVoted={hasVoted}
          onVote={toggleVote}
          onOpenItem={(id) => {
            setCreating(false);
            openPanel(id);
          }}
          onCreated={(id) => {
            setTab("suggestion");
            refresh();
            openPanel(id);
          }}
        />
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-medium tabular-nums text-foreground">{n}</span>;
}

function Row({
  item,
  voted,
  canVote,
  showStatus,
  showAuthor,
  isAdmin,
  onVote,
  onOpen,
}: {
  item: RoadmapItem;
  voted: boolean;
  canVote: boolean;
  showStatus: boolean;
  showAuthor: boolean;
  isAdmin: boolean;
  onVote: () => void;
  onOpen: () => void;
}) {
  const companies = votingCompanies(item);
  return (
    <li className="flex items-start gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40">
      <VoteButton
        count={item.voters.length}
        voted={voted}
        disabled={!canVote}
        onClick={onVote}
      />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          {showStatus && (
            <span className="shrink-0 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
              {ROADMAP_STATUS_LABEL[item.status]}
            </span>
          )}
        </span>
        <span className="mt-0.5 line-clamp-1 max-w-[90ch] text-sm text-muted-foreground">
          {item.description}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {showAuthor && item.authorName && <span>{item.authorName}</span>}
          {showAuthor && item.authorName && <span aria-hidden>·</span>}
          <span className="tabular-nums">{dateLine(item)}</span>
          {isAdmin && companies > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {companies} {companies === 1 ? "empresa" : "empresas"}
              </span>
            </>
          )}
          {item.response && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <MessageSquareText className="size-3.5" />
              Resposta da equipe
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function EmptyTab({
  tab,
  searching,
  mineOnly,
  onCreate,
}: {
  tab: RoadmapStatus;
  searching: boolean;
  mineOnly: boolean;
  onCreate: () => void;
}) {
  const text = searching
    ? "Nada encontrado. Se ninguém pediu isso ainda, a sugestão pode ser sua."
    : mineOnly
      ? "Você não sugeriu nem votou em nada nesta situação."
      : {
          suggestion: "Nenhuma sugestão em votação.",
          planned: "Nada planejado no momento.",
          in_progress: "Nada em execução no momento.",
          done: "Nenhuma entrega registrada ainda.",
          declined: "Nenhuma sugestão encerrada.",
        }[tab];
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-muted-foreground">
      {text}
      {(searching || tab === "suggestion") && (
        <Button variant="outline" size="sm" onClick={onCreate}>
          Nova sugestão
        </Button>
      )}
    </div>
  );
}
