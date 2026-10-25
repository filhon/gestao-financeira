"use client";

import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ReconciliationService } from "@/lib/services/reconciliationService";
import { reconciliationSessionService } from "@/lib/services/reconciliationSessionService";
import { bankAccountService } from "@/lib/services/bankAccountService";
import { useReconciliationStore } from "@/lib/store/useReconciliationStore";
import { pickStatementBalance } from "@/lib/bankReconciliation";
import { useCompany } from "@/components/providers/CompanyProvider";
import { BankAccount } from "@/lib/types";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";

const EMPTY_PARSE_MESSAGE = {
  ofx: "Nenhum lançamento encontrado no OFX. Exporte o extrato novamente pelo internet banking.",
  csv: "Colunas não reconhecidas. O CSV precisa de uma coluna de data (data) e de valor (valor, ou débito e crédito).",
  json: "Nenhum lançamento encontrado no JSON.",
} as const;

interface UploadStatementProps {
  /** Conta selecionada na tela; o OFX de outra conta cadastrada a substitui. */
  account: BankAccount;
  accounts: BankAccount[];
  /** O OFX era de outra conta cadastrada: a tela passa a mostrá-la. */
  onAccountDetected: (accountId: string) => void;
  variant?: "dropzone" | "button";
}

export function UploadStatement({
  account,
  accounts,
  onAccountDetected,
  variant = "dropzone",
}: UploadStatementProps) {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!selectedCompany?.id) {
      toast.error("Selecione uma empresa antes de importar.");
      return;
    }

    const ext = file.name.toLowerCase().split(".").pop();
    const format =
      ext === "ofx"
        ? "ofx"
        : ext === "json"
          ? "json"
          : ext === "csv" || ext === "txt"
            ? "csv"
            : null;
    if (!format) {
      toast.error(`"${file.name}" não é um extrato suportado. Use OFX ou CSV.`);
      return;
    }

    setIsProcessing(true);
    try {
      const text = await file.text();
      const [parsed, meta] = await Promise.all([
        ReconciliationService.parseStatement(text, format),
        format === "ofx"
          ? ReconciliationService.parseOFXMeta(text)
          : Promise.resolve(null),
      ]);

      if (parsed.length === 0) {
        toast.error(EMPTY_PARSE_MESSAGE[format], {
          description: file.name,
        });
        return;
      }

      // O OFX diz de qual conta é: importar na conta errada estragaria o saldo
      // das duas, então a conta do arquivo vence a selecionada.
      const detected = meta
        ? bankAccountService.findByStatement(accounts, meta)
        : undefined;
      if (meta?.accountNumber && !detected) {
        toast.error(
          `Este extrato é da conta ${meta.accountNumber}, que não está cadastrada.`,
          {
            description:
              "Cadastre a conta em Cadastros › Contas Bancárias, com o mesmo número, e importe de novo.",
          },
        );
        return;
      }
      const target = detected ?? account;

      // Prefixo da conta no id: a mesma tarifa, no mesmo dia e valor, em duas
      // contas não pode ser descartada como duplicata.
      const transactions = parsed.map((tx) => ({
        ...tx,
        id: `${target.id}_${tx.id}`,
        bankAccountId: target.id,
      }));

      const { added, skipped } = await reconciliationSessionService.mergeItems(
        selectedCompany.id,
        transactions,
      );

      // Linhas da conta depois da importação: as que já estavam e as novas.
      const known = useReconciliationStore
        .getState()
        .transactions.filter((t) => t.bankAccountId === target.id);
      const knownIds = new Set(known.map((t) => t.id));
      const picked = pickStatementBalance(
        target,
        [...known, ...transactions.filter((t) => !knownIds.has(t.id))],
        meta?.balance !== undefined
          ? {
              balance: meta.balance,
              date:
                meta.balanceDate ??
                new Date(
                  Math.max(
                    ...transactions.map((t) => new Date(t.date).getTime()),
                  ),
                ),
            }
          : null,
      );
      // Reimportar um extrato mais antigo não pode recuar o saldo final.
      if (
        picked &&
        (!target.statementBalanceDate ||
          picked.date >= new Date(target.statementBalanceDate))
      ) {
        await bankAccountService.setStatementBalance(
          target.id,
          picked.balance,
          picked.date,
        );
        await queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      }

      if (target.id !== account.id) {
        onAccountDetected(target.id);
        toast.info(`Extrato reconhecido como da conta ${target.name}.`);
      }

      if (added === 0) {
        toast.info(
          "Todos os lançamentos deste extrato já haviam sido importados.",
        );
      } else if (skipped > 0) {
        toast.success(
          `${added} lançamento(s) novo(s) importado(s). ${skipped} já existiam.`,
        );
      } else {
        toast.success(`${added} lançamento(s) importado(s).`);
      }
    } catch (error) {
      console.error(error);
      toast.error(
        friendlyError(error, `Não foi possível importar "${file.name}".`),
      );
    } finally {
      setIsProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const input = (
    <input
      type="file"
      className="hidden"
      ref={inputRef}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
      }}
      accept=".ofx,.csv,.txt,.json"
    />
  );

  if (variant === "button") {
    return (
      <>
        {input}
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={isProcessing}
          onClick={() => inputRef.current?.click()}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          <span className="hidden sm:inline ml-2">Importar extrato</span>
        </Button>
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) processFile(file);
      }}
      className={cn(
        "rounded-lg border border-dashed px-6 py-10 transition-colors",
        isDragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      {input}
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="mt-3 font-medium">
          {isDragging
            ? "Solte o arquivo para importar"
            : `Importe o extrato de ${account.name}`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Arraste o arquivo OFX ou CSV para cá. O OFX já traz o saldo final e
          identifica a conta automaticamente.
        </p>
        <Button
          className="mt-5"
          disabled={isProcessing}
          onClick={() => inputRef.current?.click()}
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {isProcessing ? "Importando..." : "Selecionar arquivo"}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          No internet banking, procure por “Exportar extrato” ou “Salvar como
          OFX / Money”.
        </p>
      </div>
    </div>
  );
}
