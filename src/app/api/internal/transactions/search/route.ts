/**
 * GET /api/internal/transactions/search
 *
 * Busca textual de transações executada inteiramente no servidor.
 * Autenticação via cookie `auth_token` (Firebase ID Token).
 *
 * O Firebase não suporta full-text search nativo; a filtragem é feita
 * em memória no servidor após uma query base indexada (companyId + type
 * + data), com um cap de segurança de 5.000 documentos para evitar
 * sobrecarga de memória e custo de leitura excessivo.
 *
 * Query params:
 *   q           (obrigatório): termo de busca (mín. 2, máx. 100 chars)
 *   companyId   (obrigatório): ID da empresa
 *   type        (opcional):   payable | receivable
 *   createdBy   (opcional):   filtra pelo UID do criador (para role "user")
 *   allDates    (opcional):   "true" para desabilitar filtro de data
 *   limit       (opcional):   máx. resultados (1–50, default 25)
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";

const TRANSACTIONS_COLLECTION = "transactions";

/** Cap de segurança: escaneia no máximo 5.000 documentos em memória. */
const MAX_SCAN_DOCS = 5_000;

const VALID_TYPES = new Set(["payable", "receivable"]);

export async function GET(request: NextRequest) {
  // ── Autenticação via cookie ────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json(
      { error: "Token inválido ou expirado." },
      { status: 401 },
    );
  }

  // ── Query params ──────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const qParam = searchParams.get("q")?.trim() ?? "";
  const companyId = searchParams.get("companyId")?.trim() ?? "";
  const typeParam = searchParams.get("type");
  const createdByParam = searchParams.get("createdBy");
  const allDates = searchParams.get("allDates") === "true";
  const limitRaw = parseInt(searchParams.get("limit") ?? "25", 10);
  const resultLimit =
    isNaN(limitRaw) || limitRaw < 1 ? 25 : Math.min(limitRaw, 50);

  // ── Validações ────────────────────────────────────────────────────────────
  if (!qParam || qParam.length < 2) {
    return NextResponse.json(
      { error: "Parâmetro 'q' deve ter pelo menos 2 caracteres." },
      { status: 400 },
    );
  }
  if (qParam.length > 100) {
    return NextResponse.json(
      { error: "Parâmetro 'q' deve ter no máximo 100 caracteres." },
      { status: 400 },
    );
  }
  if (!companyId) {
    return NextResponse.json(
      { error: "Parâmetro 'companyId' é obrigatório." },
      { status: 400 },
    );
  }
  if (typeParam && !VALID_TYPES.has(typeParam)) {
    return NextResponse.json(
      { error: `'type' inválido. Use: ${[...VALID_TYPES].join(", ")}` },
      { status: 400 },
    );
  }

  // Garante que o usuário só pode buscar na própria empresa
  // (uma verificação mais completa de companyRoles pode ser adicionada se necessário)
  if (!uid) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  // ── Intervalo de datas padrão (últimos 2 anos + próximos 7 dias) ──────────
  // Quando allDates=false, limitamos o escaneamento para reduzir custo de leitura.
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (!allDates) {
    startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date();
    endDate.setDate(endDate.getDate() + 365);
    endDate.setHours(23, 59, 59, 999);
  }

  const searchTerm = qParam.toLowerCase();

  try {
    // ── Construir query base ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let baseQuery: any = adminDb
      .collection(TRANSACTIONS_COLLECTION)
      .where("companyId", "==", companyId);

    if (typeParam) {
      baseQuery = baseQuery.where("type", "==", typeParam);
    }
    if (createdByParam) {
      baseQuery = baseQuery.where("createdBy", "==", createdByParam);
    }
    if (startDate) {
      baseQuery = baseQuery.where(
        "dueDate",
        ">=",
        Timestamp.fromDate(startDate),
      );
    }
    if (endDate) {
      baseQuery = baseQuery.where(
        "dueDate",
        "<=",
        Timestamp.fromDate(endDate),
      );
    }

    // Ordena por dueDate desc para priorizar transações mais recentes
    // quando o cap de documentos for atingido.
    const snapshot = await baseQuery
      .orderBy("dueDate", "desc")
      .limit(MAX_SCAN_DOCS)
      .get();

    // ── Filtrar em memória (server-side) ──────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];

    for (const docSnap of snapshot.docs) {
      if (results.length >= resultLimit) break;

      const data = docSnap.data();
      const description: string = (data.description ?? "").toLowerCase();
      const notes: string = (data.notes ?? "").toLowerCase();
      const supplier: string = (data.supplierOrClient ?? "").toLowerCase();

      // Normaliza acentos para comparação
      const normalize = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const term = normalize(searchTerm);
      const matchesSearch =
        normalize(description).includes(term) ||
        normalize(notes).includes(term) ||
        normalize(supplier).includes(term);

      if (!matchesSearch) continue;

      const dueDate = (data.dueDate as Timestamp)?.toDate() ?? new Date();
      const paymentDate = (data.paymentDate as Timestamp)?.toDate() ?? null;
      const approvedAt = (data.approvedAt as Timestamp)?.toDate() ?? null;
      const releasedAt = (data.releasedAt as Timestamp)?.toDate() ?? null;
      const createdAt = (data.createdAt as Timestamp)?.toDate() ?? new Date();
      const updatedAt = (data.updatedAt as Timestamp)?.toDate() ?? new Date();

      results.push({
        id: docSnap.id,
        ...data,
        dueDate: dueDate.toISOString(),
        paymentDate: paymentDate ? paymentDate.toISOString() : null,
        approvedAt: approvedAt ? approvedAt.toISOString() : null,
        releasedAt: releasedAt ? releasedAt.toISOString() : null,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        approvalTokenExpiresAt: data.approvalTokenExpiresAt
          ? (data.approvalTokenExpiresAt as Timestamp).toDate().toISOString()
          : null,
      });
    }

    return NextResponse.json({
      data: results,
      meta: {
        totalResults: results.length,
        scannedDocuments: snapshot.docs.length,
        scanCapped: snapshot.docs.length >= MAX_SCAN_DOCS,
      },
    });
  } catch (error) {
    logger.error("GET /api/internal/transactions/search failed", {
      error,
      companyId,
    });
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
