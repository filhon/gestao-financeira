"use client";

import { useState } from "react";
import Image from "next/image";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Loader2,
  Upload,
  Bug,
  ArrowUpCircle,
  HelpCircle,
  Heart,
  X,
} from "lucide-react";
import { FeedbackType, FeedbackPriority, SystemFeature } from "@/lib/types";
import {
  feedbackService,
  CreateFeedbackData,
} from "@/lib/services/feedbackService";
import { storageService } from "@/lib/services/storageService";
import { useAuth } from "@/components/providers/AuthProvider";
import { toast } from "sonner";

const feedbackSchema = z.object({
  type: z.enum(["bug", "improvement", "question", "praise"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  relatedFeatures: z
    .array(z.string())
    .min(1, "Selecione pelo menos uma função"),
  title: z.string().min(5, "Título deve ter no mínimo 5 caracteres"),
  description: z
    .string()
    .min(20, "Descreva o feedback com pelo menos 20 caracteres"),
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
  bug: "Bug",
  improvement: "Melhoria",
  question: "Dúvida",
  praise: "Elogio",
};

const typeConfig: Record<
  FeedbackType,
  {
    icon: React.ElementType;
    color: string;
    selectedBg: string;
    selectedBorder: string;
  }
> = {
  bug: {
    icon: Bug,
    color: "text-red-500",
    selectedBg: "bg-red-500/10",
    selectedBorder: "border-red-500/50",
  },
  improvement: {
    icon: ArrowUpCircle,
    color: "text-blue-500",
    selectedBg: "bg-blue-500/10",
    selectedBorder: "border-blue-500/50",
  },
  question: {
    icon: HelpCircle,
    color: "text-amber-500",
    selectedBg: "bg-amber-500/10",
    selectedBorder: "border-amber-500/50",
  },
  praise: {
    icon: Heart,
    color: "text-emerald-500",
    selectedBg: "bg-emerald-500/10",
    selectedBorder: "border-emerald-500/50",
  },
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
      title: errorContext
        ? `Erro: ${errorContext.message.substring(0, 50)}`
        : "",
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
      toast.success(
        "Feedback enviado com sucesso! Obrigado pela sua contribuição.",
      );
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
          Sua opinião nos ajuda a melhorar o sistema. Descreva bugs, sugestões
          ou dúvidas.
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
                    <FormControl>
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(typeConfig) as FeedbackType[]).map(
                          (type) => {
                            const {
                              icon: Icon,
                              color,
                              selectedBg,
                              selectedBorder,
                            } = typeConfig[type];
                            const isSelected = field.value === type;
                            return (
                              <button
                                key={type}
                                type="button"
                                onClick={() => field.onChange(type)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-150 ${
                                  isSelected
                                    ? `${selectedBg} ${selectedBorder} ${color}`
                                    : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                                }`}
                              >
                                <Icon
                                  className={`h-4 w-4 shrink-0 ${isSelected ? color : ""}`}
                                />
                                {typeLabels[type]}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </FormControl>
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
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a prioridade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(priorityLabels).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
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
                    Selecione uma ou mais funções relacionadas ao seu feedback.
                  </FormDescription>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {allFeatures.map((feature) => {
                      const isSelected = selectedFeatures.includes(feature);
                      return (
                        <button
                          key={feature}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              form.setValue(
                                "relatedFeatures",
                                selectedFeatures.filter((f) => f !== feature),
                              );
                            } else {
                              form.setValue("relatedFeatures", [
                                ...selectedFeatures,
                                feature,
                              ]);
                            }
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all duration-150 ${
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {featureLabels[feature]}
                        </button>
                      );
                    })}
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

            {/* Anexo Section */}
            <div>
              <FormLabel className="mb-2 block">
                Screenshot (opcional)
              </FormLabel>
              <Input
                type="file"
                id="screenshot-upload"
                className="hidden"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
              {!form.watch("screenshotUrl") ? (
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById("screenshot-upload")?.click()
                  }
                  disabled={isUploading}
                  className="w-full border-2 border-dashed border-border rounded-lg py-6 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Upload className="h-6 w-6" />
                  )}
                  <span className="text-sm font-medium">
                    {isUploading
                      ? "Enviando..."
                      : "Clique para anexar screenshot"}
                  </span>
                  <span className="text-xs">PNG, JPG, GIF até 10MB</span>
                </button>
              ) : (
                <div className="relative rounded-lg overflow-hidden border">
                  <Image
                    src={form.watch("screenshotUrl") || ""}
                    alt="Screenshot"
                    width={800}
                    height={400}
                    unoptimized
                    className="w-full max-h-48 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => form.setValue("screenshotUrl", undefined)}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                    aria-label="Remover screenshot"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" loading={isSubmitting}>
                Enviar Feedback
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
