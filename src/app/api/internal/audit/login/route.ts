/**
 * POST /api/internal/audit/login  { method }   Authorization: Bearer <idToken>
 *
 * Registra o login em `audit_logs` de cada empresa do usuário, com IP e
 * navegador. Fica no servidor porque o navegador não sabe o próprio IP e
 * porque só o Admin SDK grava esses campos sem o cliente poder forjá-los.
 */
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";

const METHODS: Record<string, string> = {
  google: "Google",
  email: "E-mail e senha",
};

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Token inválido." }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      method?: string;
    };
    const profile = (
      await adminDb.collection("users").doc(decoded.uid).get()
    ).data();
    const companyIds = Object.keys(profile?.companyRoles ?? {});
    if (companyIds.length === 0) return NextResponse.json({ ok: true });

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "desconhecido";
    const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);
    const name = profile?.displayName || decoded.email || decoded.uid;

    const batch = adminDb.batch();
    for (const companyId of companyIds) {
      batch.set(adminDb.collection("audit_logs").doc(), {
        companyId,
        userId: decoded.uid,
        userEmail: decoded.email ?? "",
        userName: name,
        action: "login",
        entity: "user",
        entityId: decoded.uid,
        subject: name,
        changedFields: [],
        details: {
          method: METHODS[body.method ?? ""] ?? "Outro",
          ipAddress,
          userAgent,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Login audit failed", { err });
    return NextResponse.json({ error: "Falha ao registrar." }, { status: 500 });
  }
}
