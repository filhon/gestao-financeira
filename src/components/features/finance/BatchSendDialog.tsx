"use client";

import { useState } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalFooter,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface BatchSendDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (
    userId: string,
    userEmail: string,
    userName: string,
  ) => Promise<void>;
  companyId: string;
  title: string;
  description: string;
  buttonText: string;
}

export function BatchSendDialog({
  isOpen,
  onClose,
  onSend,
  title,
  description,
  buttonText,
}: BatchSendDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isSending, setIsSending] = useState(false);

  const validateEmail = (value: string): boolean => {
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    setEmailError(isValid ? "" : "Digite um e-mail válido");
    return isValid;
  };

  const handleSend = async () => {
    if (!validateEmail(email)) return;
    setIsSending(true);
    try {
      await onSend(email, email, name.trim() || email);
      setEmail("");
      setName("");
      onClose();
    } catch {
      // error handled by parent
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setEmail("");
      setName("");
      setEmailError("");
      onClose();
    }
  };

  return (
    <ResponsiveModal open={isOpen} onOpenChange={handleOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">{description}</p>

          <div className="space-y-2">
            <Label htmlFor="send-email">E-mail</Label>
            <Input
              id="send-email"
              type="email"
              placeholder="aprovador@empresa.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              onBlur={() => email && validateEmail(email)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            {emailError && (
              <p className="text-sm text-destructive">{emailError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="send-name">
              Nome{" "}
              <span className="text-muted-foreground font-normal">
                (opcional)
              </span>
            </Label>
            <Input
              id="send-name"
              type="text"
              placeholder="Nome do responsável"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
          </div>
        </div>

        <ResponsiveModalFooter>
          <Button variant="outline" onClick={onClose} disabled={isSending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={!email.trim() || isSending}>
            {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {buttonText}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
