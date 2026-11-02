/**
 * Documentação da API externa (Markdown), só para administradores.
 *
 * GET /api/internal/api-docs → texto Markdown com a Base URL deste ambiente.
 * O PDF é gerado no navegador a partir deste mesmo texto.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { authenticateAdminRequest } from "@/lib/api/adminAuth";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const auth = await authenticateAdminRequest(request, {
    globalAdminOnly: true,
  });
  if (!auth.success) return auth.response;

  try {
    const raw = await readFile(
      path.join(
        process.cwd(),
        "docs",
        "API_EXTERNA_DOCUMENTACAO_INTEGRACAO.md",
      ),
      "utf8",
    );
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const md = raw.replace("https://{seu-dominio}", origin.replace(/\/$/, ""));

    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logger.error("API docs read error", { error });
    return NextResponse.json(
      { error: "Não foi possível ler a documentação." },
      { status: 500 },
    );
  }
}
