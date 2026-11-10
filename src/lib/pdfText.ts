/**
 * Camada de texto de um PDF, no servidor: uma linha de saída por linha do PDF
 * (`hasEOL`), espaços colapsados. Vazio quando é digitalização sem texto.
 *
 * Dois cuidados que, faltando, faziam a leitura falhar sempre em silêncio:
 *   • o pdfjs recusa `Buffer` no Node: vai uma cópia em `Uint8Array`;
 *   • no Node o pdfjs carrega o worker por caminho relativo, que não
 *     sobrevive ao bundle do Next: o worker vai por `globalThis.pdfjsWorker`.
 *
 * Sem alias de caminho: os scripts de medição importam este arquivo direto.
 */
export async function pdfText(data: Uint8Array, maxPages = 5): Promise<string> {
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    const lines: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      const raw = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      for (const line of raw.split("\n")) {
        const clean = line.replace(/\s+/g, " ").trim();
        if (clean) lines.push(clean);
      }
    }
    return lines.join("\n");
  } finally {
    await pdf.destroy();
  }
}
