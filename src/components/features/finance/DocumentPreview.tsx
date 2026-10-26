"use client";

import { useState } from "react";
import { FileQuestion, Loader2 } from "lucide-react";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/**
 * PDF em <iframe> (visualizador nativo); imagem em <img>. Sem tipo conhecido,
 * tenta o <iframe>; DOCX/XLSX e afins o navegador baixaria, então nem tenta.
 */
export function DocumentPreview({
  url,
  name,
  type,
  title,
}: {
  url: string;
  /** Nome ou caminho do arquivo: a extensão decide quando não há `type`. */
  name: string;
  /** MIME, quando conhecido. */
  type?: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const isImage = type ? type.startsWith("image/") : IMAGE_EXT.test(name);
  const framable =
    !type ||
    type === "application/pdf" ||
    type.startsWith("text/") ||
    type.endsWith("xml");

  if (!isImage && !framable) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
        <FileQuestion className="h-6 w-6" />
        <p>Pré-visualização indisponível para este tipo de arquivo.</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden rounded-md border bg-background">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando documento…
        </div>
      )}
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={title}
          onLoad={() => setLoaded(true)}
          className="h-full w-full overflow-auto object-contain"
        />
      ) : (
        <iframe
          src={`${url}#view=FitH`}
          title={title}
          onLoad={() => setLoaded(true)}
          className="h-full w-full"
        />
      )}
    </div>
  );
}
