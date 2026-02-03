"use client";

import { Upload, FileText, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useRef } from "react";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
import { toast } from "sonner";

export function UploadStatement() {
  const { setTransactions } = useReconciliationStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const text = await file.text();
      // Simple format detection based on extension for now
      const isJson = file.name.endsWith(".json");
      const isOfx = file.name.endsWith(".ofx");
      const transactions = ReconciliationService.parseStatement(
        text,
        isJson ? "json" : isOfx ? "ofx" : "csv",
      );

      if (transactions.length === 0) {
        toast.error("Nenhuma transação encontrada ou formato inválido.");
        return;
      }

      setTransactions(transactions);
      toast.success(
        `${transactions.length} transações importadas com sucesso!`,
      );
    } catch (error) {
      console.error(error);
      toast.error("Erro ao processar arquivo.");
    } finally {
      setIsProcessing(false);
      // Reset input
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      className={cn(
        "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors border-muted-foreground/25 hover:border-primary/50",
      )}
    >
      <input
        type="file"
        className="hidden"
        ref={inputRef}
        onChange={handleFileChange}
        accept=".csv,.json,.ofx,.txt"
      />
      <div className="flex flex-col items-center gap-4">
        <div className="p-4 bg-muted rounded-full">
          <Upload className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Importar Extrato Bancário</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Clique para selecionar arquivo (OFX, CSV ou JSON)
          </p>
        </div>
        {isProcessing ? (
          <Button disabled>Processando...</Button>
        ) : (
          <Button variant="outline">Selecionar Arquivo</Button>
        )}
      </div>
      <div className="flex justify-center gap-4 mt-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> OFX
        </span>
        <span className="flex items-center gap-1">
          <FileSpreadsheet className="h-3 w-3" /> CSV
        </span>
      </div>
    </div>
  );
}
