import { Skeleton } from "@/components/ui/skeleton";

// Resposta imediata ao clique na navegação enquanto o JS da próxima tela chega.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
