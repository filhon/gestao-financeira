/**
 * Admin API — Gerenciamento de API Keys por ID
 *
 * PATCH  /api/v1/admin/keys/[id]   → atualizar nome, permissões, IPs, rate limit
 * DELETE /api/v1/admin/keys/[id]   → revogar chave (soft-delete: active = false)
 *
 * Protegido por cookie de sessão Firebase (auth_token).
 */
import { NextRequest, NextResponse } from "next/server";
import { revokeApiKey, updateApiKey } from "@/lib/api/apiKeyService";
import { authenticateAdminRequest } from "@/lib/api/adminAuth";
import { logger } from "@/lib/logger";
import type { ApiKeyPermissions } from "@/lib/api/types";

// ── PATCH — Atualizar chave ───────────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: keyId } = await params;
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.success) return auth.response;
    const { companyId } = auth;
    const body = await request.json();
    const { name, permissions, allowedIPs, rateLimitPerMinute, expiresAt } =
      body as {
        name?: string;
        permissions?: Partial<ApiKeyPermissions>;
        allowedIPs?: string[];
        rateLimitPerMinute?: number;
        expiresAt?: string | null;
      };

    await updateApiKey(keyId, companyId, {
      ...(name !== undefined && { name }),
      ...(permissions !== undefined && { permissions }),
      ...(allowedIPs !== undefined && { allowedIPs }),
      ...(rateLimitPerMinute !== undefined && { rateLimitPerMinute }),
      ...(expiresAt !== undefined && {
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }),
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erro interno.";
    if (msg === "API Key not found") {
      return NextResponse.json(
        { error: "Chave não encontrada." },
        { status: 404 },
      );
    }
    if (msg === "Unauthorized") {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
    logger.error("Admin update API key error", { keyId, error });
    return NextResponse.json(
      { error: "Erro interno ao atualizar chave." },
      { status: 500 },
    );
  }
}

// ── DELETE — Revogar chave ────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: keyId } = await params;
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.success) return auth.response;
    const { companyId } = auth;
    await revokeApiKey(keyId, companyId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erro interno.";
    if (msg === "API Key not found") {
      return NextResponse.json(
        { error: "Chave não encontrada." },
        { status: 404 },
      );
    }
    if (msg === "Unauthorized") {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
    logger.error("Admin revoke API key error", { keyId, error });
    return NextResponse.json(
      { error: "Erro interno ao revogar chave." },
      { status: 500 },
    );
  }
}
