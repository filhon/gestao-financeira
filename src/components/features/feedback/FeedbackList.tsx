"use client";

import { useState } from "react";
import {
  Feedback,
  FeedbackStatus,
  FeedbackType,
  FeedbackPriority,
  SystemFeature,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, MessageCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface FeedbackListProps {
  feedbacks: Feedback[];
  isLoading?: boolean;
}

const typeLabels: Record<FeedbackType, string> = {
  bug: "Bug",
  improvement: "Sugestão",
  question: "Dúvida",
  praise: "Elogio",
};

const statusLabels: Record<FeedbackStatus, string> = {
  pending: "Pendente",
  in_review: "Em Análise",
  resolved: "Resolvido",
  wont_fix: "Não Será Implementado",
};

const statusColors: Record<FeedbackStatus, string> = {
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  in_review: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  wont_fix: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const priorityColors: Record<FeedbackPriority, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const featureLabels: Record<SystemFeature, string> = {
  dashboard: "Dashboard",
  contas_pagar: "Contas a Pagar",
  contas_receber: "Contas a Receber",
  centros_custo: "Centros de Custo",
  recorrencias: "Recorrências",
  lotes: "Lotes",
  relatorios: "Relatórios",
  configuracoes: "Configurações",
  cadastros: "Cadastros",
  outro: "Outro",
};

export function FeedbackList({ feedbacks, isLoading }: FeedbackListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <Clock className="h-5 w-5 animate-spin mr-2" />
            Carregando feedbacks...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (feedbacks.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Você ainda não enviou nenhum feedback.</p>
            <p className="text-sm mt-1">
              Use a aba &quot;Novo Feedback&quot; para nos enviar sua opinião!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meus Feedbacks</CardTitle>
        <CardDescription>
          Acompanhe o status dos seus feedbacks e veja as respostas dos
          desenvolvedores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedbacks.map((feedback) => {
          const isExpanded = expandedId === feedback.id;

          return (
            <div
              key={feedback.id}
              className="border rounded-lg overflow-hidden"
            >
              <div
                onClick={() => setExpandedId(isExpanded ? null : feedback.id)}
                className="w-full p-4 flex items-start justify-between hover:bg-muted/50 transition-colors text-left cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant="outline">{typeLabels[feedback.type]}</Badge>
                    <Badge
                      className={cn("text-xs", statusColors[feedback.status])}
                    >
                      {statusLabels[feedback.status]}
                    </Badge>
                    {feedback.adminResponse && (
                      <div className="relative" title="Respondido">
                        <MessageCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
                      </div>
                    )}
                  </div>
                  <h4 className="font-medium truncate">{feedback.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    {format(
                      feedback.createdAt,
                      "dd 'de' MMMM 'de' yyyy 'às' HH:mm",
                      { locale: ptBR }
                    )}
                  </p>
                </div>
                <div className="shrink-0 p-2">
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 border-t bg-muted/20">
                  <div className="py-4 space-y-4">
                    <div>
                      <h5 className="text-sm font-medium text-muted-foreground mb-1">
                        Prioridade
                      </h5>
                      <Badge
                        className={cn(
                          "text-xs",
                          priorityColors[feedback.priority]
                        )}
                      >
                        {feedback.priority.charAt(0).toUpperCase() +
                          feedback.priority.slice(1)}
                      </Badge>
                    </div>

                    <div>
                      <h5 className="text-sm font-medium text-muted-foreground mb-1">
                        Funções Relacionadas
                      </h5>
                      <div className="flex flex-wrap gap-1">
                        {feedback.relatedFeatures.map((feature) => (
                          <Badge
                            key={feature}
                            variant="secondary"
                            className="text-xs"
                          >
                            {featureLabels[feature]}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h5 className="text-sm font-medium text-muted-foreground mb-1">
                        Descrição
                      </h5>
                      <p className="text-sm whitespace-pre-wrap">
                        {feedback.description}
                      </p>
                    </div>

                    {feedback.screenshotUrl && (
                      <div>
                        <h5 className="text-sm font-medium text-muted-foreground mb-1">
                          Screenshot
                        </h5>
                        <a
                          href={feedback.screenshotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                        >
                          Ver anexo
                        </a>
                      </div>
                    )}

                    {feedback.adminResponse && (
                      <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                        <h5 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                          <MessageCircle className="h-4 w-4" />
                          Resposta dos Desenvolvedores
                        </h5>
                        <p className="text-sm whitespace-pre-wrap">
                          {feedback.adminResponse}
                        </p>
                        {feedback.respondedAt && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Respondido em{" "}
                            {format(
                              feedback.respondedAt,
                              "dd/MM/yyyy 'às' HH:mm",
                              { locale: ptBR }
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
