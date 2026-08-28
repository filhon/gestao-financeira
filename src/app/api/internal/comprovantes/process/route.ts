/**
 * POST /api/internal/comprovantes/process
 *
 * Pipeline server-side de comprovantes:
 *   1. Baixa o arquivo do Storage via Admin SDK.
 *   2. Extrai texto (PDF layer) ou OCR via GenAI (imagens e PDFs sem camada de texto).
 *   3. Executa o algoritmo de matching contra transações pagas/autorizadas.
 *   4. Cria o documento em Firestore via Admin SDK (campos derivados confiáveis, server-authored).
 *
 * Segurança:
 *   - Requer cookie `auth_token` válido.
 *   - `storagePath` deve começar com "comprovantes/<companyId>/".
 *   - Criação no Firestore usa Admin SDK (bypass de regras) — o Firestore rules bloqueia create client-side.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import { matchComprovante } from "@/lib/matching";
import type { Entity, Transaction, ComprovanteMatchStatus } from "@/lib/types";
import { GoogleGenAI } from "@google/genai";
import { FieldValue } from "firebase-admin/firestore";

// ── Text helpers (mirrored from comprovanteService) ───────────────────────────

const normalizeSearch = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const tokenize = (text: string): string[] => {
  const normalized = normalizeSearch(text);
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);
  const tokens = new Set<string>(words);
  for (const word of words) {
    for (let i = 2; i <= word.length; i++) {
      tokens.add(word.slice(0, i));
    }
  }
  return [...tokens];
};

const buildSearchText = (parts: (string | undefined)[]): string =>
  parts.filter(Boolean).join(" ").slice(0, 1000);

// ── GenAI OCR ─────────────────────────────────────────────────────────────────

async function extractTextViaGenAI(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "";

  try {
    const ai = new GoogleGenAI({ apiKey });
    const base64 = fileBuffer.toString("base64");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            {
              text: `Extraia TODO o texto deste documento financeiro exatamente como aparece.
Preservar números, datas no formato dd/mm/aaaa, valores monetários no formato R$ e nomes de empresas/pessoas.
Retorne APENAS o texto extraído, sem comentários, sem markdown.`,
            },
          ],
        },
      ],
    });
    return response.text?.trim() ?? "";
  } catch (err) {
    console.error("[process-comprovante] OCR GenAI falhou:", err);
    return "";
  }
}

// ── Extract text from document ────────────────────────────────────────────────

async function extractText(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  // Images always go through GenAI OCR
  if (mimeType.startsWith("image/")) {
    return extractTextViaGenAI(fileBuffer, mimeType);
  }

  // PDFs: try pdfjs text layer first; fall back to GenAI if result is too short
  if (mimeType === "application/pdf") {
    try {
      const pdfjsLib = await import(
        "pdfjs-dist/legacy/build/pdf.mjs" as string
      ).catch(() => import("pdfjs-dist"));
      const pdf = await (pdfjsLib as typeof import("pdfjs-dist")).getDocument({
        data: fileBuffer,
      }).promise;
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length >= 20) return text;
    } catch {
      // pdfjs not available server-side — fall through to GenAI
    }
    // Fallback: GenAI OCR for scan PDFs
    return extractTextViaGenAI(fileBuffer, "application/pdf");
  }

  return "";
}

// ── Fetch transactions (Admin SDK) ────────────────────────────────────────────

interface RawTransaction {
  companyId: string;
  type: string;
  status: string;
  amount: number;
  finalAmount?: number;
  discount?: number;
  interest?: number;
  description: string;
  notes?: string;
  details?: string;
  barcode?: string;
  paymentMethod?: Transaction["paymentMethod"];
  supplierOrClient?: string;
  entityId?: string;
  comprovanteId?: string;
  paymentDate?: FirebaseFirestore.Timestamp;
  dueDate?: FirebaseFirestore.Timestamp;
}

/**
 * Candidatos ao match: pagáveis já pagos ou autorizados.
 *
 * Traz todos os campos que o motor usa como evidência — `barcode` (linha
 * digitável), `notes`/`details` (nº de NF), juros/desconto (o valor do
 * comprovante costuma ser o ajustado) e `comprovanteId` (para despriorizar
 * transações já conciliadas). Antes daqui só saíam valor, data e nome.
 */
async function fetchCandidateTransactions(
  companyId: string,
): Promise<Transaction[]> {
  const snap = await adminDb
    .collection("transactions")
    .where("companyId", "==", companyId)
    .where("type", "==", "payable")
    .where("status", "in", ["paid", "authorized"])
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as RawTransaction;
    return {
      id: d.id,
      companyId: data.companyId,
      type: "payable",
      status: data.status as Transaction["status"],
      amount: data.amount,
      finalAmount: data.finalAmount,
      discount: data.discount,
      interest: data.interest,
      description: data.description,
      notes: data.notes,
      details: data.details,
      barcode: data.barcode,
      paymentMethod: data.paymentMethod,
      supplierOrClient: data.supplierOrClient,
      entityId: data.entityId,
      comprovanteId: data.comprovanteId,
      paymentDate: data.paymentDate?.toDate(),
      dueDate: data.dueDate?.toDate() ?? new Date(),
      createdBy: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Transaction;
  });
}

/**
 * Cadastro de entidades da empresa — habilita o match por CNPJ/CPF,
 * chave Pix e agência/conta, que são os sinais decisivos num comprovante.
 */
async function fetchEntities(companyId: string): Promise<Entity[]> {
  const snap = await adminDb
    .collection("entities")
    .where("companyId", "==", companyId)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      companyId: data.companyId,
      name: data.name ?? "",
      type: data.type ?? "company",
      document: data.document,
      category: data.category ?? "supplier",
      bankName: data.bankName,
      agency: data.agency,
      account: data.account,
      pixKey: data.pixKey,
      pixKeyType: data.pixKeyType,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Entity;
  });
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    return NextResponse.json(
      { error: "Token inválido ou expirado." },
      { status: 401 },
    );
  }

  // ── Body ─────────────────────────────────────────────────────────────────────
  let body: {
    storagePath: string;
    companyId: string;
    pageNumber: number;
    totalPages: number;
    fileHash: string;
    uploadBatchId: string;
    uploadedBy: string;
    mimeType?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const {
    storagePath,
    companyId,
    pageNumber,
    totalPages,
    fileHash,
    uploadBatchId,
    uploadedBy,
    mimeType = "application/pdf",
  } = body;

  if (
    !storagePath ||
    !companyId ||
    !fileHash ||
    !uploadBatchId ||
    !uploadedBy ||
    pageNumber == null ||
    totalPages == null
  ) {
    return NextResponse.json(
      { error: "Campos obrigatórios ausentes." },
      { status: 400 },
    );
  }

  // ── Path validation ──────────────────────────────────────────────────────────
  if (
    !storagePath.startsWith("comprovantes/") ||
    storagePath.split("/")[1] !== companyId
  ) {
    return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  }

  // ── Authorization ────────────────────────────────────────────────────────────
  const claimsRole = decoded.role as string | undefined;
  const claimsCompanyRoles = decoded.companyRoles as
    | Record<string, unknown>
    | undefined;

  let hasAccess =
    claimsRole === "admin" ||
    (claimsCompanyRoles != null && companyId in claimsCompanyRoles);

  if (!hasAccess) {
    try {
      const userDoc = await adminDb.collection("users").doc(decoded.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data() ?? {};
        const dbRole = userData.role as string | undefined;
        const dbCompanyRoles = userData.companyRoles as
          | Record<string, unknown>
          | undefined;
        hasAccess =
          dbRole === "admin" ||
          (dbCompanyRoles != null && companyId in dbCompanyRoles);
      }
    } catch {
      // Firestore indisponível — negar acesso
    }
  }

  if (!hasAccess) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  // ── Role check: only financial_manager/admin can upload ──────────────────────
  const userRole =
    (claimsCompanyRoles?.[companyId] as string | undefined) ?? claimsRole;
  if (userRole !== "admin" && userRole !== "financial_manager") {
    // Re-check from Firestore
    try {
      const userDoc = await adminDb.collection("users").doc(decoded.uid).get();
      const dbCompanyRoles = userDoc.data()?.companyRoles as
        | Record<string, string>
        | undefined;
      const dbGlobalRole = userDoc.data()?.role as string | undefined;
      const effectiveRole =
        dbCompanyRoles?.[companyId] ?? dbGlobalRole ?? "user";
      if (effectiveRole !== "admin" && effectiveRole !== "financial_manager") {
        return NextResponse.json(
          { error: "Permissão insuficiente." },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
  }

  // ── Dedup: check if fileHash already exists ──────────────────────────────────
  const existing = await adminDb
    .collection("comprovantes")
    .where("companyId", "==", companyId)
    .where("fileHash", "==", fileHash)
    .limit(1)
    .get();

  if (!existing.empty) {
    const dup = existing.docs[0];
    return NextResponse.json(
      {
        comprovanteId: dup.id,
        duplicate: true,
        matchStatus: dup.data().matchStatus,
      },
      { status: 200 },
    );
  }

  // ── Download from Storage ────────────────────────────────────────────────────
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    return NextResponse.json(
      { error: "Configuração inválida." },
      { status: 500 },
    );
  }

  let fileBuffer: Buffer;
  let fileSize: number;
  try {
    const bucket = adminStorage.bucket(bucketName);
    const [contents] = await bucket.file(storagePath).download();
    fileBuffer = contents;
    fileSize = contents.length;
  } catch (err) {
    console.error("[process-comprovante] Erro ao baixar arquivo:", err);
    return NextResponse.json(
      { error: "Arquivo não encontrado no Storage." },
      { status: 404 },
    );
  }

  // ── Text extraction / OCR ────────────────────────────────────────────────────
  const extractedText = await extractText(fileBuffer, mimeType);

  // ── Fetch candidates + cadastro (evidência de CNPJ/Pix/conta) ────────────────
  const [candidates, entities] = await Promise.all([
    fetchCandidateTransactions(companyId),
    fetchEntities(companyId).catch(() => [] as Entity[]),
  ]);

  // ── Run matching algorithm ───────────────────────────────────────────────────
  const outcome =
    extractedText.length > 0
      ? matchComprovante(extractedText, candidates, { entities })
      : null;
  const best = outcome?.best ?? null;

  // ── Determine matchStatus ────────────────────────────────────────────────────
  let matchStatus: ComprovanteMatchStatus;
  if (best) {
    matchStatus = "pending_review";
  } else if (extractedText.length === 0) {
    matchStatus = "needs_manual";
  } else {
    matchStatus = "unmatched";
  }

  // ── Build searchText / tokens ────────────────────────────────────────────────
  const searchText = buildSearchText([best?.matchedEntity, extractedText]);
  const searchTokens = tokenize(searchText);

  // ── Create Firestore document (Admin SDK — server-authored) ──────────────────
  const docData: Record<string, unknown> = {
    companyId,
    uploadBatchId,
    pageNumber,
    totalPages,
    storagePath,
    fileSize,
    fileHash,
    matchStatus,
    isConsolidated: best?.isConsolidated ?? false,
    extractedText,
    searchText,
    searchTokens,
    uploadedBy,
    uploadedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Alternativas plausíveis: a revisão manual passa a ser escolher entre
  // poucas opções ranqueadas em vez de procurar na lista inteira.
  const alternatives = (outcome?.alternatives ?? []).map((candidate) => ({
    transactionId: candidate.transactionId,
    transactionIds: candidate.transactionIds,
    isConsolidated: candidate.isConsolidated,
    score: candidate.score,
    confidenceLevel: candidate.confidenceLevel,
    entityName: candidate.matchedEntity ?? null,
    reason: candidate.reasons[0] ?? null,
  }));

  if (best) {
    docData.suggestedTransactionId = best.transactionId;
    docData.suggestedTransactionIds = best.transactionIds;
    docData.matchConfidence = best.score;
    docData.matchConfidenceLevel = best.confidenceLevel;
    docData.matchReasons = best.reasons.slice(0, 6);
    docData.matchIsAmbiguous = best.isAmbiguous ?? false;
    docData.matchAlternatives = alternatives;
    if (best.matchedAmount != null) docData.matchedAmount = best.matchedAmount;
    if (best.matchedDate != null) docData.matchedDate = best.matchedDate;
    if (best.matchedEntity) docData.matchedEntity = best.matchedEntity;
  }

  const docRef = await adminDb.collection("comprovantes").add(docData);

  return NextResponse.json(
    {
      comprovanteId: docRef.id,
      matchStatus,
      suggestedTransactionId: best?.transactionId,
      suggestedTransactionIds: best?.transactionIds,
      isConsolidated: best?.isConsolidated ?? false,
      matchConfidence: best?.score,
      matchConfidenceLevel: best?.confidenceLevel,
      matchedAmount: best?.matchedAmount,
      matchedDate: best?.matchedDate?.toISOString(),
      matchedEntity: best?.matchedEntity,
      matchReasons: best?.reasons.slice(0, 6),
      matchIsAmbiguous: best?.isAmbiguous ?? false,
      matchAlternatives: alternatives,
    },
    { status: 201 },
  );
}
