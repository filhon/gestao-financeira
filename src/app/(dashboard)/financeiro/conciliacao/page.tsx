import { ReconciliationDashboard } from "@/components/features/finance/reconciliation/ReconciliationDashboard";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conciliação Bancária | Sistema Financeiro",
  description: "Processe seus extratos bancários e concilie lançamentos.",
};

export default function ConciliacaoPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Conciliação Bancária
          </h2>
          <p className="text-muted-foreground">
            Importe extratos e identifique lançamentos automaticamente.
          </p>
        </div>
      </div>

      <ReconciliationDashboard />
    </div>
  );
}
