/**
 * Admin API — Gerenciamento de API Keys
 *
 * GET  /api/v1/admin/keys          → listar chaves da empresa
 * POST /api/v1/admin/keys          → criar nova chave
 *
 * Protegido por cookie de sessão Firebase (auth_token).
 * Apenas administradores e gerentes financeiros podem acessar.
 */
import { NextRequest, NextResponse } from "next/server";
import { listApiKeys, createApiKey } from "@/lib/api/apiKeyService";
import { authenticateAdminRequest } from "@/lib/api/adminAuth";
import { logger } from "@/lib/logger";

// ── GET — Listar chaves ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.success) return auth.response;
    const { companyId } = auth;
    const keys = await listApiKeys(companyId);
    return NextResponse.json({ data: keys }, { status: 200 });
  } catch (error) {
    logger.error("Admin list API keys error", { error });
    return NextResponse.json(
      { error: "Erro interno ao listar chaves." },
      { status: 500 },
    );
  }
}

// ── POST — Criar nova chave ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.success) return auth.response;
    const { companyId, uid } = auth;
    const body = await request.json();
    const { name, permissions, allowedIPs, rateLimitPerMinute, expiresAt } =
      body as {
        name: string;
        permissions: Record<string, boolean>;
        allowedIPs?: string[];
        rateLimitPerMinute?: number;
        expiresAt?: string;
      };

    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return NextResponse.json(
        { error: "Campo 'name' obrigatório (mínimo 3 caracteres)." },
        { status: 400 },
      );
    }

    const result = await createApiKey({
      companyId,
      name: name.trim(),
      createdBy: uid,
      permissions: {
        balance: !!permissions?.balance,
        transactions: !!permissions?.transactions,
        budgets: !!permissions?.budgets,
        costCenters: !!permissions?.costCenters,
        financialSummary: !!permissions?.financialSummary,
      },
      allowedIPs: Array.isArray(allowedIPs) ? allowedIPs : [],
      rateLimitPerMinute:
        typeof rateLimitPerMinute === "number" ? rateLimitPerMinute : 60,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    return NextResponse.json(
      {
        data: {
          id: result.id,
          apiKey: result.apiKey, // Exibir APENAS uma vez
          secretKey: result.secretKey, // Exibir APENAS uma vez
          prefix: result.prefix,
          name: result.name,
          permissions: result.permissions,
        },
        warning:
          "Guarde a chave API e o segredo agora. Eles não poderão ser recuperados posteriormente.",
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error("Admin create API key error", { error });
    return NextResponse.json(
      { error: "Erro interno ao criar chave." },
      { status: 500 },
    );
  }
}
