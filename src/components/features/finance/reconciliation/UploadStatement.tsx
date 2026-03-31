"use client";

import { Upload, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useRef } from "react";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";
import { useCompany } from "@/components/providers/CompanyProvider";
import { toast } from "sonner";

export function UploadStatement() {
  const { selectedCompany } = useCompany();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!selectedCompany?.id) {
      toast.error("Selecione uma empresa antes de importar.");
      return;
    }

    setIsProcessing(true);
    try {
      const text = await file.text();
      const isJson = file.name.endsWith(".json");
      const isOfx = file.name.endsWith(".ofx");
      const transactions = await ReconciliationService.parseStatement(
        text,
        isJson ? "json" : isOfx ? "ofx" : "csv",
      );

      if (transactions.length === 0) {
        toast.error("Nenhuma transação encontrada ou formato inválido.");
        return;
      }

      await reconciliationSessionService.saveSession(
        selectedCompany.id,
        transactions,
      );

      toast.success(
        `${transactions.length} transações importadas com sucesso!`,
      );
    } catch (error) {
      console.error(error);
      toast.error("Erro ao processar arquivo.");
    } finally {
      setIsProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  return (
    <div
      onClick={() => !isProcessing && inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-all duration-200",
        isDragging
          ? "border-primary bg-primary/5 scale-[1.01]"
          : "border-muted-foreground/25 hover:border-primary/50",
        isProcessing && "cursor-default opacity-70",
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
        <div className={cn(
          "p-4 rounded-full transition-colors",
          isDragging ? "bg-primary/10" : "bg-muted",
        )}>
          <Upload className={cn(
            "h-8 w-8 transition-colors",
            isDragging ? "text-primary" : "text-muted-foreground",
          )} />
        </div>
        <div>
          <h3 className="text-lg font-semibold">
            {isDragging ? "Solte o arquivo aqui" : "Importar Extrato Bancário"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {isDragging
              ? "Formato OFX, CSV ou JSON"
              : "Arraste um arquivo ou clique para selecionar (OFX, CSV ou JSON)"}
          </p>
        </div>
        {isProcessing ? (
          <Button disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processando...
          </Button>
        ) : (
          <Button variant="outline" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
            Selecionar Arquivo
          </Button>
        )}
      </div>
      <div className="flex justify-center gap-4 mt-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> OFX
        </span>
        <span className="flex items-center gap-1">
          <FileSpreadsheet className="h-3 w-3" /> CSV
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" /> JSON
        </span>
      </div>
    </div>
  );
}
