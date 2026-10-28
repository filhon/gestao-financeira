"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { CostCenterForm } from "@/components/features/finance/CostCenterForm";
import { CostCenterFormData } from "@/lib/validations/costCenter";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { useCompany } from "@/components/providers/CompanyProvider";

/** Dados do formulário a partir do documento: editar e arquivar partem daqui. */
export function toFormData(cc: CostCenter): CostCenterFormData {
  return {
    name: cc.name,
    code: cc.code,
    description: cc.description,
    parentId: cc.parentId,
    allowedUserIds: cc.allowedUserIds,
    approverEmail: cc.approverEmail,
    releaserEmail: cc.releaserEmail,
    archived: !!cc.archived,
  };
}

/**
 * Criar ou editar um centro. `editing` nulo cria; o modal fecha sozinho ao
 * salvar e invalida o cache de centros, que a árvore e o detalhe consomem.
 */
export function CostCenterFormDialog({
  open,
  onOpenChange,
  editing,
  costCenters,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CostCenter | null;
  costCenters: CostCenter[];
  onSaved?: () => void;
}) {
  const { selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: CostCenterFormData) => {
    if (!selectedCompany) return;
    try {
      setIsSubmitting(true);
      if (editing) await costCenterService.update(editing.id, data);
      else await costCenterService.create(data, selectedCompany.id);
      await queryClient.invalidateQueries({ queryKey: ["cost-centers"] });
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving cost center:", error);
      // A recusa de raiz duplicada explica o que fazer; sem toast o formulário
      // apenas não salvava, sem dizer por quê.
      toast.error(
        error instanceof Error
          ? error.message
          : "Erro ao salvar centro de custo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>
            {editing ? `Editar ${editing.name}` : "Novo centro de custo"}
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>
        {/* `key` remonta o formulário ao trocar de centro: o RHF só lê
            `defaultValues` na montagem. */}
        <CostCenterForm
          key={editing?.id ?? "new"}
          onSubmit={handleSubmit}
          isLoading={isSubmitting}
          onCancel={() => onOpenChange(false)}
          availableCostCenters={costCenters}
          editingId={editing?.id ?? null}
          defaultValues={editing ? toFormData(editing) : undefined}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
