"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TransactionFormData, transactionSchema } from "@/lib/validations/transaction";
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
    FormDescription
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { CostCenter } from "@/lib/types";
import { costCenterService } from "@/lib/services/costCenterService";
import { storageService } from "@/lib/services/storageService";

interface TransactionFormProps {
    defaultValues?: Partial<TransactionFormData>;
    onSubmit: (data: TransactionFormData) => Promise<void>;
    isLoading: boolean;
    onCancel: () => void;
    type: "payable" | "receivable";
}

export function TransactionForm({ defaultValues, onSubmit, isLoading, onCancel, type }: TransactionFormProps) {
    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    const form = useForm<TransactionFormData>({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            type,
            status: "draft",
            recurrence: {
                isRecurring: false,
                currentInstallment: 1,
            },
            costCenterAllocation: [{ costCenterId: "", percentage: 100, amount: 0 }],
            attachments: [],
            ...defaultValues,
        },
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "costCenterAllocation",
    });

    const { fields: attachmentFields, append: appendAttachment, remove: removeAttachment } = useFieldArray({
        control: form.control,
        name: "attachments",
    });

    useEffect(() => {
        const loadCostCenters = async () => {
            const data = await costCenterService.getAll();
            setCostCenters(data);
        };
        loadCostCenters();
    }, []);

    // Update allocation amounts when total amount changes
    const totalAmount = form.watch("amount");
    useEffect(() => {
        if (totalAmount) {
            const allocations = form.getValues("costCenterAllocation");
            const updatedAllocations = allocations.map(a => ({
                ...a,
                amount: (totalAmount * a.percentage) / 100
            }));
            form.setValue("costCenterAllocation", updatedAllocations);
        }
    }, [totalAmount, form]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                setIsUploading(true);
                const file = e.target.files[0];
                const uploadedFile = await storageService.uploadFile(file, "transactions");

                appendAttachment({
                    id: uploadedFile.id,
                    url: uploadedFile.url,
                    name: uploadedFile.name,
                    type: uploadedFile.type,
                    category: "invoice", // Default
                });
            } catch (error) {
                console.error("Upload failed", error);
            } finally {
                setIsUploading(false);
            }
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Descrição</FormLabel>
                                <FormControl>
                                    <Input placeholder="Ex: Pagamento AWS" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="supplierOrClient"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{type === 'payable' ? 'Fornecedor' : 'Cliente'}</FormLabel>
                                <FormControl>
                                    <Input placeholder="Nome da empresa ou pessoa" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Valor Total (R$)</FormLabel>
                                <FormControl>
                                    <Input type="number" step="0.01" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="dueDate"
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Data de Vencimento</FormLabel>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button
                                                variant={"outline"}
                                                className={cn(
                                                    "w-full pl-3 text-left font-normal",
                                                    !field.value && "text-muted-foreground"
                                                )}
                                            >
                                                {field.value ? (
                                                    format(field.value, "PPP", { locale: ptBR })
                                                ) : (
                                                    <span>Selecione uma data</span>
                                                )}
                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={field.value}
                                            onSelect={field.onChange}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                {/* Request Origin */}
                <div className="border rounded-lg p-4 space-y-4">
                    <h3 className="font-medium">Origem da Solicitação</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="requestOrigin.type"
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
                                            <SelectItem value="director">Diretor</SelectItem>
                                            <SelectItem value="department">Diretoria</SelectItem>
                                            <SelectItem value="sector">Setor</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="requestOrigin.name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nome da Origem</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Ex: Marketing ou João Silva" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* Cost Center Allocation */}
                <div className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium">Rateio por Centro de Custo</h3>
                        <Button type="button" variant="outline" size="sm" onClick={() => append({ costCenterId: "", percentage: 0, amount: 0 })}>
                            <Plus className="mr-2 h-4 w-4" /> Adicionar
                        </Button>
                    </div>

                    {fields.map((field, index) => (
                        <div key={field.id} className="flex gap-4 items-end">
                            <FormField
                                control={form.control}
                                name={`costCenterAllocation.${index}.costCenterId`}
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel>Centro de Custo</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione..." />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {costCenters.map((cc) => (
                                                    <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name={`costCenterAllocation.${index}.percentage`}
                                render={({ field }) => (
                                    <FormItem className="w-24">
                                        <FormLabel>%</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={e => {
                                                    field.onChange(parseFloat(e.target.value));
                                                    // Recalculate amount logic could go here too
                                                }}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                        </div>
                    ))}
                    <FormMessage>{form.formState.errors.costCenterAllocation?.root?.message}</FormMessage>
                </div>

                {/* Attachments */}
                <div className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium">Anexos</h3>
                        <div>
                            <Input
                                type="file"
                                id="file-upload"
                                className="hidden"
                                onChange={handleFileUpload}
                                disabled={isUploading}
                            />
                            <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('file-upload')?.click()} disabled={isUploading}>
                                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                Upload
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {attachmentFields.map((field, index) => (
                            <div key={field.id} className="flex items-center justify-between p-2 border rounded bg-muted/50">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{field.name}</span>
                                    <FormField
                                        control={form.control}
                                        name={`attachments.${index}.category`}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-8 w-[140px]">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="invoice">Nota Fiscal</SelectItem>
                                                    <SelectItem value="demand_proof">Comprovante</SelectItem>
                                                    <SelectItem value="other">Outro</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeAttachment(index)}>
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar Transação
                    </Button>
                </div>
            </form>
        </Form>
    );
}
