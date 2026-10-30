"use client";

import { useState, useMemo } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { notificationService } from "@/lib/services/notificationService";
import { Notification } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  differenceInCalendarDays,
  format,
  formatDistanceToNow,
  isToday,
  isYesterday,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  Check,
  Bell,
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Notification type metadata ──────────────────────────────────────────────

const TYPE_CONFIG = {
  info: { icon: Info, iconClass: "text-blue-500", dotClass: "bg-blue-500" },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500",
    dotClass: "bg-amber-500",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-emerald-500",
    dotClass: "bg-emerald-500",
  },
  error: {
    icon: XCircle,
    iconClass: "text-destructive",
    dotClass: "bg-destructive",
  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function getDateGroup(date: Date): string {
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  if (differenceInCalendarDays(new Date(), date) < 7) return "Esta semana";
  const month = format(date, "MMMM 'de' yyyy", { locale: ptBR });
  return month.charAt(0).toUpperCase() + month.slice(1);
}

// Relativo só enquanto recente; depois disso o operador precisa da data.
function formatWhen(date: Date): string {
  return differenceInCalendarDays(new Date(), date) < 7
    ? formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
    : format(date, "dd/MM/yyyy");
}

interface Thread {
  key: string;
  name?: string; // nome do lote, quando a linha agrupa eventos de um lote
  events: Notification[]; // do mais recente para o mais antigo
}

// Eventos do mesmo lote viram uma linha só; os demais ficam avulsos.
function groupByThread(notifications: Notification[]): Thread[] {
  const map = new Map<string, Thread>();
  for (const n of notifications) {
    // Pelo nome do lote entre aspas na mensagem: vale para o histórico, cujo
    // link nem sempre é o mesmo entre os eventos do lote.
    const name = n.title.startsWith("Lote")
      ? n.message.match(/"([^"]+)"/)?.[1]
      : undefined;
    const key = name ? `lote:${name}` : n.id;
    const thread = map.get(key);
    if (thread) thread.events.push(n);
    else map.set(key, { key, name, events: [n] });
  }
  return [...map.values()];
}

function groupByPeriod(threads: Thread[]) {
  const map = new Map<string, Thread[]>();
  for (const t of threads) {
    const label = getDateGroup(t.events[0].createdAt);
    map.set(label, [...(map.get(label) ?? []), t]);
  }
  return [...map].map(([label, items]) => ({ label, items }));
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <Skeleton className="h-4 w-4 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const NO_NOTIFICATIONS: Notification[] = [];

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [limitCount, setLimitCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Em cache: voltar à tela mostra a lista na hora e revalida em segundo plano.
  const queryClient = useQueryClient();
  const notificationsKey = ["notifications", user?.uid, limitCount];
  const {
    data: notifications = NO_NOTIFICATIONS,
    isPending: loading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: notificationsKey,
    queryFn: () =>
      notificationService.getUserNotifications(user!.uid, limitCount),
    enabled: !!user,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const setNotifications = (update: (prev: Notification[]) => Notification[]) =>
    queryClient.setQueryData<Notification[]>(notificationsKey, (prev) =>
      update(prev ?? []),
    );

  const markRead = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => notificationService.markAsRead(id)));
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
      );
    } catch (e) {
      console.error("Error marking notification as read:", e);
      toast.error("Não foi possível marcar como lida.");
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    try {
      await notificationService.markAllAsRead(user.uid);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      console.error("Error marking notifications as read:", e);
      toast.error("Não foi possível marcar como lidas.");
    }
  };

  const handleThreadClick = async (thread: Thread) => {
    const unreadIds = thread.events.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length > 0) await markRead(unreadIds);
    const link = thread.events[0].link;
    if (link) router.push(link);
  };

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasMore = notifications.length >= limitCount;

  const groups = useMemo(
    () =>
      groupByPeriod(
        groupByThread(
          filter === "unread"
            ? notifications.filter((n) => !n.read)
            : notifications,
        ),
      ),
    [notifications, filter],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Notificações
          </h1>
          <p className="text-muted-foreground">
            Histórico de eventos. O que precisa de você agora está em Minha
            fila.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            onClick={handleMarkAllAsRead}
            variant="outline"
            className="shrink-0"
          >
            <Check className="mr-2 h-4 w-4" />
            Marcar todas como lidas
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div role="tablist" className="flex items-center gap-1 border-b">
        {(["all", "unread"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={filter === tab}
            onClick={() => setFilter(tab)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              filter === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "all" ? "Todas" : "Não lidas"}
            {tab === "unread" && unreadCount > 0 && (
              <Badge
                variant="secondary"
                className="h-5 min-w-5 px-1.5 text-[10px] font-semibold"
              >
                {unreadCount}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="divide-y rounded-lg border">
          {Array.from({ length: 6 }).map((_, i) => (
            <NotificationSkeleton key={i} />
          ))}
        </div>
      ) : isError && notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-16 text-sm text-muted-foreground">
          <p>Não foi possível carregar as notificações.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16 text-muted-foreground">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Bell className="h-6 w-6 opacity-40" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {filter === "unread"
              ? "Nenhuma notificação não lida"
              : "Você não tem notificações"}
          </p>
          <p className="mt-1 text-xs">
            {filter === "unread"
              ? "Você está em dia com tudo."
              : "Novidades do sistema aparecerão aqui."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(({ label, items }) => (
            <section key={label} className="space-y-1">
              <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </h2>
              <ul className="divide-y rounded-lg border">
                {items.map((thread) => {
                  const latest = thread.events[0];
                  const config = TYPE_CONFIG[latest.type] ?? TYPE_CONFIG.info;
                  const Icon = config.icon;
                  const unreadIds = thread.events
                    .filter((n) => !n.read)
                    .map((n) => n.id);
                  const isUnread = unreadIds.length > 0;
                  const older = thread.events.slice(1);
                  const isOpen = expanded.has(thread.key);

                  return (
                    <li
                      key={thread.key}
                      className={cn(isUnread && "bg-muted/30")}
                    >
                      <div className="flex items-start">
                        <button
                          type="button"
                          onClick={() => handleThreadClick(thread)}
                          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              isUnread ? config.dotClass : "bg-transparent",
                            )}
                          />
                          <Icon
                            aria-hidden
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              isUnread
                                ? config.iconClass
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-sm",
                                isUnread
                                  ? "font-semibold text-foreground"
                                  : "font-medium text-foreground/80",
                              )}
                            >
                              {thread.name ?? latest.title}
                              {isUnread && (
                                <span className="sr-only"> (não lida)</span>
                              )}
                            </span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {thread.name ? latest.title : latest.message}
                            </span>
                          </span>
                          <time
                            dateTime={latest.createdAt.toISOString()}
                            title={format(
                              latest.createdAt,
                              "dd/MM/yyyy 'às' HH:mm",
                            )}
                            className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
                          >
                            {formatWhen(latest.createdAt)}
                          </time>
                        </button>
                        {isUnread && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Marcar como lida"
                            title="Marcar como lida"
                            className="mr-1 mt-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                            onClick={() => markRead(unreadIds)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {older.length > 0 && (
                        <div className="pb-2 pl-11 pr-3">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleExpanded(thread.key)}
                            className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                isOpen && "rotate-180",
                              )}
                            />
                            {isOpen
                              ? "Ocultar histórico do lote"
                              : `Mais ${older.length} ${older.length === 1 ? "evento" : "eventos"} neste lote`}
                          </button>
                          {isOpen && (
                            <ul className="mt-1.5 space-y-1">
                              {older.map((n) => (
                                <li
                                  key={n.id}
                                  className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground"
                                >
                                  <span className="min-w-0 truncate">
                                    {n.title}
                                  </span>
                                  <time
                                    dateTime={n.createdAt.toISOString()}
                                    className="shrink-0 tabular-nums"
                                  >
                                    {format(n.createdAt, "dd/MM/yyyy HH:mm")}
                                  </time>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={isFetching}
                onClick={() => setLimitCount((n) => n + PAGE_SIZE)}
              >
                {isFetching ? "Carregando…" : "Carregar mais"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
