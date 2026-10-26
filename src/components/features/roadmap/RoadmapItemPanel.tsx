"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useGlobalStore } from "@/lib/store/useGlobalStore";
import { roadmapService } from "@/lib/services/roadmapService";
import {
  ROADMAP_STATUSES,
  ROADMAP_STATUS_LABEL,
  votingCompanies,
  type RoadmapItem,
  type RoadmapStatus,
} from "@/lib/roadmap";
import { cn } from "@/lib/utils";

export function VoteButton({
  count,
  voted,
  disabled,
  onClick,
}: {
  count: number;
  voted: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={voted}
      aria-label={`${voted ? "Remover voto" : "Votar"} (${count} ${count === 1 ? "voto" : "votos"})`}
      className={cn(
        "flex w-11 shrink-0 flex-col items-center rounded-md border py-1 text-sm font-semibold tabular-nums transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        voted
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background hover:border-foreground/30",
        disabled && "cursor-default opacity-60 hover:border-border",
      )}
    >
      <ChevronUp className="size-4" />
      {count}
    </button>
  );
}

interface RoadmapItemPanelProps {
  item: RoadmapItem | null;
  items: RoadmapItem[];
  uid: string;
  isAdmin: boolean;
  voted: boolean;
  canVote: boolean;
  onVote: () => void;
  onOpenItem: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
}

const fmt = (d?: Date) => (d ? format(d, "dd/MM/yyyy") : "");

async function adminAction(body: Record<string, unknown>) {
  const res = await fetch("/api/internal/roadmap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Falha ao salvar.");
  return json as { notified: number };
}

const notifiedText = (n: number) =>
  n === 0
    ? "Salvo."
    : `Salvo. ${n} ${n === 1 ? "pessoa foi avisada" : "pessoas foram avisadas"}.`;

export function RoadmapItemPanel({
  item,
  items,
  uid,
  isAdmin,
  voted,
  canVote,
  onVote,
  onOpenItem,
  onClose,
  onChanged,
}: RoadmapItemPanelProps) {
  const setNovidadesOpen = useGlobalStore((s) => s.setNovidadesOpen);
  // O formulário nasce do item salvo; quem chama troca a `key` quando o item
  // aberto ou o que está salvo nele muda (voto não muda, para não perder edição)
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<RoadmapStatus>(
    item?.status ?? "suggestion",
  );
  const [response, setResponse] = useState(item?.response ?? "");
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState<null | "text" | "triage" | "merge">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!item) return null;

  const isAuthor = item.userId === uid;
  const authorCanChange = isAuthor && item.status === "suggestion";
  const canEdit = isAdmin || authorCanChange;
  // Rules: o autor só retira enquanto ninguém mais votou
  const canDelete = isAdmin || (authorCanChange && item.voters.length <= 1);
  const mergedTarget = item.mergedInto
    ? items.find((i) => i.id === item.mergedInto)
    : undefined;
  const audience = new Set(
    [...item.voters.map((v) => v.split(":")[1]), item.userId].filter(
      (u) => u && u !== uid,
    ),
  ).size;
  const triageDirty =
    status !== item.status || response.trim() !== (item.response ?? "");

  const saveText = async () => {
    if (title.trim().length < 3 || description.trim().length < 10) {
      toast.error("Título com 3 ou mais caracteres e descrição com 10 ou mais.");
      return;
    }
    setBusy("text");
    try {
      await roadmapService.update(item.id, {
        title: title.trim(),
        description: description.trim(),
      });
      setEditing(false);
      onChanged();
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  };

  const saveTriage = async () => {
    setBusy("triage");
    try {
      const { notified } = await adminAction({
        action: "status",
        id: item.id,
        status,
        response,
      });
      toast.success(notifiedText(notified));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const merge = async () => {
    setBusy("merge");
    try {
      const { notified } = await adminAction({
        action: "merge",
        id: item.id,
        targetId: mergeTarget,
      });
      toast.success(notifiedText(notified));
      onChanged();
      onOpenItem(mergeTarget);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    try {
      await roadmapService.remove(item.id);
      toast.success(isAdmin ? "Item excluído." : "Sugestão retirada.");
      onClose();
      onChanged();
    } catch (e) {
      toast.error("Não foi possível excluir.");
      throw e;
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="gap-1 border-b px-6 py-5 pr-12">
          <p className="text-xs font-medium text-muted-foreground">
            {ROADMAP_STATUS_LABEL[item.status]}
            {item.status === "done" && item.doneAt && ` em ${fmt(item.doneAt)}`}
          </p>
          <SheetTitle className="text-lg leading-snug tracking-tight">
            {item.title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {(isAdmin || isAuthor) && item.authorName
              ? `Sugerida por ${item.authorName} em ${fmt(item.createdAt)}`
              : `Sugerida em ${fmt(item.createdAt)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-6 py-5">
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rm-title">Título</Label>
                <Input
                  id="rm-title"
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rm-desc">Descrição</Label>
                <Textarea
                  id="rm-desc"
                  value={description}
                  maxLength={1000}
                  rows={6}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveText} disabled={!!busy}>
                  {busy === "text" && <Loader2 className="size-4 animate-spin" />}
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={!!busy}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {item.description}
            </p>
          )}

          <div className="flex items-center gap-3">
            <VoteButton
              count={item.voters.length}
              voted={voted}
              disabled={!canVote}
              onClick={onVote}
            />
            <p className="text-sm text-muted-foreground">
              {canVote
                ? voted
                  ? "Você votou neste item."
                  : "Vote se isto também ajudaria você."
                : "A votação está encerrada para este item."}
              {isAdmin && (
                <span className="block text-xs tabular-nums">
                  {item.voters.length}{" "}
                  {item.voters.length === 1 ? "voto" : "votos"} de{" "}
                  {votingCompanies(item)}{" "}
                  {votingCompanies(item) === 1 ? "empresa" : "empresas"}
                </span>
              )}
            </p>
          </div>

          {item.response && (
            <div className="rounded-lg bg-muted/60 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                Resposta da equipe
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {item.response}
              </p>
            </div>
          )}

          {(mergedTarget || item.status === "done") && (
            <div className="flex flex-wrap gap-2">
              {mergedTarget && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenItem(mergedTarget.id)}
                >
                  Abrir &quot;{mergedTarget.title}&quot;
                </Button>
              )}
              {item.status === "done" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNovidadesOpen(true)}
                >
                  Ver em Novidades
                </Button>
              )}
            </div>
          )}

          {(canEdit || canDelete) && !editing && (
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Editar texto
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  {isAdmin ? "Excluir" : "Retirar sugestão"}
                </Button>
              )}
            </div>
          )}

          {isAdmin && !item.mergedInto && (
            <section className="space-y-5 border-t pt-5">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Triagem</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="rm-status">Situação</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as RoadmapStatus)}
                  >
                    <SelectTrigger id="rm-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROADMAP_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ROADMAP_STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {status === "in_progress" && item.status !== "in_progress" &&
                    item.status !== "done" && (
                      <p className="text-xs text-muted-foreground">
                        A partir daqui o item fica visível para todos os
                        clientes.
                      </p>
                    )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rm-response">Resposta da equipe</Label>
                  <Textarea
                    id="rm-response"
                    value={response}
                    maxLength={1000}
                    rows={3}
                    placeholder={
                      status === "declined"
                        ? "Explique por que não será feita"
                        : "Opcional. Aparece no item e na notificação."
                    }
                    onChange={(e) => setResponse(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={saveTriage}
                  disabled={
                    !triageDirty ||
                    !!busy ||
                    (status === "declined" && !response.trim())
                  }
                >
                  {busy === "triage" && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {audience > 0
                    ? `Salvar e avisar ${audience} ${audience === 1 ? "pessoa" : "pessoas"}`
                    : "Salvar"}
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rm-merge">Unir a outro item</Label>
                <p className="text-xs text-muted-foreground">
                  Para pedidos duplicados: os votos vão para o item escolhido e
                  este fica encerrado.
                </p>
                <div className="flex gap-2">
                  <Select value={mergeTarget} onValueChange={setMergeTarget}>
                    <SelectTrigger id="rm-merge" className="min-w-0 flex-1">
                      <SelectValue placeholder="Escolha o item que fica" />
                    </SelectTrigger>
                    <SelectContent>
                      {items
                        .filter(
                          (i) =>
                            i.id !== item.id &&
                            !i.mergedInto &&
                            i.status !== "declined",
                        )
                        .map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.title} · {ROADMAP_STATUS_LABEL[i.status]}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={merge}
                    disabled={!mergeTarget || !!busy}
                  >
                    {busy === "merge" && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    Unir
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>

        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={isAdmin ? "Excluir este item?" : "Retirar esta sugestão?"}
          description={
            isAdmin
              ? "O item e os votos somem para todos. Para duplicatas, prefira unir a outro item."
              : "A sugestão deixa de aparecer para a sua empresa."
          }
          confirmText={isAdmin ? "Excluir" : "Retirar"}
          variant="destructive"
          onConfirm={remove}
        />
      </SheetContent>
    </Sheet>
  );
}
