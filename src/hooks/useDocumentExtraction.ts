import { useState } from "react";
import type { ExtractedDocumentData } from "@/lib/services/documentExtractionService";
import type { Entity } from "@/lib/types";

interface ExtractionResult {
  data: ExtractedDocumentData;
  matchedEntity: Entity | null;
}

export function useDocumentExtraction() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractFromFile = async (
    file: File,
    companyId: string,
  ): Promise<ExtractionResult | null> => {
    setIsExtracting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);

      const response = await fetch("/api/v1/extract-document", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Erro ao processar documento");
      }

      const result = await response.json();
      return result as ExtractionResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      setError(message);
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  return { extractFromFile, isExtracting, error };
}
