/**
 * POST /api/internal/cash-closing-link   (sem login: o token é a credencial)
 *   { token }                     o fechamento que o link mostra
 *   { token, file }               endereço temporário do pacote ou da síntese
 *
 * O documento do link tem como id o SHA-256 do token. Cada abertura e cada
 * download ficam registrados. POST, e não GET: antivírus de e-mail que visita
 * endereços não conta como acesso.
 */
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { endOfMonth } from "date-fns";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { periodName, synthesisTitle } from "@/lib/cashSynthesis";
import { signedClosingUrl } from "@/lib/api/closingFiles";
import { linkState } from "@/lib/cashClosing";

const body = z.object({
  token: z.string().min(40).max(60),
  file: z.enum(["package", "summary"]).optional(),
});

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

const DEAD: Record<string, string> = {
  expired: "Este link venceu. Peça um novo a quem enviou.",
  revoked: "Este link foi cancelado. Peça um novo a quem enviou.",
};

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "desconhecido";
  if (
    !checkRateLimit({
      identifier: `closing-link:${ip}`,
      maxRequests: 30,
      windowSeconds: 60,
    }).success
  )
    return fail("Muitas tentativas. Aguarde um minuto.", 429);

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Link inválido.", 404);
  const { token, file } = parsed.data;

  try {
    const ref = adminDb
      .collection("cash_closing_links")
      .doc(createHash("sha256").update(token, "utf8").digest("hex"));
    const link = await ref.get();
    if (!link.exists) return fail("Link inválido.", 404);
    const state = linkState(
      {
        expiresAt: (link.get("expiresAt") as Timestamp).toDate(),
        revokedAt: (link.get("revokedAt") as Timestamp | undefined)?.toDate(),
      },
      new Date(),
    );
    if (DEAD[state]) return fail(DEAD[state], 410);

    const closing = await adminDb
      .collection("cash_closings")
      .doc(link.get("closingId"))
      .get();
    if (!closing.exists) return fail("Link inválido.", 404);
    const c = closing.data()!;

    const batch = adminDb.batch();
    batch.create(ref.collection("accesses").doc(), {
      kind: file ?? "view",
      at: FieldValue.serverTimestamp(),
      ip: ip.slice(0, 60),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200),
    });
    batch.update(ref, {
      [file ? "downloads" : "views"]: FieldValue.increment(1),
      lastAccessAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    if (file) {
      return NextResponse.json({
        url: await signedClosingUrl(
          c.files[file].path,
          c.period,
          c.version,
          file,
        ),
      });
    }

    const company = await adminDb
      .collection("companies")
      .doc(c.companyId)
      .get();
    const [y, m] = (c.period as string).split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = endOfMonth(start);
    return NextResponse.json({
      companyName: company.get("name") ?? "",
      cnpj: company.get("cnpj") ?? null,
      periodName: periodName(start, end),
      headline: synthesisTitle(
        { closing: c.closing, inflow: c.inflow, outflow: c.outflow, lines: [] },
        c.proof,
        start,
        end,
        true,
      ),
      opening: c.opening,
      inflow: c.inflow,
      outflow: c.outflow,
      closing: c.closing,
      count: c.lines.length,
      proof: c.proof,
      reason: c.reason ?? null,
      gaps: c.gaps,
      version: c.version,
      superseded: c.status !== "active",
      closedBy: c.closedBy.name,
      closedAt: (c.closedAt as Timestamp).toDate().toISOString(),
      expiresAt: (link.get("expiresAt") as Timestamp).toDate().toISOString(),
      files: {
        package: {
          size: c.files.package.size,
          sha256: c.files.package.sha256,
        },
        summary: {
          size: c.files.summary.size,
          sha256: c.files.summary.sha256,
        },
      },
    });
  } catch (error) {
    console.error("[cash-closing-link]", error);
    return fail("Não foi possível abrir. Tente de novo.", 500);
  }
}
