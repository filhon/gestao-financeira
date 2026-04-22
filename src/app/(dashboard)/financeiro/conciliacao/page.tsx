import { ReconciliationDashboard } from "@/components/features/finance/reconciliation/ReconciliationDashboard";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conciliação Bancária | Sistema Financeiro",
  description: "Processe seus extratos bancários e concilie lançamentos.",
};

export default function ConciliacaoPage() {
  return <ReconciliationDashboard />;
}
