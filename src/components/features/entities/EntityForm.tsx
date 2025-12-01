"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Entity } from "@/lib/types";
import { useEffect } from "react";

const entitySchema = z.object({
    name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
    type: z.enum(["individual", "company"]),
    document: z.string().optional(),
    email: z.string().email("E-mail inválido").optional().or(z.literal("")),
    phone: z.string().optional(),
    address: z.string().optional(),
    category: z.enum(["supplier", "client", "both"]),
});

type EntityFormData = z.infer<typeof entitySchema>;

interface EntityFormProps {
    defaultValues?: Partial<Entity>;
    onSubmit: (data: EntityFormData) => Promise<void>;
    isLoading?: boolean;
}

export function EntityForm({ defaultValues, onSubmit, isLoading }: EntityFormProps) {
    const form = useForm<EntityFormData>({
        resolver: zodResolver(entitySchema),
        defaultValues: {
            name: "",
            type: "company",
            document: "",
            email: "",
            phone: "",
            address: "",
            category: "supplier",
            ...defaultValues,
        },
    });

    useEffect(() => {
        if (defaultValues) {
            form.reset({
                name: defaultValues.name || "",
                type: defaultValues.type || "company",
                document: defaultValues.document || "",
                email: defaultValues.email || "",
                phone: defaultValues.phone || "",
                address: defaultValues.address || "",
                category: defaultValues.category || "supplier",
            });
        }
    }, [defaultValues, form]);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-8">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nome / Razão Social</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Nome da entidade" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-4">
                        <FormField
                            control={form.control}
                            name="type"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Tipo</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione o tipo" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="company">Pessoa Jurídica</SelectItem>
                                            <SelectItem value="individual">Pessoa Física</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-4">
                        <FormField
                            control={form.control}
                            name="category"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Categoria</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione a categoria" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="supplier">Fornecedor</SelectItem>
                                            <SelectItem value="client">Cliente</SelectItem>
                                            <SelectItem value="both">Ambos</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-4">
                        <FormField
                            control={form.control}
                            name="document"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>CPF / CNPJ</FormLabel>
                                    <FormControl>
                                        <Input placeholder="000.000.000-00" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-4">
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>E-mail</FormLabel>
                                    <FormControl>
                                        <Input placeholder="contato@exemplo.com" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-6">
                        <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Telefone</FormLabel>
                                    <FormControl>
                                        <Input placeholder="(00) 00000-0000" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-6">
                        <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Endereço</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Rua, Número, Bairro..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? "Salvando..." : "Salvar Entidade"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
