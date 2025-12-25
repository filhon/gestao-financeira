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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye, MessageCircle, Loader2, Search, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { feedbackService } from "@/lib/services/feedbackService";
import { useAuth } from "@/components/providers/AuthProvider";
import { toast } from "sonner";

interface AdminFeedbackTableProps {
  feedbacks: Feedback[];
  onUpdate: () => void;
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

const priorityLabels: Record<FeedbackPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

const priorityColors: Record<FeedbackPriority, string> = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
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

export function AdminFeedbackTable({
  feedbacks,
  onUpdate,
  isLoading,
}: AdminFeedbackTableProps) {
  const { user } = useAuth();
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(
    null
  );
  const [responseText, setResponseText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResponseDialog, setShowResponseDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredFeedbacks = feedbacks.filter((feedback) => {
    if (statusFilter !== "all" && feedback.status !== statusFilter)
      return false;
    if (typeFilter !== "all" && feedback.type !== typeFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        feedback.title.toLowerCase().includes(query) ||
        feedback.description.toLowerCase().includes(query) ||
        feedback.userName.toLowerCase().includes(query) ||
        feedback.userEmail.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const handleOpenResponse = (feedback: Feedback) => {
    setSelectedFeedback(feedback);
    setResponseText(feedback.adminResponse || "");
    setShowResponseDialog(true);

    // Mark as read if not already
    if (!feedback.read) {
      feedbackService.markAsRead(feedback.id);
    }
  };

  const handleOpenDetails = (feedback: Feedback) => {
    setSelectedFeedback(feedback);
    setShowDetailsDialog(true);

    // Mark as read if not already
    if (!feedback.read) {
      feedbackService.markAsRead(feedback.id);
    }
  };

  const handleSubmitResponse = async () => {
    if (!selectedFeedback || !user || !responseText.trim()) return;

    try {
      setIsSubmitting(true);
      await feedbackService.respond(selectedFeedback.id, responseText.trim(), {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || undefined,
      });
      toast.success("Resposta enviada com sucesso!");
      setShowResponseDialog(false);
      setSelectedFeedback(null);
      setResponseText("");
      onUpdate();
    } catch (error) {
      console.error("Error responding to feedback:", error);
      toast.error("Erro ao enviar resposta.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (
    feedbackId: string,
    newStatus: FeedbackStatus
  ) => {
    try {
      await feedbackService.updateStatus(feedbackId, newStatus);
      toast.success("Status atualizado!");
      onUpdate();
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Erro ao atualizar status.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, descrição ou usuário..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              {Object.entries(statusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Tipos</SelectItem>
              {Object.entries(typeLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFeedbacks.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground"
                >
                  Nenhum feedback encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filteredFeedbacks.map((feedback) => (
                <TableRow
                  key={feedback.id}
                  className={cn(!feedback.read && "bg-primary/5")}
                >
                  <TableCell>
                    {!feedback.read && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{feedback.userName}</p>
                      <p className="text-xs text-muted-foreground">
                        {feedback.userEmail}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{typeLabels[feedback.type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        "text-xs",
                        priorityColors[feedback.priority]
                      )}
                    >
                      {priorityLabels[feedback.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate"
                    title={feedback.title}
                  >
                    {feedback.title}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={feedback.status}
                      onValueChange={(value) =>
                        handleStatusChange(feedback.id, value as FeedbackStatus)
                      }
                    >
                      <SelectTrigger
                        className={cn(
                          "w-[160px] text-xs h-8",
                          statusColors[feedback.status]
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(feedback.createdAt, "dd/MM/yyyy HH:mm", {
                      locale: ptBR,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDetails(feedback)}
                        title="Ver detalhes"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenResponse(feedback)}
                        title="Responder"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Feedback</DialogTitle>
            <DialogDescription>
              Enviado por {selectedFeedback?.userName} (
              {selectedFeedback?.userEmail})
            </DialogDescription>
          </DialogHeader>
          {selectedFeedback && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {typeLabels[selectedFeedback.type]}
                </Badge>
                <Badge
                  className={cn(
                    "text-xs",
                    priorityColors[selectedFeedback.priority]
                  )}
                >
                  {priorityLabels[selectedFeedback.priority]}
                </Badge>
                <Badge
                  className={cn(
                    "text-xs",
                    statusColors[selectedFeedback.status]
                  )}
                >
                  {statusLabels[selectedFeedback.status]}
                </Badge>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Título
                </h4>
                <p className="font-medium">{selectedFeedback.title}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Descrição
                </h4>
                <p className="whitespace-pre-wrap text-sm">
                  {selectedFeedback.description}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Funções Relacionadas
                </h4>
                <div className="flex flex-wrap gap-1">
                  {selectedFeedback.relatedFeatures.map((feature) => (
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

              {selectedFeedback.screenshotUrl && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">
                    Screenshot
                  </h4>
                  <a
                    href={selectedFeedback.screenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Ver anexo
                  </a>
                </div>
              )}

              {selectedFeedback.errorContext && (
                <div className="p-3 bg-destructive/10 rounded-md">
                  <h4 className="text-sm font-medium text-destructive mb-1">
                    Contexto do Erro
                  </h4>
                  <p className="text-xs font-mono">
                    {selectedFeedback.errorContext.message}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    URL: {selectedFeedback.errorContext.url}
                  </p>
                </div>
              )}

              {selectedFeedback.adminResponse && (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <h5 className="text-sm font-semibold text-primary mb-2">
                    Resposta Anterior
                  </h5>
                  <p className="text-sm whitespace-pre-wrap">
                    {selectedFeedback.adminResponse}
                  </p>
                  {selectedFeedback.respondedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Respondido por {selectedFeedback.respondedByEmail} em{" "}
                      {format(
                        selectedFeedback.respondedAt,
                        "dd/MM/yyyy 'às' HH:mm",
                        { locale: ptBR }
                      )}
                    </p>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Criado em{" "}
                {format(selectedFeedback.createdAt, "dd/MM/yyyy 'às' HH:mm", {
                  locale: ptBR,
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Response Dialog */}
      <Dialog open={showResponseDialog} onOpenChange={setShowResponseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Responder Feedback</DialogTitle>
            <DialogDescription>
              Respondendo a: &quot;{selectedFeedback?.title}&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Escreva sua resposta para o usuário..."
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              className="min-h-[150px]"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResponseDialog(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmitResponse}
              disabled={isSubmitting || !responseText.trim()}
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Enviar Resposta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
