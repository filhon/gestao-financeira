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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

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

    const form = useForm<CostCenterFormData>({
        resolver: zodResolver(costCenterSchema),
        defaultValues: defaultValues || {
            name: "",
            code: "",
            description: "",
            budget: 0,
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

    // Filter out self and potential children (simple circular check: just self for now)
    const potentialParents = availableCostCenters.filter(cc => cc.id !== editingId);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Informações Básicas</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

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

                        <FormField
                            control={form.control}
                            name="budget"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Orçamento Inicial (Opcional)</FormLabel>
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

                <div className="space-y-4 border-t pt-4">
                    <h3 className="text-lg font-medium">Permissões e Controle</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
