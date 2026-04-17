/**
 * GET /api/internal/storage-proxy?path=<storagePath>
 *
 * Proxy server-side para ficheiros do Firebase Storage, contornando
 * restrições de CORS quando o cliente tenta fazer fetch directo.
 *
 * Segurança:
 *   - Requer cookie `auth_token` válido (Firebase ID Token).
 *   - `path` deve começar com "comprovantes/<companyId>/" para evitar
 *     path traversal.
 *   - Acesso verificado via custom claims do token; se ausentes (token
 *     stale), cai back para consulta no Firestore (mesmo padrão do app).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
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

  // ── Path validation ───────────────────────────────────────────────────────
  const storagePath = req.nextUrl.searchParams.get("path");
  if (!storagePath || !storagePath.startsWith("comprovantes/")) {
    return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  }

  // Path format: comprovantes/<companyId>/<filename>
  const companyId = storagePath.split("/")[1];
  if (!companyId) {
    return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
  }

  // ── Authorization ─────────────────────────────────────────────────────────
  // 1st: check custom claims embedded in the ID token (fast path)
  const claimsRole = decoded.role as string | undefined;
  const claimsCompanyRoles = decoded.companyRoles as
    | Record<string, unknown>
    | undefined;

  let hasAccess =
    claimsRole === "admin" ||
    (claimsCompanyRoles != null && companyId in claimsCompanyRoles);

  // 2nd: if claims are absent/stale, fall back to Firestore (same pattern as
  //      the rest of the app — "DB fallback when claims are stale")
  if (!hasAccess && !claimsCompanyRoles && !claimsRole) {
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
      // Firestore unavailable — deny access conservatively
    }
  }

  if (!hasAccess) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  // ── Download from Storage ─────────────────────────────────────────────────
  try {
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
      console.error(
        "[storage-proxy] NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET não configurado",
      );
      return NextResponse.json(
        { error: "Configuração inválida." },
        { status: 500 },
      );
    }

    const bucket = adminStorage.bucket(bucketName);
    const file = bucket.file(storagePath);
    const [contents] = await file.download();

    return new NextResponse(contents as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${storagePath.split("/").pop()}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[storage-proxy] Erro ao baixar ficheiro:", err);
    return NextResponse.json(
      { error: "Ficheiro não encontrado." },
      { status: 404 },
    );
  }
}
