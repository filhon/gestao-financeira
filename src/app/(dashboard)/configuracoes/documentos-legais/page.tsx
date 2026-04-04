"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getLegalDocument,
  saveLegalDocument,
  LegalDocumentType,
} from "@/lib/services/legalService";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  FileText,
  Eye,
  Code2,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import {
  DEFAULT_PRIVACY_POLICY,
  DEFAULT_TERMS_OF_SERVICE,
} from "@/lib/constants/legalDefaults";
import { cn } from "@/lib/utils";

export default function LegalDocumentsSettingsPage() {
  const [activeTab, setActiveTab] =
    useState<LegalDocumentType>("privacy_policy");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const { canAccessSettings } = usePermissions();
  const router = useRouter();

  useEffect(() => {
    if (!canAccessSettings) {
      router.push("/dashboard");
    }
  }, [canAccessSettings, router]);

  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      try {
        const data = await getLegalDocument(activeTab);
        if (data) {
          setContent(data);
        } else {
          setContent(
            activeTab === "privacy_policy"
              ? DEFAULT_PRIVACY_POLICY
              : DEFAULT_TERMS_OF_SERVICE
          );
        }
      } catch (error) {
        console.error(error);
        toast.error("Erro ao carregar documento.");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [activeTab]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveLegalDocument(activeTab, content);
      toast.success("Documento salvo com sucesso!");
    } catch (error) {
      console.error(error);
      toast.error("Erro ao salvar documento.");
    } finally {
      setSaving(false);
    }
  };

  const insertMarkdown = (prefix: string, suffix: string = "") => {
    const textarea = document.querySelector("textarea");
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const selection = text.substring(start, end);
    const after = text.substring(end);

    const newText = `${before}${prefix}${selection}${suffix}${after}`;
    setContent(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const wordCount = content.trim()
    ? content.trim().split(/\s+/).length
    : 0;
  const charCount = content.length;

  if (!canAccessSettings) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationFillMode: "both" }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800/60 shrink-0">
          <FileText className="h-5 w-5 text-slate-600 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Documentos Legais
          </h1>
          <p className="text-sm text-muted-foreground">
            Edite os Termos de Uso e Política de Privacidade da plataforma.
          </p>
        </div>
      </div>

      {/* Document selector + editor */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "60ms", animationFillMode: "both" }}
      >
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as LegalDocumentType);
            setViewMode("edit");
          }}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
            <TabsTrigger value="privacy_policy">
              Política de Privacidade
            </TabsTrigger>
            <TabsTrigger value="terms_of_service">Termos de Uso</TabsTrigger>
          </TabsList>

          <div className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {activeTab === "privacy_policy"
                        ? "Política de Privacidade"
                        : "Termos de Uso"}
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      Use Markdown para formatar. As alterações serão
                      refletidas imediatamente nas páginas públicas.
                    </CardDescription>
                  </div>

                  {/* View mode toggle */}
                  <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 gap-1.5 px-2.5 text-xs transition-all",
                        viewMode === "edit" &&
                          "bg-background shadow-sm text-foreground"
                      )}
                      onClick={() => setViewMode("edit")}
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      Editor
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 gap-1.5 px-2.5 text-xs transition-all",
                        viewMode === "preview" &&
                          "bg-background shadow-sm text-foreground"
                      )}
                      onClick={() => setViewMode("preview")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                {loading ? (
                  <div className="flex h-[500px] items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  </div>
                ) : viewMode === "edit" ? (
                  <div className="space-y-2">
                    {/* Markdown toolbar */}
                    <div className="flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/20 px-1 py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("**", "**")}
                        title="Negrito"
                      >
                        <Bold className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("*", "*")}
                        title="Itálico"
                      >
                        <Italic className="h-3.5 w-3.5" />
                      </Button>

                      <div className="mx-1 h-4 w-px bg-border" />

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("# ")}
                        title="Título 1"
                      >
                        <Heading1 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("## ")}
                        title="Título 2"
                      >
                        <Heading2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("### ")}
                        title="Título 3"
                      >
                        <Heading3 className="h-3.5 w-3.5" />
                      </Button>

                      <div className="mx-1 h-4 w-px bg-border" />

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("- ")}
                        title="Lista com marcadores"
                      >
                        <List className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => insertMarkdown("1. ")}
                        title="Lista numerada"
                      >
                        <ListOrdered className="h-3.5 w-3.5" />
                      </Button>

                      {/* Word / char counter pushed to the right */}
                      <div className="ml-auto flex items-center gap-2 pr-1">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {wordCount} palavras · {charCount} caracteres
                        </span>
                      </div>
                    </div>

                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="min-h-[500px] font-mono text-sm resize-y"
                      placeholder="Digite o conteúdo aqui..."
                    />
                  </div>
                ) : (
                  /* Preview pane */
                  <div className="min-h-[500px] rounded-md border bg-muted/10 px-6 py-5">
                    {content.trim() ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        {content.split("\n").map((line, i) => {
                          if (line.startsWith("### "))
                            return (
                              <h3
                                key={i}
                                className="text-base font-semibold mt-4 mb-1"
                              >
                                {line.slice(4)}
                              </h3>
                            );
                          if (line.startsWith("## "))
                            return (
                              <h2
                                key={i}
                                className="text-lg font-semibold mt-5 mb-1.5"
                              >
                                {line.slice(3)}
                              </h2>
                            );
                          if (line.startsWith("# "))
                            return (
                              <h1
                                key={i}
                                className="text-xl font-bold mt-6 mb-2"
                              >
                                {line.slice(2)}
                              </h1>
                            );
                          if (line.startsWith("- "))
                            return (
                              <li key={i} className="ml-4 text-sm">
                                {line.slice(2)}
                              </li>
                            );
                          if (line === "")
                            return <div key={i} className="h-3" />;
                          return (
                            <p key={i} className="text-sm leading-relaxed">
                              {line
                                .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
                                .map((part, j) => {
                                  if (
                                    part.startsWith("**") &&
                                    part.endsWith("**")
                                  )
                                    return (
                                      <strong key={j}>
                                        {part.slice(2, -2)}
                                      </strong>
                                    );
                                  if (
                                    part.startsWith("*") &&
                                    part.endsWith("*")
                                  )
                                    return (
                                      <em key={j}>{part.slice(1, -1)}</em>
                                    );
                                  return part;
                                })}
                            </p>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-sm text-muted-foreground">
                          Nenhum conteúdo para visualizar.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer actions */}
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">
                    As alterações só são publicadas após salvar.
                  </p>
                  <Button
                    onClick={handleSave}
                    disabled={saving || loading}
                    size="sm"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-3.5 w-3.5" />
                    )}
                    Salvar Alterações
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
