"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { companyService } from "@/lib/services/companyService";
import { userService } from "@/lib/services/userService";
import { notificationService } from "@/lib/services/notificationService";
import { UserRole } from "@/lib/types";
import { ROLE_DESCRIPTIONS } from "@/lib/constants/roleDescriptions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Building2, Loader2, ArrowRight, CheckCircle2, LogOut, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function CompanySetupPage() {
    const { user, logout } = useAuth();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [companyName, setCompanyName] = useState("");
    const [companyCnpj, setCompanyCnpj] = useState("");
    const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);

    // Validation errors
    const [errors, setErrors] = useState<{ name?: string; cnpj?: string }>({});

    // If user is already approved or in pending_approval, redirect
    useEffect(() => {
        if (user) {
            const effectiveStatus = user.status || (user.active ? 'active' : 'pending_company_setup');
            if (effectiveStatus === 'active') {
                router.push('/');
            } else if (effectiveStatus === 'pending_approval') {
                router.push('/pending-approval');
            }
        }
    }, [user, router]);

    // Format CNPJ as user types
    const formatCnpj = (value: string): string => {
        const digits = value.replace(/\D/g, "");
        if (digits.length <= 2) return digits;
        if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
        if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
        if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
        return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
    };

    const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatCnpj(e.target.value);
        setCompanyCnpj(formatted);
        if (errors.cnpj) setErrors(prev => ({ ...prev, cnpj: undefined }));
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCompanyName(e.target.value);
        if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
    };

    // Validate CNPJ format (basic validation - 14 digits)
    const isValidCnpj = (cnpj: string): boolean => {
        const digits = cnpj.replace(/\D/g, "");
        return digits.length === 14;
    };

    const validateForm = (): boolean => {
        const newErrors: { name?: string; cnpj?: string } = {};

        if (!companyName.trim()) {
            newErrors.name = "Razão social é obrigatória";
        }

        if (!companyCnpj.trim()) {
            newErrors.cnpj = "CNPJ é obrigatório";
        } else if (!isValidCnpj(companyCnpj)) {
            newErrors.cnpj = "CNPJ deve ter 14 dígitos";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validateForm() || !selectedRole || !user) {
            if (!selectedRole) {
                toast.error("Selecione uma função.");
            }
            return;
        }

        setIsSubmitting(true);
        try {
            // 1. Try to find existing company by CNPJ or name
            const existingCompany = await companyService.findByIdentifier(companyCnpj, companyName);
            
            let companyId: string;
            let companyDisplayName: string;
            let isNewCompany = false;

            if (existingCompany) {
                // Company exists - associate user to it
                companyId = existingCompany.id;
                companyDisplayName = existingCompany.name;
            } else {
                // Create new company
                const newCompany = await companyService.create(
                    { name: companyName.trim(), cnpj: companyCnpj.trim() },
                    { uid: user.uid, email: user.email }
                );
                companyId = newCompany.id;
                companyDisplayName = newCompany.name;
                isNewCompany = true;
            }

            // 2. Update user's pending access
            await userService.setPendingCompanyAccess(user.uid, companyId, selectedRole);

            // 3. Get role label for notification
            const roleName = ROLE_DESCRIPTIONS[selectedRole]?.label || selectedRole;

            // 4. Notify admins (non-blocking)
            try {
                await notificationService.notifyAdminsOfNewUser(
                    companyId,
                    companyDisplayName,
                    user.displayName,
                    roleName
                );
            } catch (notifError) {
                console.warn("Could not send admin notifications:", notifError);
            }

            if (isNewCompany) {
                toast.success("Empresa criada e solicitação enviada!");
            } else {
                toast.success("Solicitação enviada! Aguarde a aprovação.");
            }
            
            router.push('/pending-approval');
        } catch (error) {
            console.error("Error submitting company setup:", error);
            toast.error("Erro ao enviar solicitação.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const availableRoles: UserRole[] = ['admin', 'financial_manager', 'approver', 'releaser', 'auditor', 'user'];
    const isFormValid = companyName.trim() && companyCnpj.trim() && selectedRole;

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/50 p-4">
            <div className="w-full max-w-lg space-y-4">
                {/* Header Card */}
                <Card>
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-2xl font-bold text-center">
                            Configurar Acesso
                        </CardTitle>
                        <CardDescription className="text-center">
                            Olá, {user?.displayName?.split(" ")[0]}! Informe os dados da empresa.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Company Form */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="companyName">Razão Social *</Label>
                                <Input
                                    id="companyName"
                                    value={companyName}
                                    onChange={handleNameChange}
                                    placeholder="Ex: Minha Empresa Ltda"
                                    className={errors.name ? "border-destructive" : ""}
                                />
                                {errors.name && (
                                    <p className="text-sm text-destructive flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        {errors.name}
                                    </p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="companyCnpj">CNPJ *</Label>
                                <Input
                                    id="companyCnpj"
                                    value={companyCnpj}
                                    onChange={handleCnpjChange}
                                    placeholder="00.000.000/0000-00"
                                    maxLength={18}
                                    className={errors.cnpj ? "border-destructive" : ""}
                                />
                                {errors.cnpj && (
                                    <p className="text-sm text-destructive flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        {errors.cnpj}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Role Selection */}
                        <div className="space-y-3 pt-2">
                            <Label>Selecione sua Função *</Label>
                            <RadioGroup
                                value={selectedRole || ""}
                                onValueChange={(value) => setSelectedRole(value as UserRole)}
                                className="grid gap-2"
                            >
                                {availableRoles.map((role) => {
                                    const roleInfo = ROLE_DESCRIPTIONS[role];
                                    return (
                                        <Label
                                            key={role}
                                            htmlFor={role}
                                            className={cn(
                                                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all overflow-hidden",
                                                "hover:border-primary/50 hover:bg-muted/50",
                                                selectedRole === role
                                                    ? "border-primary bg-primary/5"
                                                    : "border-border"
                                            )}
                                        >
                                            <RadioGroupItem value={role} id={role} className="shrink-0" />
                                            <div className="flex-1 min-w-0 overflow-hidden">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium">{roleInfo.label}</span>
                                                    {selectedRole === role && (
                                                        <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground line-clamp-2">
                                                    {roleInfo.description}
                                                </p>
                                            </div>
                                        </Label>
                                    );
                                })}
                            </RadioGroup>
                        </div>

                        {/* Submit */}
                        {isFormValid && (
                            <div className="pt-4 space-y-3">
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
                                    <Building2 className="h-5 w-5 text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{companyName}</p>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">{companyCnpj}</span>
                                            <Badge variant="secondary" className="text-xs">
                                                {ROLE_DESCRIPTIONS[selectedRole]?.label}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    className="w-full"
                                    onClick={handleSubmit}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <ArrowRight className="mr-2 h-4 w-4" />
                                    )}
                                    Solicitar Acesso
                                </Button>
                            </div>
                        )}

                        {/* Logout */}
                        <div className="pt-2">
                            <Button variant="ghost" className="w-full text-muted-foreground" onClick={logout}>
                                <LogOut className="mr-2 h-4 w-4" />
                                Sair da conta
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
