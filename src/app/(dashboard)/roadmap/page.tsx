import { Metadata } from "next";
import { RoadmapBoard } from "@/components/features/roadmap/RoadmapBoard";

export const metadata: Metadata = {
  title: "Roadmap | Fin Control",
  description: "Acompanhe o desenvolvimento de novas funcionalidades.",
};

export default function RoadmapPage() {
  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Roadmap de Desenvolvimento</h2>
      </div>
      <div className="flex-1 overflow-hidden">
         <RoadmapBoard />
      </div>
    </div>
  );
}
