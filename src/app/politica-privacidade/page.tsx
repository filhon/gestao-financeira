"use client";

import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import {
  getLegalDocument,
  getLegalDocumentVersions,
  LegalDocumentVersion,
} from "@/lib/services/legalService";
import { Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { DEFAULT_PRIVACY_POLICY } from "@/lib/constants/legalDefaults";
import { LegalVersionSidebar } from "@/components/features/legal/LegalVersionSidebar";

export default function PrivacyPolicyPage() {
  const [content, setContent] = useState<string | null>(null);
  const [versions, setVersions] = useState<LegalDocumentVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [currentContent, versionsList] = await Promise.all([
          getLegalDocument("privacy_policy"),
          getLegalDocumentVersions("privacy_policy"),
        ]);

        setContent(currentContent || DEFAULT_PRIVACY_POLICY);
        setVersions(versionsList);

        // If we have versions, set the first one (latest) as selected initially
        if (versionsList.length > 0) {
          setSelectedVersionId(versionsList[0].id);
        }
      } catch (error) {
        console.error(error);
        setContent(DEFAULT_PRIVACY_POLICY);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSelectVersion = (version: LegalDocumentVersion) => {
    setContent(version.content);
    setSelectedVersionId(version.id);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/50 py-10 px-4">
      <div className="container mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">Política de Privacidade</span>
          </div>
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
          </Link>
        </div>

        <div className="flex flex-col md:flex-row gap-6 items-start">
          <LegalVersionSidebar
            versions={versions}
            currentVersionId={selectedVersionId}
            onSelectVersion={handleSelectVersion}
            className="hidden md:block"
          />

          <Card className="flex-1 min-w-0">
            <CardContent className="p-6 md:p-10">
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

        <div className="text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Fin Control. Todos os direitos
          reservados.
        </div>
      </div>
    </div>
  );
}
