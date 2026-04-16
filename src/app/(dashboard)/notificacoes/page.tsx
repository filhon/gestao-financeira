"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { notificationService } from "@/lib/services/notificationService";
import { Notification } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  Check,
  Bell,
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Notification type metadata ──────────────────────────────────────────────

const TYPE_CONFIG = {
  info: {
    icon: Info,
    iconClass: "text-blue-500",
    bgClass: "bg-blue-50 dark:bg-blue-950/40",
    dotClass: "bg-blue-500",
    stripClass: "bg-blue-500",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500",
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
    dotClass: "bg-amber-500",
    stripClass: "bg-amber-500",
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-emerald-500",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
    dotClass: "bg-emerald-500",
    stripClass: "bg-emerald-500",
  },
  error: {
    icon: XCircle,
    iconClass: "text-destructive",
    bgClass: "bg-destructive/5",
    dotClass: "bg-destructive",
    stripClass: "bg-destructive",
  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDateGroup(date: Date): string {
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  return "Anteriores";
}

function groupNotifications(notifications: Notification[]) {
  const order = ["Hoje", "Ontem", "Anteriores"];
  const map: Record<string, Notification[]> = {};

  for (const n of notifications) {
    const group = getDateGroup(n.createdAt);
    if (!map[group]) map[group] = [];
    map[group].push(n);
  }

  return order
    .filter((g) => map[g]?.length)
    .map((g) => ({ label: g, items: map[g] }));
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-4">
        <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      const data = await notificationService.getUserNotifications(user.uid, 50);
      setNotifications(data);
      setLoading(false);
    };
    load();
  }, [user]);

  const handleMarkAsRead = async (id: string) => {
    await notificationService.markAsRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    await notificationService.markAllAsRead(user.uid);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) await handleMarkAsRead(notification.id);
    if (notification.link) router.push(notification.link);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filtered = useMemo(
    () =>
      filter === "unread"
        ? notifications.filter((n) => !n.read)
        : notifications,
    [notifications, filter],
  );

  const groups = useMemo(() => groupNotifications(filtered), [filtered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
          <p className="text-muted-foreground">
            Fique por dentro das atualizações do sistema.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button onClick={handleMarkAllAsRead} variant="outline">
            <Check className="mr-2 h-4 w-4" />
            Marcar todas como lidas
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "0ms", animationFillMode: "both" }}
      >
        <div className="flex items-center gap-1 border-b pb-0">
          {(["all", "unread"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
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
      </div>

      {/* Content */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "60ms", animationFillMode: "both" }}
      >
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <NotificationSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                <Bell className="h-6 w-6 opacity-40" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {filter === "unread"
                  ? "Nenhuma notificação não lida"
                  : "Você não tem notificações"}
              </p>
              <p className="text-xs mt-1">
                {filter === "unread"
                  ? "Você está em dia com tudo."
                  : "Novidades do sistema aparecerão aqui."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {groups.map(({ label, items }) => (
              <div key={label} className="space-y-2">
                {/* Group label */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                  {label}
                </p>

                {/* Notification cards */}
                <div className="space-y-2">
                  {items.map((notification) => {
                    const config =
                      TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.info;
                    const Icon = config.icon;
                    const isUnread = !notification.read;

                    return (
                      <Card
                        key={notification.id}
                        className={cn(
                          "relative overflow-hidden cursor-pointer transition-colors hover:bg-muted/50",
                          isUnread && "border-l-4 border-l-primary",
                        )}
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <CardContent className="flex items-start gap-4 p-4">
                          {/* Icon */}
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                              config.bgClass,
                            )}
                          >
                            <Icon className={cn("h-4 w-4", config.iconClass)} />
                          </div>

                          {/* Body */}
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p
                              className={cn(
                                "text-sm font-semibold leading-tight",
                                isUnread
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {notification.title}
                            </p>
                            <p className="text-sm text-muted-foreground leading-snug">
                              {notification.message}
                            </p>
                            <div className="flex items-center gap-3 pt-1">
                              <span className="text-xs text-muted-foreground/70">
                                {formatDistanceToNow(notification.createdAt, {
                                  addSuffix: true,
                                  locale: ptBR,
                                })}
                              </span>
                              {notification.link && (
                                <span className="flex items-center gap-1 text-xs text-primary">
                                  <ExternalLink className="h-3 w-3" />
                                  Ver detalhes
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            {isUnread && (
                              <>
                                <div
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    config.dotClass,
                                  )}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMarkAsRead(notification.id);
                                  }}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
