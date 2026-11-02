import { Suspense } from "react";
import { Metadata } from "next";
import { PlaybookView } from "@/components/features/playbook/PlaybookView";

export const metadata: Metadata = {
  title: "Manual de operação | Fin Control",
  description: "As regras do jogo: quem faz o quê, em que ordem e por quê.",
};

export default function ManualPage() {
  // A busca fica em ?q=; useSearchParams exige Suspense no pré-render.
  return (
    <Suspense>
      <PlaybookView />
    </Suspense>
  );
}
