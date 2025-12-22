"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CostCenterFormData, costCenterSchema } from "@/lib/validations/costCenter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from "@/components/ui/form";
import { Loader2 } from "lucide-react";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CostCenter, UserProfile } from "@/lib/types";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useCompany } from "@/components/providers/CompanyProvider";
import { userService } from "@/lib/services/userService";
import { budgetService } from "@/lib/services/budgetService";
import { costCenterService } from "@/lib/services/costCenterService";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/utils";

interface CostCenterFormProps {
    defaultValues?: CostCenterFormData;
    onSubmit: (data: CostCenterFormData) => Promise<void>;
    isLoading: boolean;
    onCancel: () => void;
    availableCostCenters: CostCenter[];
    editingId?: string | null;
}

export function CostCenterForm({ defaultValues, onSubmit, isLoading, onCancel, availableCostCenters, editingId }: CostCenterFormProps) {
    const { selectedCompany } = useCompany();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [balanceInfo, setBalanceInfo] = useState<{
        fromReceivables: number;
        fromParent: number;
        allocatedToChildren: number;
        spentOnPayables: number;
        available: number;
    } | null>(null);
    const [parentBalanceInfo, setParentBalanceInfo] = useState<{
        available: number;
    } | null>(null);

    const form = useForm<CostCenterFormData>({
        resolver: zodResolver(costCenterSchema),
        defaultValues: defaultValues || {
            name: "",
            code: "",
            description: "",
            budget: 0,
            budgetYear: new Date().getFullYear(),
            parentId: "none",
            allowedUserIds: [],
            approverEmail: "",
            releaserEmail: "",
            budgetLimit: 0,
        },
    });

    useEffect(() => {
        const loadUsers = async () => {
            if (selectedCompany) {
                try {
                    const data = await userService.getAll(selectedCompany.id);
                    setUsers(data);
                } catch (error) {
                    console.error("Error loading users:", error);
                }
            }
        };
        loadUsers();
    }, [selectedCompany]);

    const watchedYear = form.watch("budgetYear");

    useEffect(() => {
        const loadBudget = async () => {
            if (editingId && watchedYear) {
                try {
                    const budget = await budgetService.getByCostCenterAndYear(editingId, watchedYear);
                    if (budget) {
                        form.setValue("budget", budget.amount);
                    } else {
                        // If no budget entry exists for this year
                        // If it's the current year, we might rely on the passed default value (legacy), 
                        // but only if we haven't touched the field yet? 
                        // Actually, simpler: if no budget entity, and year is NOT current year, 0.
                        // If year IS current year, we keep what was passed in defaultValues (which comes from cc.budget)
                        // UNLESS we want to force 0 for new years.

                        // Let's assume if we change year, we want to see that year's budget.
                        // If we are on the initial load (current year), defaultValues are used.
                        // If we change the year, we fetch.
                        if (watchedYear !== new Date().getFullYear()) {
                            form.setValue("budget", 0);
                        }
                    }
                } catch (error) {
                    console.error("Error loading budget:", error);
                }
            }
        };
        // Debounce or check if year actually changed? 
        // For now, simple effect.
        loadBudget();
    }, [editingId, watchedYear, form]);

    // Load balance info when editing (filtered by selected year)
    useEffect(() => {
        const loadBalance = async () => {
            if (editingId && selectedCompany && watchedYear) {
                try {
                    const balance = await costCenterService.getEffectiveBalance(editingId, selectedCompany.id, watchedYear);
                    setBalanceInfo(balance);
                } catch (error) {
                    console.error("Error loading balance:", error);
                }
            }
        };
        loadBalance();
    }, [editingId, selectedCompany, watchedYear]);

    // Watch parent selection and load parent's balance (filtered by selected year)
    const watchedParentId = form.watch("parentId");
    useEffect(() => {
        const loadParentBalance = async () => {
            if (watchedParentId && watchedParentId !== "none" && selectedCompany && watchedYear) {
                try {
                    const balance = await costCenterService.getEffectiveBalance(watchedParentId, selectedCompany.id, watchedYear);
                    setParentBalanceInfo({ available: balance.available });
                } catch (error) {
                    console.error("Error loading parent balance:", error);
                    setParentBalanceInfo(null);
                }
            } else {
                setParentBalanceInfo(null);
            }
        };
        loadParentBalance();
    }, [watchedParentId, selectedCompany, watchedYear]);

    // Filter out self and potential children (simple circular check: just self for now)
    const potentialParents = availableCostCenters.filter(cc => cc.id !== editingId);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Informações Básicas</h3>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-6">
                            <FormField
                                control={form.control}
                                name="parentId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Centro de Custo Pai (Opcional)</FormLabel>
                                        <Select
                                            onValueChange={(value) => field.onChange(value === "none" ? undefined : value)}
                                            defaultValue={field.value || "none"}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="none">Nenhum (Raiz)</SelectItem>
                                                {potentialParents.map((cc) => (
                                                    <SelectItem key={cc.id} value={cc.id}>
                                                        {cc.code} - {cc.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {parentBalanceInfo && (
                                            <p className="text-sm text-muted-foreground mt-1">
                                                Saldo disponível do pai: <span className={parentBalanceInfo.available > 0 ? "text-green-600 font-medium" : "text-muted-foreground"}>{formatCurrency(parentBalanceInfo.available)}</span>
                                            </p>
                                        )}
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12 md:col-span-3">
                            <FormField
                                control={form.control}
                                name="code"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Código</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: CC-001" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12 md:col-span-3">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nome</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ex: Marketing" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12 md:col-span-2">
                            <FormField
                                control={form.control}
                                name="budgetYear"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Ano</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={e => field.onChange(parseInt(e.target.value))}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12 md:col-span-4">
                            <FormField
                                control={form.control}
                                name="budget"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Orçamento</FormLabel>
                                        <FormControl>
                                            <CurrencyInput
                                                value={field.value}
                                                onChange={field.onChange}
                                                placeholder="0,00"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12">
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Descrição</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Descrição do centro de custo..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>
                </div>

                {/* Balance Info Section (only when editing) */}
                {editingId && balanceInfo && (
                    <div className="space-y-4 border-t pt-4">
                        <h3 className="text-lg font-medium">Saldo Disponível</h3>
                        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Receitas Projetadas:</span>
                                <span className="font-medium text-green-600">+{formatCurrency(balanceInfo.fromReceivables)}</span>
                            </div>
                            {balanceInfo.fromParent > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Recebido do Pai:</span>
                                    <span className="font-medium text-blue-600">+{formatCurrency(balanceInfo.fromParent)}</span>
                                </div>
                            )}
                            {balanceInfo.allocatedToChildren > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Alocado para Filhos:</span>
                                    <span className="font-medium text-orange-600">-{formatCurrency(balanceInfo.allocatedToChildren)}</span>
                                </div>
                            )}
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Despesas Previstas:</span>
                                <span className="font-medium text-red-600">-{formatCurrency(balanceInfo.spentOnPayables)}</span>
                            </div>
                            <div className="border-t pt-2 mt-2 flex justify-between">
                                <span className="font-semibold">Saldo Líquido:</span>
                                <span className={`font-bold ${balanceInfo.available >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatCurrency(balanceInfo.available)}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                <div className="space-y-4 border-t pt-4">
                    <h3 className="text-lg font-medium">Permissões e Controle</h3>

                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 md:col-span-6">
                            <FormField
                                control={form.control}
                                name="approverEmail"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>E-mail do Aprovador (Diretor)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="diretor@empresa.com" {...field} />
                                        </FormControl>
                                        <FormDescription>Responsável por aprovar despesas deste centro.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12 md:col-span-6">
                            <FormField
                                control={form.control}
                                name="releaserEmail"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>E-mail do Liberador (Financeiro)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="financeiro@empresa.com" {...field} />
                                        </FormControl>
                                        <FormDescription>Responsável por efetuar o pagamento.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="col-span-12 md:col-span-6">
                            <FormField
                                control={form.control}
                                name="budgetLimit"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Limite de Orçamento Mensal</FormLabel>
                                        <FormControl>
                                            <CurrencyInput
                                                value={field.value}
                                                onChange={field.onChange}
                                                placeholder="0,00"
                                            />
                                        </FormControl>
                                        <FormDescription>Valor máximo para alertas de gastos.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>

                    <FormField
                        control={form.control}
                        name="allowedUserIds"
                        render={() => (
                            <FormItem>
                                <div className="mb-4">
                                    <FormLabel className="text-base">Usuários Permitidos</FormLabel>
                                    <FormDescription>
                                        Selecione os usuários que podem lançar despesas neste centro de custo.
                                    </FormDescription>
                                </div>
                                <ScrollArea className="h-[200px] w-full rounded-md border p-4">
                                    {users.map((user) => (
                                        <FormField
                                            key={user.uid}
                                            control={form.control}
                                            name="allowedUserIds"
                                            render={({ field }) => {
                                                return (
                                                    <FormItem
                                                        key={user.uid}
                                                        className="flex flex-row items-start space-x-3 space-y-0 py-2"
                                                    >
                                                        <FormControl>
                                                            <Checkbox
                                                                checked={field.value?.includes(user.uid)}
                                                                onCheckedChange={(checked) => {
                                                                    return checked
                                                                        ? field.onChange([...(field.value || []), user.uid])
                                                                        : field.onChange(
                                                                            field.value?.filter(
                                                                                (value) => value !== user.uid
                                                                            )
                                                                        )
                                                                }}
                                                            />
                                                        </FormControl>
                                                        <FormLabel className="font-normal">
                                                            {user.displayName} <span className="text-xs text-muted-foreground">({user.email})</span>
                                                        </FormLabel>
                                                    </FormItem>
                                                )
                                            }}
                                        />
                                    ))}
                                </ScrollArea>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar
                    </Button>
                </div>
            </form>
        </Form>
    );
}
