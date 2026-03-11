import { NextRequest, NextResponse } from "next/server";
import { extractDocumentData } from "@/lib/services/documentExtractionService";
import { adminDb } from "@/lib/firebase/admin";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyId = formData.get("companyId") as string | null;

    if (!file || !companyId) {
      return NextResponse.json(
        { error: "Arquivo e companyId são obrigatórios" },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de arquivo não suportado. Use PDF, PNG, JPEG ou WebP." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Arquivo excede o tamanho máximo de 10MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extractedData = await extractDocumentData(buffer, file.type);

    // Buscar entidade pelo CNPJ/CPF extraído
    let matchedEntity = null;
    if (extractedData.supplierDocument) {
      const cleanDoc = extractedData.supplierDocument.replace(/\D/g, "");
      if (cleanDoc.length >= 11) {
        const entitiesSnapshot = await adminDb
          .collection("entities")
          .where("companyId", "==", companyId)
          .where("document", "==", cleanDoc)
          .limit(1)
          .get();

        if (!entitiesSnapshot.empty) {
          const doc = entitiesSnapshot.docs[0];
          matchedEntity = { id: doc.id, ...doc.data() };
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: extractedData,
      matchedEntity,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("Erro ao extrair documento:", message, stack);
    return NextResponse.json(
      { error: `Erro ao processar o documento: ${message}` },
      { status: 500 },
    );
  }
}
