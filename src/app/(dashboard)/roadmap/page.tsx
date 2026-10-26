import { Suspense } from "react";
import { Metadata } from "next";
import { RoadmapView } from "@/components/features/roadmap/RoadmapView";

export const metadata: Metadata = {
  title: "Roadmap | Fin Control",
  description: "Sugira melhorias, vote e acompanhe o que está em execução.",
};

export default function RoadmapPage() {
  return (
    <Suspense>
      <RoadmapView />
    </Suspense>
  );
}
