"use client";

import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import {
  getLegalDocument,
  getLegalDocumentVersions,
  LegalDocumentVersion,
} from "@/lib/services/legalService";
import { ArrowLeft, ScrollText, History, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { DEFAULT_TERMS_OF_SERVICE } from "@/lib/constants/legalDefaults";
import { LegalVersionSidebar } from "@/components/features/legal/LegalVersionSidebar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function TermsOfServicePage() {
  const [content, setContent] = useState<string | null>(null);
  const [versions, setVersions] = useState<LegalDocumentVersion[]>([]);
  const [selectedVersion, setSelectedVersion] =
    useState<LegalDocumentVersion | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [currentContent, versionsList] = await Promise.all([
          getLegalDocument("terms_of_service"),
          getLegalDocumentVersions("terms_of_service"),
        ]);

        setContent(currentContent || DEFAULT_TERMS_OF_SERVICE);
        setVersions(versionsList);

        if (versionsList.length > 0) {
          setSelectedVersionId(versionsList[0].id);
          setSelectedVersion(versionsList[0]);
        }
      } catch (error) {
        console.error(error);
        setContent(DEFAULT_TERMS_OF_SERVICE);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSelectVersion = (version: LegalDocumentVersion) => {
    setContent(version.content);
    setSelectedVersionId(version.id);
    setSelectedVersion(version);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/50 py-10 px-4">
        <div className="container mx-auto max-w-6xl space-y-6">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>

          {/* Body skeleton */}
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* Sidebar skeleton */}
            <div className="hidden md:flex flex-col w-64 border bg-card rounded-xl px-4 py-6 gap-3">
              <Skeleton className="h-5 w-24 mb-2" />
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>

            {/* Content skeleton */}
            <Card className="flex-1 min-w-0">
              <CardContent className="p-6 md:p-10 space-y-4">
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <div className="pt-2 space-y-3">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
                <div className="pt-2 space-y-3">
                  <Skeleton className="h-6 w-2/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/50 py-10 px-4">
      <div className="container mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <ScrollText className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">Termos de Uso</h1>
              {selectedVersion && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  Atualizado em{" "}
                  {format(selectedVersion.createdAt, "dd 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </p>
              )}
            </div>
          </div>
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
          </Link>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <LegalVersionSidebar
            versions={versions}
            currentVersionId={selectedVersionId}
            onSelectVersion={handleSelectVersion}
            className="hidden md:block"
          />

          <Card className="flex-1 min-w-0">
            <CardContent className="p-6 md:p-10">
              {versions.length > 0 && selectedVersionId !== versions[0]?.id && (
                <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
                  <History className="h-4 w-4 shrink-0" />
                  <span>
                    Você está visualizando uma versão anterior deste documento.
                  </span>
                </div>
              )}
              <div className="prose dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkBreaks]}>
                  {content || ""}
                </ReactMarkdown>
              </div>
            </CardContent>
          </Card>

          <LegalVersionSidebar
            versions={versions}
            currentVersionId={selectedVersionId}
            onSelectVersion={handleSelectVersion}
            className="md:hidden w-full"
          />
        </div>

        {/* Footer */}
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <Link
              href="/termos-uso"
              className="hover:text-foreground transition-colors font-medium text-foreground"
            >
              Termos de Uso
            </Link>
            <Separator orientation="vertical" className="h-3" />
            <Link
              href="/politica-privacidade"
              className="hover:text-foreground transition-colors"
            >
              Política de Privacidade
            </Link>
          </div>
          <span>
            &copy; {new Date().getFullYear()} Fin Control. Todos os direitos
            reservados.
          </span>
        </div>
      </div>
    </div>
  );
}
