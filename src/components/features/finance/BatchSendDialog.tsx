"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { userService } from "@/lib/services/userService";
import { UserProfile, UserRole } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface BatchSendDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSend: (userId: string, userEmail: string, userName: string) => Promise<void>;
    companyId: string;
    title: string;
    description: string;
    roles: UserRole[]; // Which roles to show (approver, releaser, etc.)
    buttonText: string;
}

export function BatchSendDialog({
    isOpen,
    onClose,
    onSend,
    companyId,
    title,
    description,
    roles,
    buttonText,
}: BatchSendDialogProps) {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);

    useEffect(() => {
        const loadUsers = async () => {
            if (isOpen && companyId) {
                setIsLoading(true);
                try {
                    const data = await userService.getUsersByRole(companyId, roles);
                    setUsers(data);
                } catch (error) {
                    console.error("Error loading users:", error);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        loadUsers();
    }, [isOpen, companyId, roles]);

    const handleSend = async () => {
        const user = users.find(u => u.uid === selectedUserId);
        if (!user) return;

        setIsSending(true);
        try {
            await onSend(user.uid, user.email, user.displayName);
            onClose();
        } catch (error) {
            console.error("Error sending:", error);
        } finally {
            setIsSending(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setSelectedUserId("");
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <p className="text-sm text-muted-foreground">{description}</p>

                    <div className="space-y-2">
                        <Label>Selecione o usuário</Label>
                        {isLoading ? (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        ) : users.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2">
                                Nenhum usuário disponível com esta permissão.
                            </p>
                        ) : (
                            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione um usuário" />
                                </SelectTrigger>
                                <SelectContent>
                                    {users.map((user) => (
                                        <SelectItem key={user.uid} value={user.uid}>
                                            {user.displayName} ({user.email})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isSending}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSend}
                        disabled={!selectedUserId || isSending}
                    >
                        {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {buttonText}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
