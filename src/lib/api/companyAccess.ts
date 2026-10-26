/**
 * Papel do usuário autenticado (cookie `auth_token`) numa empresa.
 *
 * Custom claims primeiro; quando negam (ausentes ou desatualizadas), cai para
 * o perfil no Firestore, como a storage-proxy. Sem papel na empresa = 403.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/lib/types";

export type CompanyAccess =
  | { ok: true; uid: string; role: UserRole }
  | { ok: false; response: NextResponse };

const deny = (error: string, status: number): CompanyAccess => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

function roleFrom(
  data: Record<string, unknown> | undefined,
  companyId: string,
): UserRole | null {
  if (!data) return null;
  if (data.role === "admin") return "admin";
  const roles = data.companyRoles as Record<string, UserRole> | undefined;
  return roles?.[companyId] ?? null;
}

export async function authorizeCompany(
  companyId: string,
): Promise<CompanyAccess> {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return deny("Não autenticado.", 401);

  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    return deny("Token inválido ou expirado.", 401);
  }
  if (!companyId) return deny("Parâmetro 'companyId' é obrigatório.", 400);

  let role = roleFrom(decoded, companyId);
  if (!role) {
    const userDoc = await adminDb.collection("users").doc(decoded.uid).get();
    role = roleFrom(userDoc.data(), companyId);
  }
  if (!role) return deny("Acesso negado.", 403);
  return { ok: true, uid: decoded.uid, role };
}
