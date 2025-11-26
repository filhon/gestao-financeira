"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { notificationService } from "@/lib/services/notificationService";
import { Notification } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Check, Bell } from "lucide-react";
import { useRouter } from "next/navigation";

export default function NotificationsPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);

    const loadNotifications = async () => {
        if (user) {
            setLoading(true);
            const data = await notificationService.getUserNotifications(user.uid, 50);
            setNotifications(data);
            setLoading(false);
        }
    };

    useEffect(() => {
        loadNotifications();
    }, [user]);

    const handleMarkAsRead = async (id: string) => {
        await notificationService.markAsRead(id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const handleMarkAllAsRead = async () => {
        if (user) {
            await notificationService.markAllAsRead(user.uid);
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        }
    };

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.read) {
            await handleMarkAsRead(notification.id);
        }
        if (notification.link) {
            router.push(notification.link);
        }
    };

    if (loading) {
        return <div className="p-8 text-center">Carregando notificações...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Notificações</h1>
                    <p className="text-muted-foreground">
                        Fique por dentro das atualizações do sistema.
                    </p>
                </div>
                {notifications.some(n => !n.read) && (
                    <Button onClick={handleMarkAllAsRead} variant="outline">
                        <Check className="mr-2 h-4 w-4" />
                        Marcar todas como lidas
                    </Button>
                )}
            </div>

            <div className="grid gap-4">
                {notifications.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Bell className="h-12 w-12 mb-4 opacity-20" />
                            <p>Você não tem notificações.</p>
                        </CardContent>
                    </Card>
                ) : (
                    notifications.map((notification) => (
                        <Card
                            key={notification.id}
                            className={cn(
                                "cursor-pointer transition-colors hover:bg-muted/50",
                                !notification.read && "border-l-4 border-l-primary"
                            )}
                            onClick={() => handleNotificationClick(notification)}
                        >
                            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                                <div className="space-y-1">
                                    <CardTitle className={cn("text-base", !notification.read && "text-primary")}>
                                        {notification.title}
                                    </CardTitle>
                                    <p className="text-sm text-muted-foreground">
                                        {notification.message}
                                    </p>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {formatDistanceToNow(notification.createdAt, { addSuffix: true, locale: ptBR })}
                                    </span>
                                    {!notification.read && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleMarkAsRead(notification.id);
                                            }}
                                        >
                                            <Check className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
