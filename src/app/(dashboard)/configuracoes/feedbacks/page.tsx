"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminFeedbackTable } from "@/components/features/feedback/AdminFeedbackTable";
import { usePermissions } from "@/hooks/usePermissions";
import { feedbackService } from "@/lib/services/feedbackService";

const QUERY_KEY = ["feedbacks", "all"];

function AdminFeedbacks() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { canManageFeedback } = usePermissions();

  useEffect(() => {
    if (canManageFeedback === false) router.push("/dashboard");
  }, [canManageFeedback, router]);

  const {
    data: feedbacks,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => feedbackService.getAll(),
    enabled: !!canManageFeedback,
  });

  if (!canManageFeedback) return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          Chamados
        </h1>
        <p className="text-sm text-muted-foreground">
          Pagamento em risco primeiro; depois, o prazo mais próximo.
        </p>
      </div>

      {isLoading ? (
        <div
          className="space-y-2"
          role="status"
          aria-label="Carregando chamados"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError || !feedbacks ? (
        <div className="rounded-md border p-6 text-center" role="alert">
          <p className="mb-3 font-medium">
            Não foi possível carregar os chamados.
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <AdminFeedbackTable
          feedbacks={feedbacks}
          selectedId={searchParams.get("chamado")}
          onSelect={(id) =>
            router.replace(
              id
                ? `/configuracoes/feedbacks?chamado=${id}`
                : "/configuracoes/feedbacks",
              { scroll: false },
            )
          }
          onUpdate={() => {
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            queryClient.invalidateQueries({
              queryKey: ["feedbacks-unread-count"],
            });
          }}
        />
      )}
    </div>
  );
}

export default function AdminFeedbacksPage() {
  return (
    <Suspense>
      <AdminFeedbacks />
    </Suspense>
  );
}
