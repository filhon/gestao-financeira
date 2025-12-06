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
}: ConfirmDialogProps) {
    const [isLoading, setIsLoading] = useState(false);

    const handleConfirm = async () => {
        try {
            setIsLoading(true);
            await onConfirm();
            onOpenChange(false);
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
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading}>{cancelText}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault();
                            handleConfirm();
                        }}
                        disabled={isLoading}
                        className={variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                    >
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {confirmText}
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
        onConfirm: () => { },
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
