"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCostCenters } from "@/hooks/useCostCenters";
import { ReconciliationRule } from "@/lib/types";

interface RulesSheetProps {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: ReconciliationRule[];
  canManage: boolean;
  onToggle: (rule: ReconciliationRule, active: boolean) => void;
  onDelete: (rule: ReconciliationRule) => void;
}

/**
 * Regras nascem da própria conciliação — "Sugerir para linhas parecidas" ao
 * lançar direto, "Sempre ignorar" ao ignorar. Aqui só se desliga ou exclui.
 *
 * ponytail: sem edição; para mudar o padrão, exclua e crie de novo a partir de
 * uma linha. Editar no lugar se virar rotina.
 */
export function RulesSheet({
  companyId,
  open,
  onOpenChange,
  rules,
  canManage,
  onToggle,
  onDelete,
}: RulesSheetProps) {
  const { costCenters } = useCostCenters(open ? companyId : undefined);
  const ccName = (id: string) =>
    costCenters.find((cc) => cc.id === id)?.name ?? "centro removido";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>Regras de conciliação</SheetTitle>
          <SheetDescription>
            Ao buscar correspondências, linhas sem título no sistema que casam
            com uma regra viram sugestão. Nada é lançado sem confirmação.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {rules.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              Nenhuma regra ainda. Crie uma ao lançar uma tarifa direto do
              extrato ou ao ignorar uma linha.
            </p>
          ) : (
            <ul className="divide-y">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3 px-5 py-3">
                  <Checkbox
                    checked={rule.active}
                    disabled={!canManage}
                    onCheckedChange={(c) => onToggle(rule, !!c)}
                    aria-label={
                      rule.active ? "Desativar regra" : "Ativar regra"
                    }
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      {rule.direction === "debit" ? "Débito" : "Crédito"} com
                      &ldquo;{rule.pattern}&rdquo;
                    </p>
                    <p className="truncate text-muted-foreground">
                      {rule.action === "ignore" || !rule.template
                        ? "Ignorar"
                        : `Lançar “${rule.template.description}” · ${ccName(rule.template.costCenterId)}`}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(rule)}
                      aria-label="Excluir regra"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
