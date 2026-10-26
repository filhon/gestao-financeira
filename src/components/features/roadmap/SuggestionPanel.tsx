"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { roadmapService } from "@/lib/services/roadmapService";
import {
  ROADMAP_STATUS_LABEL,
  VOTABLE_STATUSES,
  type RoadmapItem,
} from "@/lib/roadmap";
import type { UserProfile } from "@/lib/types";
import { VoteButton } from "./RoadmapItemPanel";

const formSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "O título deve ter pelo menos 3 caracteres")
    .max(100, "O título deve ter no máximo 100 caracteres"),
  description: z
    .string()
    .trim()
    .min(10, "A descrição deve ter pelo menos 10 caracteres")
    .max(1000, "A descrição deve ter no máximo 1000 caracteres"),
});

interface SuggestionPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  user: UserProfile;
  items: RoadmapItem[];
  hasVoted: (item: RoadmapItem) => boolean;
  onVote: (item: RoadmapItem) => void;
  onOpenItem: (id: string) => void;
  onCreated: (id: string) => void;
}

export function SuggestionPanel({
  open,
  onOpenChange,
  companyId,
  user,
  items,
  hasVoted,
  onVote,
  onOpenItem,
  onCreated,
}: SuggestionPanelProps) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", description: "" },
  });
  const [similarIds, setSimilarIds] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  // Procura pedidos parecidos quando a pessoa para de digitar o título
  const title = form.watch("title").trim();
  const description = form.watch("description").trim();
  useEffect(() => {
    if (!open || title.length < 8) {
      setSimilarIds([]);
      setChecking(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch("/api/internal/roadmap/similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            text: `${title}\n${description}`,
          }),
          signal: controller.signal,
        });
        const json = await res.json();
        setSimilarIds(Array.isArray(json.ids) ? json.ids : []);
      } catch {
        // Abortado ou falhou: segue sem sugestões
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 900);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, title, description, companyId]);

  const similar = similarIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is RoadmapItem => !!i);

  const close = (next: boolean) => {
    if (!next) {
      form.reset();
      setSimilarIds([]);
    }
    onOpenChange(next);
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const id = await roadmapService.create({
        ...values,
        companyId,
        userId: user.uid,
        authorName: (user.displayName || user.email.split("@")[0]).slice(
          0,
          100,
        ),
      });
      toast.success("Sugestão enviada. Você será avisado quando ela andar.");
      close(false);
      onCreated(id);
    } catch {
      toast.error("Erro ao enviar sugestão. Tente novamente.");
    }
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="text-lg tracking-tight">
            Nova sugestão
          </SheetTitle>
          <SheetDescription>
            Só a sua empresa vê a sugestão até ela entrar em execução. Você é
            avisado a cada mudança de situação.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5 px-6 py-5"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>O que você precisa?</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: Avisar o fornecedor quando o pagamento sair"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {(checking || similar.length > 0) && (
              <div aria-live="polite" className="rounded-lg border">
                <p className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  {checking && <Loader2 className="size-3.5 animate-spin" />}
                  {checking && similar.length === 0
                    ? "Procurando pedidos parecidos"
                    : "Já pediram algo parecido. Se for o mesmo, vote em vez de criar outro."}
                </p>
                <ul className="divide-y">
                  {similar.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 px-3 py-2.5"
                    >
                      <VoteButton
                        count={item.voters.length}
                        voted={hasVoted(item)}
                        disabled={!VOTABLE_STATUSES.includes(item.status)}
                        onClick={() => onVote(item)}
                      />
                      <button
                        type="button"
                        onClick={() => onOpenItem(item.id)}
                        className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block truncate text-sm font-medium">
                          {item.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ROADMAP_STATUS_LABEL[item.status]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Como isso ajudaria no seu dia?</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Conte a situação em que você sente falta disso e o que faz hoje para contornar."
                      rows={6}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    O problema importa mais que a solução: ajuda a equipe a
                    acertar no que construir.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Enviar sugestão
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
