"use client";

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
} from "@/components/ui/form";
import { Loader2 } from "lucide-react";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CostCenter } from "@/lib/types";

interface CostCenterFormProps {
    defaultValues?: CostCenterFormData;
    onSubmit: (data: CostCenterFormData) => Promise<void>;
    isLoading: boolean;
    onCancel: () => void;
    availableCostCenters: CostCenter[];
    editingId?: string | null;
}

export function CostCenterForm({ defaultValues, onSubmit, isLoading, onCancel, availableCostCenters, editingId }: CostCenterFormProps) {
    const form = useForm<CostCenterFormData>({
        resolver: zodResolver(costCenterSchema),
        defaultValues: defaultValues || {
            name: "",
            code: "",
            description: "",
            budget: 0,
            parentId: "none", // Default to none
        },
    });

    // Filter out self and potential children (simple circular check: just self for now)
    const potentialParents = availableCostCenters.filter(cc => cc.id !== editingId);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                    name="budget"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Orçamento (Opcional)</FormLabel>
                            <FormControl>
                                <Input type="number" placeholder="0.00" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

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
