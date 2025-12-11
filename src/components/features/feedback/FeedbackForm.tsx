"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload, Trash2, Paperclip } from "lucide-react";
import { FeedbackType, FeedbackPriority, SystemFeature } from "@/lib/types";
import { feedbackService, CreateFeedbackData } from "@/lib/services/feedbackService";
import { storageService } from "@/lib/services/storageService";
import { useAuth } from "@/components/providers/AuthProvider";
import { toast } from "sonner";

const feedbackSchema = z.object({
    type: z.enum(["bug", "improvement", "question", "praise"]),
    priority: z.enum(["low", "medium", "high", "critical"]),
    relatedFeatures: z.array(z.string()).min(1, "Selecione pelo menos uma função"),
    title: z.string().min(5, "Título deve ter no mínimo 5 caracteres"),
    description: z.string().min(20, "Descreva o feedback com pelo menos 20 caracteres"),
    screenshotUrl: z.string().optional(),
});

type FeedbackFormData = z.infer<typeof feedbackSchema>;

interface FeedbackFormProps {
    onSuccess?: () => void;
    errorContext?: {
        message: string;
        url: string;
        timestamp: Date;
    };
}

const typeLabels: Record<FeedbackType, string> = {
    bug: "Bug / Problema",
    improvement: "Sugestão de Melhoria",
    question: "Dúvida",
    praise: "Elogio",
};

const priorityLabels: Record<FeedbackPriority, string> = {
    low: "Baixa",
    medium: "Média",
    high: "Alta",
    critical: "Crítica",
};

const featureLabels: Record<SystemFeature, string> = {
    dashboard: "Dashboard",
    contas_pagar: "Contas a Pagar",
    contas_receber: "Contas a Receber",
    centros_custo: "Centros de Custo",
    recorrencias: "Recorrências",
    lotes: "Lotes de Pagamento",
    relatorios: "Relatórios",
    configuracoes: "Configurações",
    cadastros: "Cadastros",
    outro: "Outro",
};

const allFeatures: SystemFeature[] = [
    "dashboard",
    "contas_pagar",
    "contas_receber",
    "centros_custo",
    "recorrencias",
    "lotes",
    "relatorios",
    "configuracoes",
    "cadastros",
    "outro",
];

export function FeedbackForm({ onSuccess, errorContext }: FeedbackFormProps) {
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const form = useForm<FeedbackFormData>({
        resolver: zodResolver(feedbackSchema),
        defaultValues: {
            type: errorContext ? "bug" : undefined,
            priority: errorContext ? "high" : "medium",
            relatedFeatures: [],
            title: errorContext ? `Erro: ${errorContext.message.substring(0, 50)}` : "",
            description: errorContext 
                ? `Erro encontrado:\n${errorContext.message}\n\nURL: ${errorContext.url}\n\nDetalhes adicionais:\n` 
                : "",
            screenshotUrl: undefined,
        },
    });

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                setIsUploading(true);
                const file = e.target.files[0];
                const uploadedFile = await storageService.uploadFile(file, "feedbacks");
                form.setValue("screenshotUrl", uploadedFile.url);
                toast.success("Screenshot anexado!");
            } catch (error) {
                console.error("Upload failed", error);
                toast.error("Erro ao fazer upload da imagem.");
            } finally {
                setIsUploading(false);
            }
        }
    };

    const onSubmit = async (data: FeedbackFormData) => {
        if (!user) {
            toast.error("Você precisa estar logado para enviar feedback.");
            return;
        }

        try {
            setIsSubmitting(true);

            const feedbackData: CreateFeedbackData = {
                userId: user.uid,
                userEmail: user.email || "",
                userName: user.displayName || "Usuário",
                type: data.type as FeedbackType,
                priority: data.priority as FeedbackPriority,
                relatedFeatures: data.relatedFeatures as SystemFeature[],
                title: data.title,
                description: data.description,
                screenshotUrl: data.screenshotUrl,
                errorContext,
            };

            await feedbackService.create(feedbackData);
            toast.success("Feedback enviado com sucesso! Obrigado pela sua contribuição.");
            form.reset();
            onSuccess?.();
        } catch (error) {
            console.error("Error submitting feedback:", error);
            toast.error("Erro ao enviar feedback. Tente novamente.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const selectedFeatures = form.watch("relatedFeatures");

    return (
        <Card>
            <CardHeader>
                <CardTitle>Enviar Feedback</CardTitle>
                <CardDescription>
                    Sua opinião nos ajuda a melhorar o sistema. Descreva bugs, sugestões ou dúvidas.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="type"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tipo de Feedback</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione o tipo" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {Object.entries(typeLabels).map(([value, label]) => (
                                                    <SelectItem key={value} value={value}>
                                                        {label}
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
                                name="priority"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Prioridade</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Selecione a prioridade" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {Object.entries(priorityLabels).map(([value, label]) => (
                                                    <SelectItem key={value} value={value}>
                                                        {label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="relatedFeatures"
                            render={() => (
                                <FormItem>
                                    <FormLabel>Funções Relacionadas</FormLabel>
                                    <FormDescription>
                                        Selecione uma ou mais funções do sistema relacionadas ao seu feedback.
                                    </FormDescription>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-2">
                                        {allFeatures.map((feature) => (
                                            <div key={feature} className="flex items-center space-x-2">
                                                <Checkbox
                                                    id={feature}
                                                    checked={selectedFeatures.includes(feature)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            form.setValue("relatedFeatures", [...selectedFeatures, feature]);
                                                        } else {
                                                            form.setValue(
                                                                "relatedFeatures",
                                                                selectedFeatures.filter((f) => f !== feature)
                                                            );
                                                        }
                                                    }}
                                                />
                                                <label
                                                    htmlFor={feature}
                                                    className="text-sm font-medium leading-none cursor-pointer"
                                                >
                                                    {featureLabels[feature]}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="title"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Título</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Resumo do seu feedback" {...field} />
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
                                        <Textarea
                                            placeholder="Descreva detalhadamente seu feedback. Para bugs, inclua os passos para reproduzir o problema."
                                            className="min-h-[120px]"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Anexo Section - following TransactionForm pattern */}
                        <div>
                            <FormLabel className="mb-2 block">Anexo (opcional)</FormLabel>
                            <div className="space-y-2">
                                {!form.watch("screenshotUrl") ? (
                                    <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md flex flex-col items-center justify-center gap-2">
                                        <Paperclip className="h-5 w-5" />
                                        <span>Nenhum anexo.</span>
                                        <Input
                                            type="file"
                                            id="screenshot-upload"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={handleFileUpload}
                                            disabled={isUploading}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => document.getElementById("screenshot-upload")?.click()}
                                            disabled={isUploading}
                                        >
                                            {isUploading ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Upload className="mr-2 h-4 w-4" />
                                            )}
                                            Anexar Screenshot
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between p-2 border rounded bg-muted/50">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                                            <span className="text-sm font-medium truncate">Screenshot anexado</span>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => form.setValue("screenshotUrl", undefined)}
                                        >
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Enviar Feedback
                            </Button>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
