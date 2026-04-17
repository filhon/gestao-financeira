import { PDFDocument } from "pdf-lib";

export interface SplitPage {
  blob: Blob;
  pageNumber: number; // 1-based
  totalPages: number;
}

/**
 * Splits a multi-page PDF into individual single-page PDF blobs.
 */
export async function splitPdfPages(file: File): Promise<SplitPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = srcDoc.getPageCount();

  const pages: SplitPage[] = [];

  for (let i = 0; i < totalPages; i++) {
    const newDoc = await PDFDocument.create();
    const [copied] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(copied);
    const bytes = await newDoc.save();
    pages.push({
      blob: new Blob([bytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      }),
      pageNumber: i + 1,
      totalPages,
    });
  }

  return pages;
}

/**
 * Extracts plain text from the first page of a PDF blob using pdfjs-dist.
 * Returns an empty string on failure (never throws).
 */
export async function extractTextFromPdf(blob: Blob): Promise<string> {
  try {
    // Dynamic import keeps pdfjs out of the server bundle
    const pdfjsLib = await import("pdfjs-dist");

    // pdfjs v4+ requires an explicit worker source
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();

    return textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    console.error("[pdfUtils] Text extraction failed:", err);
    return "";
  }
}
