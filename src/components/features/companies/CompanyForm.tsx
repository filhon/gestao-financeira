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
import { Company } from "@/lib/types";
import { useEffect } from "react";

const companySchema = z.object({
    name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
    cnpj: z.string().optional(),
    logoUrl: z.string().url("URL inválida").optional().or(z.literal("")),
    address: z.string().optional(),
    phone: z.string().optional(),
});

type CompanyFormData = z.infer<typeof companySchema>;

interface CompanyFormProps {
    defaultValues?: Partial<Company>;
    onSubmit: (data: CompanyFormData) => Promise<void>;
    isLoading?: boolean;
}

export function CompanyForm({ defaultValues, onSubmit, isLoading }: CompanyFormProps) {
    const form = useForm<CompanyFormData>({
        resolver: zodResolver(companySchema),
        defaultValues: {
            name: "",
            cnpj: "",
            logoUrl: "",
            address: "",
            phone: "",
            ...defaultValues,
        },
    });

    useEffect(() => {
        if (defaultValues) {
            form.reset({
                name: defaultValues.name || "",
                cnpj: defaultValues.cnpj || "",
                logoUrl: defaultValues.logoUrl || "",
                address: defaultValues.address || "",
                phone: defaultValues.phone || "",
            });
        }
    }, [defaultValues, form]);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-6">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nome da Empresa</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Minha Empresa" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12 md:col-span-6">
                        <FormField
                            control={form.control}
                            name="cnpj"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>CNPJ (Opcional)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="00.000.000/0000-00" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="col-span-12">
                        <FormField
                            control={form.control}
                            name="logoUrl"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>URL do Logo (Opcional)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="https://..." {...field} />
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
                                        <Input placeholder="Rua..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? "Salvando..." : "Salvar Empresa"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
