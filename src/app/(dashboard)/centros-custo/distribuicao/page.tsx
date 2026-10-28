"use client";

import { CostCentersScreen } from "@/components/features/finance/CostCentersScreen";

// Mantida porque as notificações de estouro apontam para cá: abre a mesma
// árvore já no modo distribuição.
export default function DistribuicaoPage() {
  return <CostCentersScreen initialEditing />;
}
