"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Search,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavBadges } from "@/components/layout/navItems";
import { usePermissions } from "@/hooks/usePermissions";
import { ROLE_DESCRIPTIONS } from "@/lib/constants/roleDescriptions";
import {
  CHAPTERS,
  CRITICAL_LIMITS,
  GLOSSARY,
  GOLDEN_RULES,
  ROLE_GUIDE,
  faqId,
  itemOf,
  type PlaybookItem,
  type PlaybookTopic,
} from "@/lib/playbook";
import type { UserRole } from "@/lib/types";
import { cn, normalizeText } from "@/lib/utils";

const ROLES = Object.keys(ROLE_GUIDE) as UserRole[];

const FOCUS =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/60";
const H2 = "text-2xl font-semibold tracking-tight";
/** Texto corrido: ~68 caracteres por linha. Glossário e TOC usam a largura toda. */
const PROSE = "max-w-[68ch]";
const BADGE_LABEL = {
  queue: "na fila",
  overdue: "vencidas",
  comprovantes: "pendentes",
} as const;

const GLOSSARY_AZ = [...GLOSSARY].sort((a, b) =>
  a.term.localeCompare(b.term, "pt-BR"),
);

const TOKEN = /(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

/** **negrito**, [[tecla]], `código` e [rótulo](rota): o conteúdo é nosso, não precisa de markdown inteiro. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        if (part.startsWith("**"))
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        if (part.startsWith("[["))
          return (
            <kbd
              key={i}
              className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground"
            >
              {part.slice(2, -2)}
            </kbd>
          );
        if (part.startsWith("`"))
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
            >
              {part.slice(1, -1)}
            </code>
          );
        const [, label, href] = LINK.exec(part)!;
        const cls = cn(
          "font-medium text-foreground underline decoration-foreground/40 underline-offset-4 hover:decoration-foreground",
          FOCUS,
        );
        return href.startsWith("/") ? (
          <Link key={i} href={href} className={cls}>
            {label}
          </Link>
        ) : (
          <a key={i} href={href} className={cls}>
            {label}
          </a>
        );
      })}
    </>
  );
}

/** Texto sem marcação, para a busca não casar com rota ou asteriscos. */
const plain = (s: string) =>
  s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*|\[\[|\]\]|`/g, "");

const topicIndex = new Map<string, string>(
  CHAPTERS.flatMap((c) => c.topics).map((t): [string, string] => [
    t.id,
    normalizeText(
      plain(
        [
          t.title,
          t.intro,
          ...(t.rules ?? []),
          ...(t.steps ?? []),
          ...(t.items ?? []).map((i) => itemOf(i).text),
          ...(t.faq ?? []).flatMap((f) => [f.q, f.a]),
        ]
          .filter(Boolean)
          .join(" "),
      ),
    ),
  ]),
);

const isMine = (it: PlaybookItem, role: UserRole | null) => {
  const roles = itemOf(it).roles;
  return !roles || !role || roles.includes(role);
};

function RulesBox({
  rules,
  label,
  warn,
  intro,
  footer,
  className,
}: {
  rules: string[];
  label: string;
  warn?: boolean;
  intro?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        warn
          ? "border-amber-300/70 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30"
          : "bg-muted/30",
        className,
      )}
    >
      <p
        className={cn(
          "mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
          warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground",
        )}
      >
        {warn && <TriangleAlert aria-hidden className="h-3.5 w-3.5" />}
        {label}
      </p>
      {intro && (
        <p className="mb-2.5 leading-relaxed">
          <Rich text={intro} />
        </p>
      )}
      <ul className="space-y-2">
        {rules.map((r, i) => (
          <li key={i} className="flex gap-2.5 leading-relaxed">
            <span
              aria-hidden
              className={cn(
                "mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full",
                warn ? "bg-amber-700 dark:bg-amber-400" : "bg-muted-foreground",
              )}
            />
            <span>
              <Rich text={r} />
            </span>
          </li>
        ))}
      </ul>
      {footer && <p className="mt-3 text-sm">{footer}</p>}
    </div>
  );
}

/** Abre sozinho durante a busca, sem fechar o que a pessoa abriu quando a busca acaba. */
function Faq({
  q,
  a,
  searching,
}: {
  q: string;
  a: string;
  searching: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (searching && ref.current) ref.current.open = true;
  }, [searching]);
  return (
    <details ref={ref} id={faqId(q)} className="group scroll-mt-4 px-4 py-3">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-start gap-2 font-medium [&::-webkit-details-marker]:hidden",
          FOCUS,
        )}
      >
        <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {q}
      </summary>
      <p className="mt-2 pl-5.5 leading-relaxed">
        <Rich text={a} />
      </p>
    </details>
  );
}

function Topic({
  topic,
  role,
  searching,
  showAll,
  badges,
}: {
  topic: PlaybookTopic;
  role: UserRole | null;
  searching: boolean;
  showAll: boolean;
  badges: ReturnType<typeof useNavBadges>;
}) {
  const mine = !!role && !!topic.roles?.includes(role);
  const items = topic.items?.filter((i) => showAll || isMine(i, role));
  return (
    <article id={topic.id} className={cn("scroll-mt-4 space-y-4", PROSE)}>
      <header className="space-y-1.5">
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          {topic.title}
          {mine && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              seu papel
            </span>
          )}
        </h3>
        {topic.roles && (
          <p className="text-sm text-muted-foreground">
            Quem faz:{" "}
            {topic.roles.map((r) => ROLE_DESCRIPTIONS[r].label).join(", ")}
          </p>
        )}
      </header>

      {topic.intro && (
        <p className="leading-relaxed">
          <Rich text={topic.intro} />
        </p>
      )}

      {topic.steps && (
        <ol className="space-y-2">
          {topic.steps.map((s, i) => (
            <li key={i} className="flex gap-3 leading-relaxed">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-foreground">
                {i + 1}
              </span>
              <span>
                <Rich text={s} />
              </span>
            </li>
          ))}
        </ol>
      )}

      {items && (
        <ul className="space-y-2">
          {items.map((it, i) => {
            const item = itemOf(it);
            const count = item.badge ? badges[item.badge] : undefined;
            return (
              <li key={i} className="flex gap-3 leading-relaxed">
                <span
                  aria-hidden
                  className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
                />
                <span>
                  <Rich text={item.text} />
                  {count !== undefined && (
                    <span
                      className={cn(
                        "ml-2 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                        item.badge === "overdue" && count > 0
                          ? "bg-destructive/10 text-red-700 dark:text-red-300"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {count} {BADGE_LABEL[item.badge!]}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {topic.rules && (
        <RulesBox
          rules={topic.rules}
          label={topic.rulesLabel ?? "Regras"}
          warn={topic.tone === "warning"}
        />
      )}

      {topic.faq && (
        <div className="divide-y rounded-lg border">
          {topic.faq.map((f) => (
            <Faq key={f.q} q={f.q} a={f.a} searching={searching} />
          ))}
        </div>
      )}

      {topic.links && (
        <div className="flex flex-wrap gap-2">
          {topic.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors hover:bg-muted",
                FOCUS,
              )}
            >
              {l.label}
              <ArrowRight
                aria-hidden
                className="h-3.5 w-3.5 text-muted-foreground"
              />
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

function RoleCard({
  role,
  highlight,
}: {
  role: UserRole;
  highlight?: boolean;
}) {
  const guide = ROLE_GUIDE[role];
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4",
        highlight && "border-primary/40 bg-primary/5",
      )}
    >
      <div>
        <p className="font-semibold">{ROLE_DESCRIPTIONS[role].label}</p>
        <p className="text-sm text-muted-foreground">
          {ROLE_DESCRIPTIONS[role].description}
        </p>
      </div>
      <ul className="space-y-1.5 text-sm">
        {guide.does.map((d, i) => (
          <li key={i} className="flex gap-2">
            <Check
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
            />
            <span>{d}</span>
          </li>
        ))}
        {guide.cannot.map((d, i) => (
          <li key={`n${i}`} className="flex gap-2 text-muted-foreground">
            <X aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{d}</span>
          </li>
        ))}
      </ul>
      {guide.note && <p className="text-sm">{guide.note}</p>}
    </div>
  );
}

interface TocEntry {
  id: string;
  title: string;
  topics?: { id: string; title: string }[];
}

/** Seção sob a faixa de leitura do topo é a atual. */
function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState<string>();
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const next = ids.find((id) => visible.has(id));
        if (next) setActive(next);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function Toc({
  entries,
  active,
  onPick,
}: {
  entries: TocEntry[];
  active?: string;
  onPick?: () => void;
}) {
  return (
    <nav aria-label="Capítulos do manual" className="space-y-0.5 text-sm">
      {entries.map((e) => {
        const on = e.id === active;
        return (
          <Fragment key={e.id}>
            <a
              href={`#${e.id}`}
              onClick={onPick}
              aria-current={on ? "location" : undefined}
              className={cn(
                "block rounded-md px-2 py-1 hover:bg-muted hover:text-foreground",
                FOCUS,
                on
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {e.title}
            </a>
            {on && e.topics && e.topics.length > 1 && (
              <ul className="mb-1 ml-3 space-y-0.5">
                {e.topics.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      onClick={onPick}
                      className={cn(
                        "block rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground",
                        FOCUS,
                      )}
                    >
                      {t.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export function PlaybookView() {
  const permissions = usePermissions();
  const { currentRole } = permissions;
  const badges = useNavBadges(permissions);
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [allRoles, setAllRoles] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const q = normalizeText(query.trim());
  const showAll = allRoles || !!q || !currentRole;

  const onQuery = (v: string) => {
    setQuery(v);
    const url = new URL(window.location.href);
    if (v.trim()) url.searchParams.set("q", v);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  };

  // #cap-x, #topico e #faq-x: abre a pergunta e rola até lá. O navegador não
  // faz isso sozinho porque o conteúdo só existe depois da hidratação.
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView();
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  const goldenHits = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    return GOLDEN_RULES.map((r, i) => ({ r, i })).filter(({ r }) => {
      const t = normalizeText(plain(r));
      return words.every((w) => t.includes(w));
    });
  }, [q]);

  const chapters = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    const found = q
      ? CHAPTERS.map((c) => ({
          ...c,
          topics: c.topics.filter((t) => {
            const text = topicIndex.get(t.id)!;
            return words.every((w) => text.includes(w));
          }),
        })).filter((c) => c.topics.length)
      : CHAPTERS;
    // Rotina de outro papel sai da página; o capítulo fica para explicar.
    return found.map((c) => ({
      ...c,
      topics: c.topics.filter(
        (t) =>
          showAll || !t.items || t.items.some((i) => isMine(i, currentRole)),
      ),
    }));
  }, [q, showAll, currentRole]);

  const glossary = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean);
    return GLOSSARY_AZ.filter((g) => {
      const t = normalizeText(`${g.term} ${g.meaning}`);
      return words.every((w) => t.includes(w));
    });
  }, [q]);

  const otherRoles = currentRole
    ? CHAPTERS.find((c) => c.id === "rotina")!
        .topics.flatMap((t) => t.items ?? [])
        .filter((i) => !isMine(i, currentRole)).length
    : 0;

  const total =
    chapters.reduce((n, c) => n + c.topics.length, 0) +
    glossary.length +
    (q ? goldenHits.length : 0);

  const toc = useMemo<TocEntry[]>(
    () => [
      ...(goldenHits.length
        ? [{ id: "regras-de-ouro", title: "Regras de ouro" }]
        : []),
      ...(!q ? [{ id: "papeis", title: "Papéis" }] : []),
      ...chapters
        .filter((c) => c.topics.length)
        .map((c) => ({
          id: `cap-${c.id}`,
          title: c.title,
          topics: c.topics.map((t) => ({ id: t.id, title: t.title })),
        })),
      ...(glossary.length ? [{ id: "glossario", title: "Glossário" }] : []),
    ],
    [goldenHits, q, chapters, glossary],
  );
  const active = useScrollSpy(useMemo(() => toc.map((e) => e.id), [toc]));

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <aside className="hidden lg:block">
        <div className="sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
          <Toc entries={toc} active={active} />
        </div>
      </aside>

      <div className="min-w-0 space-y-12">
        <header className={cn("space-y-4", PROSE)}>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Manual de operação
            </h1>
            <p className="text-muted-foreground">
              As regras do jogo: o que cada pessoa faz, em que ordem e por quê.
              Escrito para quem nunca trabalhou com financeiro.
            </p>
          </div>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="O que você quer fazer? Ex.: dar baixa, lote, comprovante, competência"
              aria-label="Buscar no manual"
              className="pl-9"
            />
          </div>
          {q && (
            <p role="status" className="text-sm text-muted-foreground">
              {total ? (
                `${total} ${total === 1 ? "resultado" : "resultados"} para “${query.trim()}”.`
              ) : (
                <>
                  Nada encontrado para &ldquo;{query.trim()}&rdquo;. Tente outra
                  palavra ou mande a dúvida em{" "}
                  <Link
                    href="/feedback"
                    className={cn("underline underline-offset-4", FOCUS)}
                  >
                    Enviar feedback
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </header>

        <details
          open={tocOpen}
          onToggle={(e) => setTocOpen(e.currentTarget.open)}
          className="group rounded-lg border lg:hidden"
        >
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium [&::-webkit-details-marker]:hidden",
              FOCUS,
            )}
          >
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"
            />
            Neste manual
          </summary>
          <div className="px-2 pb-3">
            <Toc
              entries={toc}
              active={active}
              onPick={() => setTocOpen(false)}
            />
          </div>
        </details>

        {goldenHits.length > 0 && (
          <section id="regras-de-ouro" className="scroll-mt-4 space-y-4">
            <h2 className={H2}>Regras de ouro</h2>
            <ol className={cn("space-y-3", PROSE)}>
              {goldenHits.map(({ r, i }) => (
                <li key={i} className="flex gap-3 leading-relaxed">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground">
                    {i + 1}
                  </span>
                  <span>
                    <Rich text={r} />
                  </span>
                </li>
              ))}
            </ol>
            {!q && (
              <RulesBox
                warn
                label="Sem trava no sistema"
                intro="Três destas regras dependem só de você: o sistema ainda deixa quebrá-las."
                rules={CRITICAL_LIMITS}
                footer={
                  <Rich text="[Ver todos os limites conhecidos](#cap-limites)" />
                }
                className={PROSE}
              />
            )}
          </section>
        )}

        {!q && (
          <section id="papeis" className="scroll-mt-4 space-y-4">
            <h2 className={H2}>Papéis</h2>
            <p className={cn("text-muted-foreground", PROSE)}>
              Cada pessoa tem um papel por empresa. O menu mostra só o que o seu
              papel permite.
            </p>
            {currentRole && <RoleCard role={currentRole} highlight />}
            <details className="group rounded-lg border">
              <summary
                className={cn(
                  "flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium [&::-webkit-details-marker]:hidden",
                  FOCUS,
                )}
              >
                <ChevronRight
                  aria-hidden
                  className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"
                />
                Ver todos os papéis
              </summary>
              <div className="grid gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
                {ROLES.filter((r) => r !== currentRole).map((r) => (
                  <RoleCard key={r} role={r} />
                ))}
              </div>
            </details>
          </section>
        )}

        {chapters.map((c) => {
          const routine = c.id === "rotina";
          if (!c.topics.length && !(routine && !q)) return null;
          return (
            <section
              key={c.id}
              id={`cap-${c.id}`}
              className="scroll-mt-4 space-y-8 border-t pt-10"
            >
              <div className={cn("space-y-1.5", PROSE)}>
                <h2 className={cn(H2, "flex items-center gap-2")}>
                  {c.id === "limites" && (
                    <ShieldAlert
                      aria-hidden
                      className="h-6 w-6 text-amber-700 dark:text-amber-400"
                    />
                  )}
                  {c.title}
                </h2>
                <p className="text-muted-foreground">
                  <Rich text={c.summary} />
                </p>
                {routine && !q && currentRole && otherRoles > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {allRoles
                      ? "Mostrando as tarefas de todos os papéis. "
                      : "Mostrando só as tarefas do seu papel. "}
                    <button
                      type="button"
                      onClick={() => setAllRoles((v) => !v)}
                      className={cn(
                        "font-medium text-foreground underline underline-offset-4",
                        FOCUS,
                      )}
                    >
                      {allRoles
                        ? "Mostrar só as minhas"
                        : `Mostrar todas (${otherRoles} a mais)`}
                    </button>
                  </p>
                )}
              </div>
              {routine && !c.topics.length && (
                <p className={PROSE}>
                  Nenhuma tarefa recorrente é do seu papel. Use o botão acima
                  para ver a rotina dos outros.
                </p>
              )}
              {c.topics.map((t) => (
                <Topic
                  key={t.id}
                  topic={t}
                  role={currentRole}
                  searching={!!q}
                  showAll={showAll}
                  badges={badges}
                />
              ))}
            </section>
          );
        })}

        {glossary.length > 0 && (
          <section
            id="glossario"
            className="scroll-mt-4 space-y-4 border-t pt-10"
          >
            <h2 className={H2}>Glossário</h2>
            <dl className="border-t xl:columns-2 xl:gap-x-10">
              {glossary.map((g) => (
                <div
                  key={g.term}
                  className="grid break-inside-avoid gap-1 border-b px-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className="font-medium">{g.term}</dt>
                  <dd className="text-muted-foreground">{g.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
