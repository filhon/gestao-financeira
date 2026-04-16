"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFeedbackTable } from "@/components/features/feedback/AdminFeedbackTable";
import { feedbackService } from "@/lib/services/feedbackService";
import { Feedback } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { Loader2, MessageSquare, Clock, CheckCircle, Bell } from "lucide-react";

interface StatCardProps {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  isLoading: boolean;
  progress?: number; // 0–100
  index: number;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  iconBg,
  isLoading,
  progress,
  index,
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-1.5 w-full rounded-full mt-1" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
    >
      <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              iconBg,
            )}
          >
            <Icon className={cn("h-4 w-4", color)} />
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className={cn("text-2xl font-bold", color)}>{value}</div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{
                width: progress !== undefined ? `${progress}%` : "0%",
                opacity: progress !== undefined ? 0.8 : 0,
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminFeedbacksPage() {
  const router = useRouter();
  const { canManageFeedback } = usePermissions();
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Route protection
  useEffect(() => {
    if (canManageFeedback === false) {
      router.push("/dashboard");
    }
  }, [canManageFeedback, router]);

  const loadFeedbacks = async () => {
    try {
      setIsLoading(true);
      const data = await feedbackService.getAll();
      setFeedbacks(data);
    } catch (error) {
      console.error("Error loading feedbacks:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canManageFeedback) {
      loadFeedbacks();
    }
  }, [canManageFeedback]);

  // Stats
  const totalFeedbacks = feedbacks.length;
  const pendingFeedbacks = feedbacks.filter(
    (f) => f.status === "pending",
  ).length;
  const resolvedFeedbacks = feedbacks.filter(
    (f) => f.status === "resolved",
  ).length;
  const unreadFeedbacks = feedbacks.filter((f) => !f.read).length;
  const resolvedPercent =
    totalFeedbacks > 0
      ? Math.round((resolvedFeedbacks / totalFeedbacks) * 100)
      : 0;

  if (canManageFeedback === undefined) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canManageFeedback) {
    return null; // Will redirect
  }

  const stats: Omit<StatCardProps, "isLoading" | "index">[] = [
    {
      title: "Total",
      value: totalFeedbacks,
      subtitle: "feedbacks recebidos",
      icon: MessageSquare,
      color: "text-blue-600 dark:text-blue-400",
      iconBg: "bg-blue-50 dark:bg-blue-950/60",
    },
    {
      title: "Não Lidos",
      value: unreadFeedbacks,
      subtitle: "aguardando visualização",
      icon: Bell,
      color: unreadFeedbacks > 0 ? "text-primary" : "text-muted-foreground",
      iconBg: unreadFeedbacks > 0 ? "bg-primary/10" : "bg-muted",
    },
    {
      title: "Pendentes",
      value: pendingFeedbacks,
      subtitle: "aguardando resposta",
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      iconBg: "bg-amber-50 dark:bg-amber-950/60",
    },
    {
      title: "Resolvidos",
      value: resolvedFeedbacks,
      subtitle: `${resolvedPercent}% do total concluído`,
      icon: CheckCircle,
      color: "text-emerald-600 dark:text-emerald-400",
      iconBg: "bg-emerald-50 dark:bg-emerald-950/60",
      progress: resolvedPercent,
    },
  ];

  return (
    <div className="space-y-6">
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationFillMode: "both" }}
      >
        <h1 className="text-3xl font-bold tracking-tight">
          Gerenciamento de Feedbacks
        </h1>
        <p className="text-muted-foreground mt-1">
          Visualize e responda aos feedbacks enviados pelos usuários do sistema.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((stat, i) => (
          <StatCard
            key={stat.title}
            {...stat}
            isLoading={isLoading}
            index={i}
          />
        ))}
      </div>

      {/* Feedback Table */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "240ms", animationFillMode: "both" }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Todos os Feedbacks</CardTitle>
                <CardDescription className="mt-1">
                  Clique em um feedback para ver os detalhes ou responder ao
                  usuário.
                </CardDescription>
              </div>
              {unreadFeedbacks > 0 && (
                <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                  {unreadFeedbacks} não{" "}
                  {unreadFeedbacks === 1 ? "lido" : "lidos"}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <AdminFeedbackTable
              feedbacks={feedbacks}
              onUpdate={loadFeedbacks}
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
