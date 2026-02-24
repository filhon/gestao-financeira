/**
 * Helper de autenticação para as rotas de admin da API.
 * Verifica o cookie `auth_token` (Firebase ID Token) e checa
 * se o usuário tem papel de admin ou gerente financeiro na empresa.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import type { UserProfile } from "@/lib/types";

const ALLOWED_ROLES = ["admin", "financial_manager"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

export type AdminAuthSuccess = {
  success: true;
  uid: string;
  profile: UserProfile;
  companyId: string;
};

export type AdminAuthFailure = {
  success: false;
  response: NextResponse;
};

export async function authenticateAdminRequest(
  request: NextRequest,
): Promise<AdminAuthSuccess | AdminAuthFailure> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Não autenticado." },
        { status: 401 },
      ),
    };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;

    const userDoc = await adminDb.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Perfil de usuário não encontrado." },
          { status: 403 },
        ),
      };
    }

    const profile = userDoc.data() as UserProfile;
    const isGlobalAdmin = profile.role === "admin";

    const companyId = request.headers.get("x-company-id") ?? "";
    if (!companyId) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Header 'x-company-id' obrigatório." },
          { status: 400 },
        ),
      };
    }

    const companyRole = profile.companyRoles?.[companyId];
    const effectiveRole = isGlobalAdmin ? "admin" : companyRole;

    if (
      !effectiveRole ||
      !ALLOWED_ROLES.includes(effectiveRole as AllowedRole)
    ) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Acesso negado. Papel insuficiente." },
          { status: 403 },
        ),
      };
    }

    return { success: true, uid, profile, companyId };
  } catch (err) {
    logger.error("Admin auth error", { err });
    return {
      success: false,
      response: NextResponse.json(
        { error: "Token inválido ou expirado." },
        { status: 401 },
      ),
    };
  }
}
