"use client";

import { useState, useEffect } from "react";
import { Bell, ArrowRight } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { notificationService } from "@/lib/services/notificationService";
import { Notification } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const DOT_CLASS: Record<Notification["type"], string> = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  error: "bg-destructive",
};

export function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isOpen, setIsOpen] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const fetchNotifications = async () => {
      if (!user) return;
      try {
        const [data, count] = await Promise.all([
          notificationService.getUserNotifications(user.uid),
          notificationService.getUnreadCount(user.uid),
        ]);
        setNotifications(data);
        setUnreadCount(count);
        setStatus("ready");
      } catch (e) {
        console.error("Error loading notifications:", e);
        setStatus("error");
      }
    };

    fetchNotifications();
    // Poll every minute for new notifications
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [user, reloadKey]);

  const handleMarkAsRead = async (id: string) => {
    await notificationService.markAsRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    try {
      await notificationService.markAllAsRead(user.uid);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error("Error marking notifications as read:", e);
      toast.error("Não foi possível marcar como lidas.");
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      try {
        await handleMarkAsRead(notification.id);
      } catch (e) {
        console.error("Error marking notification as read:", e);
      }
    }
    if (notification.link) {
      setIsOpen(false);
      router.push(notification.link);
    }
  };

  // "Aguardando você": avisos de ação (type warning) ainda não lidos.
  const awaiting = notifications.filter((n) => n.type === "warning" && !n.read);
  const activity = notifications.filter((n) => !awaiting.includes(n));
  const groups = [
    { label: "Aguardando você", items: awaiting },
    { label: "Atividade", items: activity },
  ].filter((g) => g.items.length > 0);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notificações, ${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`
              : "Notificações"
          }
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              aria-hidden
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full p-0 text-xs"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <h4 className="text-sm font-semibold">Notificações</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-auto px-1.5 py-1"
              onClick={handleMarkAllAsRead}
            >
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {status === "loading" ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          ) : status === "error" && notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <p>Não foi possível carregar as notificações.</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-auto px-1.5 py-1 text-xs"
                onClick={() => {
                  setStatus("loading");
                  setReloadKey((k) => k + 1);
                }}
              >
                Tentar de novo
              </Button>
            </div>
          ) : notifications.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma notificação.
            </p>
          ) : (
            groups.map(({ label, items }) => (
              <section key={label}>
                {groups.length > 1 && (
                  <h5 className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
                    {label}
                  </h5>
                )}
                <ul className="divide-y">
                  {items.map((notification) => (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                          !notification.read && "bg-muted/20",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            notification.read
                              ? "bg-transparent"
                              : (DOT_CLASS[notification.type] ??
                                  DOT_CLASS.info),
                          )}
                        />
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span
                            className={cn(
                              "block text-sm leading-snug",
                              notification.read
                                ? "text-muted-foreground"
                                : "font-medium",
                            )}
                          >
                            {notification.title}
                          </span>
                          <span className="block text-sm text-muted-foreground line-clamp-2">
                            {notification.message}
                          </span>
                          <span className="block text-xs text-muted-foreground/80">
                            {formatDistanceToNow(notification.createdAt, {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        </span>
                        {!notification.read && (
                          <span className="sr-only">Não lida</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="border-t p-1">
          <Link
            href="/notificacoes"
            onClick={() => setIsOpen(false)}
            className="flex items-center justify-center gap-1.5 w-full rounded-sm py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
          >
            Abrir central de notificações
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
