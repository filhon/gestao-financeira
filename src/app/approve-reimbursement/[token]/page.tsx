"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";

interface ReportData {
  rdNumber: string;
  employeeName: string;
  employeeDocument?: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  transactionCount: number;
  status: string;
  notes?: string;
}

type PageState =
  | "loading"
  | "ready"
  | "confirming_reject"
  | "success_approve"
  | "success_reject"
  | "error"
  | "already_processed";

export default function ApproveReimbursementPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const initialAction = searchParams.get("action") as
    | "approve"
    | "reject"
    | null;

  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadReport = async () => {
      try {
        const res = await fetch(
          `/api/internal/reimbursement-approve?token=${encodeURIComponent(token)}`,
        );
        const data = await res.json();

        if (!res.ok) {
          setErrorMessage(data.error || "Token inválido ou expirado.");
          setPageState("error");
          return;
        }

        if (data.status !== "pending_approval") {
          setReportData(data);
          setPageState("already_processed");
          return;
        }

        setReportData(data);

        if (initialAction === "reject") {
          setPageState("confirming_reject");
        } else {
          setPageState("ready");
        }
      } catch {
        setErrorMessage("Erro ao carregar dados do relatório.");
        setPageState("error");
      }
    };

    loadReport();
  }, [token, initialAction]);

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/internal/reimbursement-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "approve" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao aprovar.");
        setPageState("error");
      } else {
        setPageState("success_approve");
      }
    } catch {
      setErrorMessage("Erro de conexão. Tente novamente.");
      setPageState("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (rejectReason.trim().length < 3) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/internal/reimbursement-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "reject", reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Erro ao recusar.");
        setPageState("error");
      } else {
        setPageState("success_reject");
      }
    } catch {
      setErrorMessage("Erro de conexão. Tente novamente.");
      setPageState("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (iso: string) =>
    format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">
            Fin Control
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Relatório de Despesas
          </h1>
        </div>

        {pageState === "loading" && (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </CardContent>
          </Card>
        )}

        {pageState === "error" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
              <p className="font-semibold text-slate-800">Link inválido</p>
              <p className="text-sm text-slate-500">{errorMessage}</p>
            </CardContent>
          </Card>
        )}

        {pageState === "already_processed" && reportData && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              {reportData.status === "approved" ||
              reportData.status === "paid" ? (
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
              ) : (
                <XCircle className="h-10 w-10 text-slate-400 mx-auto" />
              )}
              <p className="font-semibold text-slate-800">
                {reportData.status === "approved" ||
                reportData.status === "paid"
                  ? "Este relatório já foi aprovado."
                  : reportData.status === "rejected"
                    ? "Este relatório já foi recusado."
                    : "Este relatório não está mais aguardando aprovação."}
              </p>
              <p className="text-sm text-slate-500">
                {reportData.rdNumber} · {reportData.employeeName}
              </p>
            </CardContent>
          </Card>
        )}

        {(pageState === "ready" || pageState === "confirming_reject") &&
          reportData && (
            <Card>
              <CardHeader className="border-b bg-slate-900 rounded-t-lg">
                <p className="text-xs text-slate-400 uppercase tracking-wider">
                  Relatório de Despesas
                </p>
                <CardTitle className="text-white text-2xl">
                  {reportData.rdNumber}
                </CardTitle>
                <CardDescription className="text-slate-300">
                  Aguardando sua decisão
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500 text-xs uppercase tracking-wide">
                      Funcionário
                    </p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {reportData.employeeName}
                    </p>
                    {reportData.employeeDocument && (
                      <p className="text-slate-500 text-xs">
                        CPF: {reportData.employeeDocument}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs uppercase tracking-wide">
                      Período
                    </p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {formatDate(reportData.periodStart)} —{" "}
                      {formatDate(reportData.periodEnd)}
                    </p>
                    <p className="text-slate-500 text-xs">
                      {reportData.transactionCount} lançamento(s)
                    </p>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <p className="text-xs text-green-700 uppercase tracking-wide font-medium">
                    Total do Reembolso
                  </p>
                  <p className="text-3xl font-bold text-green-800 mt-1">
                    {formatCurrency(reportData.totalAmount)}
                  </p>
                </div>

                {reportData.notes && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">
                      Observações
                    </p>
                    <p className="text-sm text-slate-700">{reportData.notes}</p>
                  </div>
                )}

                {pageState === "ready" && (
                  <div className="flex gap-3 pt-2">
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700"
                      onClick={handleApprove}
                      loading={isSubmitting}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Aprovar Reembolso
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                      onClick={() => setPageState("confirming_reject")}
                      disabled={isSubmitting}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Recusar
                    </Button>
                  </div>
                )}

                {pageState === "confirming_reject" && (
                  <div className="space-y-3 pt-2">
                    <div>
                      <Label
                        htmlFor="reject-reason"
                        className="text-sm font-medium"
                      >
                        Motivo da recusa <span className="text-red-500">*</span>
                      </Label>
                      <Textarea
                        id="reject-reason"
                        placeholder="Descreva o motivo da recusa..."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={3}
                        className="mt-1.5"
                      />
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setPageState("ready")}
                        disabled={isSubmitting}
                      >
                        Voltar
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={handleReject}
                        loading={isSubmitting}
                        disabled={rejectReason.trim().length < 3}
                      >
                        Confirmar Recusa
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

        {pageState === "success_approve" && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-9 w-9 text-green-600" />
                </div>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-900">
                  Reembolso aprovado!
                </p>
                <p className="text-slate-500 text-sm mt-2">
                  O relatório foi aprovado com sucesso. O funcionário será
                  notificado sobre o pagamento.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {pageState === "success_reject" && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="h-9 w-9 text-red-600" />
                </div>
              </div>
              <div>
                <p className="text-xl font-bold text-slate-900">
                  Reembolso recusado
                </p>
                <p className="text-slate-500 text-sm mt-2">
                  O relatório foi recusado. O solicitante será notificado.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          Fin Control · Gestão Financeira
        </p>
      </div>
    </div>
  );
}
