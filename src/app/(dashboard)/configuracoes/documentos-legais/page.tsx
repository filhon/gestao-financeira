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
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import {
  DEFAULT_PRIVACY_POLICY,
  DEFAULT_TERMS_OF_SERVICE,
} from "@/lib/constants/legalDefaults";

export default function LegalDocumentsSettingsPage() {
  const [activeTab, setActiveTab] =
    useState<LegalDocumentType>("privacy_policy");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { canAccessSettings } = usePermissions();
  const router = useRouter();

  useEffect(() => {
    if (!canAccessSettings) {
      router.push("/");
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

    // Restore focus and selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  if (!canAccessSettings) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documentos Legais</h1>
        <p className="text-muted-foreground">
          Edite os termos de uso e política de privacidade da plataforma.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as LegalDocumentType)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="privacy_policy">
            Política de Privacidade
          </TabsTrigger>
          <TabsTrigger value="terms_of_service">Termos de Uso</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {activeTab === "privacy_policy"
                  ? "Política de Privacidade"
                  : "Termos de Uso"}
              </CardTitle>
              <CardDescription>
                Use Markdown para formatar o texto. As alterações serão
                refletidas imediatamente nas páginas públicas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="flex h-[400px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1 border rounded-md p-1 bg-muted/20">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("**", "**")}
                      title="Negrito"
                    >
                      <Bold className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("*", "*")}
                      title="Itálico"
                    >
                      <Italic className="h-4 w-4" />
                    </Button>
                    <div className="w-px h-6 bg-border mx-1 self-center" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("# ")}
                      title="Título 1"
                    >
                      <Heading1 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("## ")}
                      title="Título 2"
                    >
                      <Heading2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("### ")}
                      title="Título 3"
                    >
                      <Heading3 className="h-4 w-4" />
                    </Button>
                    <div className="w-px h-6 bg-border mx-1 self-center" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("- ")}
                      title="Lista com marcadores"
                    >
                      <List className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => insertMarkdown("1. ")}
                      title="Lista numerada"
                    >
                      <ListOrdered className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="min-h-[500px] font-mono text-sm"
                    placeholder="Digite o conteúdo aqui..."
                  />
                </div>
              )}
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || loading}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!saving && <Save className="mr-2 h-4 w-4" />}
                  Salvar Alterações
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Tabs>
    </div>
  );
}
