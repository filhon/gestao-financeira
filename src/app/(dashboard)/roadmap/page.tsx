import { Metadata } from "next";
import { RoadmapBoard } from "@/components/features/roadmap/RoadmapBoard";
import { Badge } from "@/components/ui/badge";
import { Map, Lightbulb } from "lucide-react";

export const metadata: Metadata = {
  title: "Roadmap | Fin Control",
  description: "Acompanhe o desenvolvimento de novas funcionalidades.",
};

export default function RoadmapPage() {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Map className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Roadmap de Desenvolvimento
            </h2>
            <Badge variant="secondary" className="text-xs font-normal">
              Beta
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground ml-[42px]">
            Acompanhe o que está sendo desenvolvido e vote nas próximas
            funcionalidades.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          <span>Sua sugestão pode virar uma feature!</span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <RoadmapBoard />
      </div>
    </div>
  );
}
