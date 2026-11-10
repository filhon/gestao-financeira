import { NextRequest, NextResponse } from "next/server";
import { extractDocumentData } from "@/lib/services/documentExtractionService";
import { adminDb } from "@/lib/firebase/admin";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { limitAi } from "@/lib/api/aiRateLimit";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/xml",
  "application/xml",
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

    // Sessão do app (cookie) com papel na empresa: sem isso, qualquer um
    // gastaria a cota da IA e leria cadastros de outras empresas.
    const access = await authorizeCompany(companyId);
    if (!access.ok) return access.response;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            "Tipo de arquivo não suportado. Use PDF, PNG, JPEG, WebP ou o XML da nota.",
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Arquivo excede o tamanho máximo de 10MB." },
        { status: 400 },
      );
    }
    const limited = await limitAi("extract-document", access.uid);
    if (limited) return limited;

    const type =
      formData.get("type") === "receivable" ? "receivable" : "payable";
    // Com o CNPJ da empresa, a leitura não confunde a própria empresa com o
    // fornecedor ou o cliente.
    const company = await adminDb.collection("companies").doc(companyId).get();
    const companyDocument =
      String(company.get("cnpj") ?? "").replace(/\D/g, "") || null;

    const buffer = Buffer.from(await file.arrayBuffer());
    const extractedData = await extractDocumentData(buffer, file.type, {
      type,
      companyDocument,
    });

    // Buscar entidade pelo CNPJ/CPF lido (já conferido pelo dígito verificador)
    let matchedEntity = null;
    if (extractedData.counterpartyDocument) {
      const entitiesSnapshot = await adminDb
        .collection("entities")
        .where("companyId", "==", companyId)
        .where("document", "==", extractedData.counterpartyDocument)
        .limit(1)
        .get();

      if (!entitiesSnapshot.empty) {
        const doc = entitiesSnapshot.docs[0];
        matchedEntity = { id: doc.id, ...doc.data() };
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
