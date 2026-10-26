"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EntityForm, EntityFormData } from "./EntityForm";
import { entityService } from "@/lib/services/entityService";
import { Entity } from "@/lib/types";
import { useCompany } from "@/components/providers/CompanyProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { friendlyError } from "@/lib/errors";

export const entitiesQueryKey = (companyId?: string) => [
  "entities-all",
  companyId,
];

/** Escolha que ficou vazia precisa ir como null, senão o valor antigo fica. */
const CLEARABLE = [
  "taxRegime",
  "defaultAccountId",
  "defaultCostCenterId",
  "defaultPaymentMethod",
  "accountType",
  "pixKeyType",
] as const;

function toEntityData(data: EntityFormData) {
  const digits = data.document?.replace(/\D/g, "") ?? "";
  const out: Record<string, unknown> = {
    ...data,
    document: digits,
    // Tipo vem do documento quando há um
    type:
      digits.length === 11
        ? "individual"
        : digits.length === 14
          ? "company"
          : data.type,
    name: data.name.trim(),
    tradeName: data.tradeName?.trim() ?? "",
  };
  for (const key of CLEARABLE) out[key] = data[key] ?? null;
  return out as Partial<Entity>;
}

/** Cadastro e edição de entidade em painel lateral. */
export function EntityFormSheet({
  open,
  onOpenChange,
  entity,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = cadastro novo. */
  entity: Entity | null;
  onSaved?: () => void;
}) {
  const { selectedCompany } = useCompany();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const { data: existing = [] } = useQuery({
    queryKey: entitiesQueryKey(selectedCompany?.id),
    queryFn: () => entityService.getAll(selectedCompany!.id),
    enabled: open && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });

  const close = () => {
    setIsDirty(false);
    onOpenChange(false);
  };
  const requestClose = () => (isDirty ? setConfirmDiscard(true) : close());

  const handleSubmit = async (data: EntityFormData) => {
    if (!selectedCompany || !user) return;
    const actor = { uid: user.uid, email: user.email };
    try {
      setIsSubmitting(true);
      if (entity) {
        const { bankChangePending } = await entityService.update(
          entity.id,
          toEntityData(data),
          actor,
          selectedCompany.id,
        );
        toast.success(
          bankChangePending
            ? "Alterações salvas. A troca de dados bancários aguarda aprovação de outra pessoa."
            : "Cadastro atualizado.",
        );
      } else {
        await entityService.create(
          {
            ...(toEntityData(data) as Omit<
              Entity,
              "id" | "createdAt" | "updatedAt"
            >),
            companyId: selectedCompany.id,
          },
          actor,
        );
        toast.success("Entidade cadastrada.");
      }
      queryClient.invalidateQueries({ queryKey: ["entities-all"] });
      queryClient.invalidateQueries({ queryKey: ["entity"] });
      onSaved?.();
      close();
    } catch (error) {
      console.error("Error saving entity:", error);
      toast.error(friendlyError(error, "Erro ao salvar a entidade."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      >
        <SheetContent
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-6 py-4">
            <SheetTitle className="text-lg">
              {entity ? `Editar ${entity.name}` : "Nova entidade"}
            </SheetTitle>
            <SheetDescription>em {selectedCompany?.name}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2">
            {open && (
              <EntityForm
                key={entity?.id ?? "new"}
                defaultValues={entity ?? {}}
                onSubmit={handleSubmit}
                isLoading={isSubmitting}
                onCancel={requestClose}
                onDirtyChange={setIsDirty}
                existing={existing}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar alterações?"
        description="O que foi preenchido será perdido."
        confirmText="Descartar"
        cancelText="Continuar editando"
        variant="destructive"
        onConfirm={close}
      />
    </>
  );
}
