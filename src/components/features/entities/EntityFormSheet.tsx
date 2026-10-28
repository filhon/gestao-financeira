"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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

/**
 * Gravação, aviso de descarte e lista para o alerta de nome repetido: o que a
 * folha e o painel lateral têm em comum.
 */
function useEntityEditor({
  open,
  entity,
  onSaved,
  onClose,
}: {
  open: boolean;
  entity: Entity | null;
  onSaved?: (created?: Entity) => void;
  onClose: () => void;
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
    onClose();
  };
  const requestClose = () => (isDirty ? setConfirmDiscard(true) : close());

  const handleSubmit = async (data: EntityFormData) => {
    if (!selectedCompany || !user) return;
    const actor = { uid: user.uid, email: user.email };
    let created: Entity | undefined;
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
        created = await entityService.create(
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
      onSaved?.(created);
      close();
    } catch (error) {
      console.error("Error saving entity:", error);
      toast.error(friendlyError(error, "Erro ao salvar a entidade."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const discardDialog = (
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
  );

  return {
    companyName: selectedCompany?.name,
    existing,
    isSubmitting,
    setIsDirty,
    requestClose,
    confirmDiscard,
    handleSubmit,
    discardDialog,
  };
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
  const editor = useEntityEditor({
    open,
    entity,
    onSaved,
    onClose: () => onOpenChange(false),
  });

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) =>
          next ? onOpenChange(true) : editor.requestClose()
        }
      >
        <SheetContent
          onInteractOutside={(e) => e.preventDefault()}
          className="w-full gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <SheetHeader className="shrink-0 gap-0.5 border-b px-6 py-4">
            <SheetTitle className="text-lg">
              {entity ? `Editar ${entity.name}` : "Nova entidade"}
            </SheetTitle>
            <SheetDescription>em {editor.companyName}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2">
            {open && (
              <EntityForm
                key={entity?.id ?? "new"}
                defaultValues={entity ?? {}}
                onSubmit={editor.handleSubmit}
                isLoading={editor.isSubmitting}
                onCancel={editor.requestClose}
                onDirtyChange={editor.setIsDirty}
                existing={editor.existing}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
      {editor.discardDialog}
    </>
  );
}

/**
 * Cadastro novo como segunda folha, ao lado da folha que o abriu (mesmo
 * padrão do visualizador de anexos no detalhe da transação). Precisa ser
 * renderizado dentro do SheetContent da folha de origem, que deve ter
 * `overflow-visible`; no celular cobre a folha e tem Voltar.
 */
export function EntitySidePanel({
  open,
  onClose,
  initial,
  title = "Nova entidade",
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Valores iniciais (ex.: o nome buscado no lançamento). */
  initial?: Partial<Entity>;
  title?: string;
  onSaved: (created?: Entity) => void;
}) {
  const editor = useEntityEditor({ open, entity: null, onSaved, onClose });
  const { requestClose, confirmDiscard } = editor;

  // Esc fecha este painel antes da folha de baixo. Captura na janela, antes do
  // Radix; menu ou confirmação aberta por cima ficam com o Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmDiscard) return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      e.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, confirmDiscard, requestClose]);

  if (!open) return null;
  return (
    <>
      <aside
        aria-label={title}
        className="absolute inset-0 z-10 flex flex-col bg-background shadow-xl duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] animate-in fade-in-0 slide-in-from-right-8 lg:left-auto lg:right-full lg:w-[min(48rem,calc(100vw-100%-1.5rem))] lg:border-l"
      >
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 lg:hidden"
            aria-label="Voltar ao lançamento"
            onClick={requestClose}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-muted-foreground">
              em {editor.companyName}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 lg:inline-flex"
            title="Fechar (Esc)"
            aria-label="Fechar cadastro"
            onClick={requestClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
          <EntityForm
            defaultValues={initial ?? {}}
            onSubmit={editor.handleSubmit}
            isLoading={editor.isSubmitting}
            onCancel={requestClose}
            onDirtyChange={editor.setIsDirty}
            existing={editor.existing}
          />
        </div>
      </aside>
      {editor.discardDialog}
    </>
  );
}
