"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ElapsedSeconds } from "@/components/ui/elapsed-seconds";
import { Loader2 } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  onConfirm: () => Promise<void> | void;
  /** Conteúdo extra entre a descrição e os botões (ex.: campo de motivo). */
  children?: React.ReactNode;
  confirmDisabled?: boolean;
  /** Etapa em andamento, no lugar do texto do botão enquanto confirma. */
  workingLabel?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  variant = "default",
  onConfirm,
  children,
  confirmDisabled = false,
  workingLabel,
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsLoading(true);
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Quem chama já avisou o erro; o diálogo fica aberto para tentar de novo
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={isLoading || confirmDisabled}
            className={
              variant === "destructive"
                ? "bg-destructive text-white hover:bg-destructive/90"
                : ""
            }
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading && workingLabel ? workingLabel : confirmText}
            {isLoading && <ElapsedSeconds />}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Hook for easier usage
export function useConfirmDialog() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant: "default" | "destructive";
    onConfirm: () => Promise<void> | void;
  }>({
    open: false,
    title: "",
    description: "",
    variant: "default",
    onConfirm: () => {},
  });

  const confirm = (options: {
    title: string;
    description: string;
    variant?: "default" | "destructive";
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title,
        description: options.description,
        variant: options.variant || "default",
        onConfirm: () => resolve(true),
      });
    });
  };

  const handleOpenChange = (open: boolean) => {
    setState((prev) => ({ ...prev, open }));
  };

  return {
    confirm,
    dialogProps: {
      open: state.open,
      onOpenChange: handleOpenChange,
      title: state.title,
      description: state.description,
      variant: state.variant,
      onConfirm: state.onConfirm,
    },
  };
}
