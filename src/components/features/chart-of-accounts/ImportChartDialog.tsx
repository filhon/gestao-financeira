"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { cn } from "@/lib/utils";
import {
  chartOfAccountsService,
  ImportPreview,
} from "@/lib/services/chartOfAccountsService";
import { CHART_MODELS, ChartModelKey } from "@/lib/chartOfAccountsModels";
import { ACCOUNT_TYPE_LABEL, AccountDraft } from "@/lib/chartOfAccounts";

interface ImportChartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  actor: { uid: string; email: string };
  /** Abre já pré-visualizando um modelo pronto em vez de pedir arquivo. */
  model?: ChartModelKey | null;
  onImported: () => void;
}

type State =
  | { step: "upload" }
  | { step: "loading" }
  | { step: "preview"; preview: ImportPreview; source: string }
  | { step: "saving"; preview: ImportPreview; source: string };

export function ImportChartDialog({
  open,
  onOpenChange,
  companyId,
  actor,
  model,
  onImported,
}: ImportChartDialogProps) {
  const [state, setState] = useState<State>({ step: "upload" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async (
    source: string,
    read: () => Promise<{
      drafts: AccountDraft[];
      issues: { message: string; line?: number }[];
    }>,
  ) => {
    setState({ step: "loading" });
    try {
      const { drafts, issues } = await read();
      if (drafts.length === 0 && issues.length === 0) {
        toast.error("A planilha não tem nenhuma conta.");
        setState({ step: "upload" });
        return;
      }
      const preview = await chartOfAccountsService.previewImport(
        companyId,
        drafts,
      );
      // Erros de leitura (valor não reconhecido) vêm antes dos de estrutura.
      preview.issues = [...issues, ...preview.issues];
      setState({ step: "preview", preview, source });
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao ler o arquivo.",
      );
      setState({ step: "upload" });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (model) {
      void load(`modelo ${CHART_MODELS[model].label}`, async () => ({
        drafts: [...CHART_MODELS[model].accounts],
        issues: [],
      }));
    } else {
      setState({ step: "upload" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model]);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) {
      toast.error("Use um arquivo .xlsx, .xls ou .csv.");
      return;
    }
    void load(file.name, () => chartOfAccountsService.parseFile(file));
  };

  const confirm = async () => {
    if (state.step !== "preview") return;
    setState({ ...state, step: "saving" });
    try {
      await chartOfAccountsService.applyImport(
        companyId,
        state.preview,
        actor,
        state.source,
      );
      const { toCreate, toUpdate } = state.preview;
      toast.success(
        `Plano de contas importado: ${toCreate.length} ${toCreate.length === 1 ? "criada" : "criadas"}, ${toUpdate.length} ${toUpdate.length === 1 ? "atualizada" : "atualizadas"}.`,
      );
      onImported();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Erro ao gravar o plano.",
      );
      setState({ ...state, step: "preview" });
    }
  };

  const preview =
    state.step === "preview" || state.step === "saving" ? state.preview : null;
  const hasIssues = !!preview && preview.issues.length > 0;
  const nothingToDo =
    !!preview &&
    !hasIssues &&
    preview.toCreate.length + preview.toUpdate.length === 0;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>
            {model
              ? `Usar modelo: ${CHART_MODELS[model].label}`
              : "Importar plano de contas"}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {model
              ? "Confira o que será criado. Depois você pode renomear, incluir e arquivar contas à vontade."
              : "Planilha Excel ou CSV no formato do modelo. Contas com código existente são atualizadas, as novas são criadas e nada é excluído."}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {state.step === "upload" && (
          <div className="space-y-5 py-2">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files[0]);
              }}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <Upload className="h-7 w-7 text-muted-foreground" />
              <span className="text-sm font-medium">
                {dragOver
                  ? "Solte para enviar"
                  : "Arraste a planilha ou clique para escolher"}
              </span>
              <span className="text-xs text-muted-foreground">
                .xlsx, .xls ou .csv
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Modelos para preencher</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <TemplateButton
                  icon={FileSpreadsheet}
                  title="Modelo em branco (Excel)"
                  hint="Colunas, listas de opções e instruções"
                  onClick={() =>
                    chartOfAccountsService.downloadSpreadsheet({
                      kind: "blank",
                    })
                  }
                />
                <TemplateButton
                  icon={FileText}
                  title="Modelo em branco (CSV)"
                  hint="Separado por ponto e vírgula"
                  onClick={chartOfAccountsService.downloadCsvTemplate}
                />
                {(Object.keys(CHART_MODELS) as ChartModelKey[]).map((key) => (
                  <TemplateButton
                    key={key}
                    icon={FileSpreadsheet}
                    title={`Plano sugerido: ${CHART_MODELS[key].label}`}
                    hint="Para ajustar e importar"
                    onClick={() =>
                      chartOfAccountsService.downloadSpreadsheet({
                        kind: "model",
                        model: key,
                      })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {state.step === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Conferindo o plano...
          </div>
        )}

        {preview && hasIssues && (
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2.5 text-sm text-red-800 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                {preview.issues.length === 1
                  ? "Há 1 problema"
                  : `Há ${preview.issues.length} problemas`}{" "}
                na planilha. Nada foi gravado: corrija e envie de novo.
              </p>
            </div>
            <ul className="max-h-72 overflow-y-auto rounded-md border divide-y text-sm">
              {preview.issues.slice(0, 200).map((issue, i) => (
                <li key={i} className="px-3 py-2 flex gap-3">
                  {issue.line && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground pt-0.5 w-14">
                      linha {issue.line}
                    </span>
                  )}
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview && !hasIssues && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Novas" value={preview.toCreate.length} accent />
              <Stat label="Atualizadas" value={preview.toUpdate.length} />
              <Stat label="Sem mudança" value={preview.unchanged} />
              <Stat
                label="Mantidas"
                value={preview.kept}
                hint="já existem e não estão no arquivo"
              />
            </div>
            {nothingToDo ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />O plano já
                está igual ao arquivo.
              </p>
            ) : (
              <ul className="max-h-72 overflow-y-auto rounded-md border divide-y text-sm">
                {[
                  ...preview.toCreate.map((a) => ({ a, tag: "nova" })),
                  ...preview.toUpdate.map(({ next }) => ({
                    a: next,
                    tag: "atualizada",
                  })),
                ]
                  .slice(0, 300)
                  .map(({ a, tag }) => (
                    <li
                      key={a.code}
                      className="px-3 py-1.5 flex items-center gap-2"
                      style={{
                        paddingLeft: `${12 + (a.code.split(".").length - 1) * 14}px`,
                      }}
                    >
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {a.code}
                      </span>
                      <span
                        className={cn(
                          "truncate",
                          a.type === "synthetic" && "font-medium",
                        )}
                      >
                        {a.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {ACCOUNT_TYPE_LABEL[a.type]} · {tag}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <ResponsiveModalFooter>
          {preview && !model && (
            <Button
              variant="outline"
              onClick={() => setState({ step: "upload" })}
              disabled={state.step === "saving"}
            >
              Escolher outro arquivo
            </Button>
          )}
          {preview && !hasIssues && !nothingToDo ? (
            <Button onClick={confirm} loading={state.step === "saving"}>
              Importar {preview.toCreate.length + preview.toUpdate.length}{" "}
              {preview.toCreate.length + preview.toUpdate.length === 1
                ? "conta"
                : "contas"}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          )}
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function TemplateButton({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof FileText;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">
          {hint}
        </span>
      </span>
    </button>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border px-3 py-2" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          accent && value > 0 && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
    </div>
  );
}
