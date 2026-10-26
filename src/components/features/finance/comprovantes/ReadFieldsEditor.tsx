"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Pencil,
  UserRoundSearch,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCompany } from "@/components/providers/CompanyProvider";
import { comprovanteService } from "@/lib/services/comprovanteService";
import { entityService } from "@/lib/services/entityService";
import { Comprovante } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { InsightLine } from "./InsightLine";
import type { Insight } from "./receiptInsight";

interface Props {
  c: Comprovante;
  insight: Insight;
  canEdit: boolean;
  onPatch: (patch: Partial<Comprovante>) => void;
}

function learnedSummary(l: {
  documents: string[];
  pixKeys: string[];
  names: string[];
}) {
  const parts = [
    l.documents.length && `${l.documents.length} CNPJ/CPF`,
    l.pixKeys.length && "a chave Pix",
    l.names.length && `a grafia "${l.names[0]}"`,
  ].filter(Boolean);
  return parts.length
    ? ` O sistema aprendeu ${parts.join(", ")} para os próximos comprovantes.`
    : "";
}

/**
 * "Lido no comprovante", com correção no lugar: o usuário confere na prévia
 * ao lado e ajusta o que a leitura errou ou não achou.
 */
export function ReadFieldsEditor({ c, insight, canEdit, onPatch }: Props) {
  const { selectedCompany } = useCompany();
  const editable = canEdit && c.matchStatus !== "matched";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [amount, setAmount] = useState<number | undefined>(c.matchedAmount);
  const [date, setDate] = useState(
    c.matchedDate ? format(c.matchedDate, "yyyy-MM-dd") : "",
  );
  const [entityId, setEntityId] = useState<string | undefined>(
    c.manualFields?.entityId,
  );
  const [entityOpen, setEntityOpen] = useState(false);

  const { data: entities = [] } = useQuery({
    queryKey: ["entities", selectedCompany?.id, "supplier"],
    queryFn: () => entityService.getAll(selectedCompany!.id, "supplier"),
    enabled: editing && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });
  const entity = useMemo(
    () => entities.find((e) => e.id === entityId),
    [entities, entityId],
  );

  const corrected = c.manualFields;
  const startEditing = () => {
    setAmount(c.matchedAmount);
    setDate(c.matchedDate ? format(c.matchedDate, "yyyy-MM-dd") : "");
    setEntityId(c.manualFields?.entityId);
    setEditing(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany) return;
    const originalDate = c.matchedDate
      ? format(c.matchedDate, "yyyy-MM-dd")
      : "";
    const body = {
      comprovanteId: c.id,
      ...(entityId && entityId !== c.manualFields?.entityId && { entityId }),
      ...(amount && amount !== c.matchedAmount && { amount }),
      ...(date && date !== originalDate && { date }),
    };
    if (Object.keys(body).length === 1) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const { patch, learned } = await comprovanteService.calibrate(
        selectedCompany.id,
        body,
      );
      onPatch(patch);
      setEditing(false);
      toast.success(
        (patch.suggestedTransactionIds?.length
          ? "Sugestão refeita com a leitura corrigida."
          : "Leitura corrigida. Nenhum título compatível; vincule abaixo.") +
          learnedSummary(learned),
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao corrigir a leitura.",
      );
    } finally {
      setSaving(false);
    }
  };

  const tag = (on?: unknown) =>
    on ? (
      <span className="ml-1.5 text-xs text-muted-foreground">(corrigido)</span>
    ) : null;

  if (!editing) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Lido no comprovante</h3>
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-muted-foreground"
              onClick={startEditing}
            >
              <Pencil className="h-3.5 w-3.5" />
              Corrigir leitura
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Valor</dt>
          <dd className="font-financial font-medium">
            {c.matchedAmount != null
              ? formatCurrency(c.matchedAmount)
              : "não identificado"}
            {tag(corrected?.amount != null)}
          </dd>
          <dt className="text-muted-foreground">Data</dt>
          <dd>
            {c.matchedDate
              ? format(c.matchedDate, "dd/MM/yyyy")
              : "não identificada"}
            {tag(corrected?.date)}
          </dd>
          <dt className="text-muted-foreground">Beneficiário</dt>
          <dd className="min-w-0 break-words">
            {c.matchedEntity ? (
              <>
                {c.matchedEntity}
                {tag(corrected?.entityId)}
              </>
            ) : editable ? (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
              >
                <UserRoundSearch className="h-3.5 w-3.5" />
                Não identificado. Informar
              </button>
            ) : (
              "não identificado"
            )}
          </dd>
        </dl>
        <InsightLine insight={insight} className="text-sm" />
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Corrigir leitura</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="cal-amount" className="text-xs text-muted-foreground">
            Valor pago
          </Label>
          <CurrencyInput id="cal-amount" value={amount} onChange={setAmount} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cal-date" className="text-xs text-muted-foreground">
            Data do pagamento
          </Label>
          <Input
            id="cal-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Beneficiário</Label>
        <Popover open={entityOpen} onOpenChange={setEntityOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={entityOpen}
              className="w-full justify-between font-normal"
            >
              <span
                className={cn("truncate", !entity && "text-muted-foreground")}
              >
                {entity?.name ?? c.matchedEntity ?? "Escolher do cadastro…"}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            <Command>
              <CommandInput placeholder="Nome ou CNPJ…" />
              <CommandList className="max-h-60">
                <CommandEmpty>Nenhum fornecedor encontrado.</CommandEmpty>
                {entities.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.document ?? ""}`}
                    onSelect={() => {
                      setEntityId(e.id);
                      setEntityOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        e.id === entityId ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.document && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {e.document}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-muted-foreground">
          O CNPJ, a chave Pix e o nome lidos aqui passam a identificar este
          fornecedor nos próximos comprovantes.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Recalcular sugestão
        </Button>
      </div>
    </form>
  );
}
