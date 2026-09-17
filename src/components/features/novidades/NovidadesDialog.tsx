"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { differenceInDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGlobalStore } from "@/lib/store/useGlobalStore";
import { useAuth } from "@/components/providers/AuthProvider";
import type { NovidadeRelease, NovidadeSection } from "@/lib/novidades";

const STORAGE_KEY = "novidades-seen";
// Por quantos dias após a data da atualização o pill "Novo" fica visível
const NEW_FOR_DAYS = 7;

interface NovidadesDialogProps {
  releases: NovidadeRelease[];
  // Hash do conteúdo de docs/NOVIDADES.md — muda sempre que o arquivo muda
  version: string;
}

export function NovidadesDialog({ releases, version }: NovidadesDialogProps) {
  const open = useGlobalStore((s) => s.novidadesOpen);
  const setOpen = useGlobalStore((s) => s.setNovidadesOpen);
  const setNovidadesNew = useGlobalStore((s) => s.setNovidadesNew);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const latestDate = releases[0]?.date ?? null;

  // Abre sozinho no primeiro acesso após cada mudança no arquivo. Só para
  // usuário logado: o layout raiz também envolve landing, login e magic links.
  useEffect(() => {
    if (!user) return;
    setNovidadesNew(
      !!latestDate &&
        differenceInDays(new Date(), new Date(latestDate)) <= NEW_FOR_DAYS,
    );
    try {
      if (localStorage.getItem(STORAGE_KEY) !== version) setOpen(true);
    } catch {}
  }, [user, version, latestDate, setOpen, setNovidadesNew]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      try {
        localStorage.setItem(STORAGE_KEY, version);
      } catch {}
    }
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        // Foco inicial na área rolável, não no primeiro "Saiba mais": evita o
        // anel de foco ao abrir sozinho e deixa as setas do teclado rolarem
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          scrollRef.current?.focus();
        }}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="border-b px-6 py-5 sm:px-8">
          <DialogTitle className="text-base font-semibold tracking-tight">
            Novidades
          </DialogTitle>
        </DialogHeader>

        <div
          ref={scrollRef}
          tabIndex={-1}
          className="overflow-y-auto outline-none"
        >
          {releases.map((release) => (
            <ReleaseRow key={release.title} release={release} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseRow({ release }: { release: NovidadeRelease }) {
  const count = release.sections.length;
  return (
    <section className="grid gap-x-8 gap-y-4 border-b px-6 py-6 last:border-b-0 sm:grid-cols-[8.5rem_1fr] sm:px-8">
      <div className="self-start sm:sticky sm:top-6">
        {release.date ? (
          <time
            dateTime={release.date}
            className="text-sm font-medium tabular-nums text-foreground"
          >
            {format(new Date(release.date), "d MMM yyyy", { locale: ptBR })}
          </time>
        ) : (
          <span className="text-sm font-medium text-foreground">
            {release.title}
          </span>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {count} {count === 1 ? "novidade" : "novidades"}
        </p>
      </div>

      <ol className="divide-y">
        {release.sections.map((section) => (
          <NovidadeItem key={section.title} {...section} />
        ))}
      </ol>
    </section>
  );
}

function NovidadeItem({ title, summary, details }: NovidadeSection) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="py-5 first:pt-0 last:pb-0">
      <h3 className="text-[15px] font-semibold leading-snug tracking-tight">
        {title}
      </h3>
      <div className="prose prose-sm dark:prose-invert mt-1.5 max-w-[65ch]">
        <ReactMarkdown>{summary}</ReactMarkdown>
      </div>
      {details && (
        <>
          <Button
            variant="link"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 h-auto px-0 has-[>svg]:px-0"
          >
            {expanded ? "Mostrar menos" : "Saiba mais"}
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </Button>
          {expanded && (
            <div className="prose prose-sm dark:prose-invert mt-3 max-w-[65ch] animate-in fade-in-0 duration-200 motion-reduce:animate-none">
              <ReactMarkdown>{details}</ReactMarkdown>
            </div>
          )}
        </>
      )}
    </li>
  );
}
