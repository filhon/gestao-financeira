/**
 * POST /api/internal/roadmap/similar  { companyId, text } → { ids }
 *
 * Enquanto o usuário escreve uma sugestão, aponta itens que já pedem a mesma
 * coisa, para ele votar em vez de duplicar. Só compara com o que a empresa
 * enxerga (os próprios itens e os públicos), igual às rules.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";
import { PUBLIC_STATUSES } from "@/lib/roadmap";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const PROMPT = (
  text: string,
  items: { id: string; title: string; description: string }[],
) => `Um cliente de um sistema financeiro está escrevendo uma sugestão de funcionalidade. Diga quais itens existentes pedem essencialmente a mesma coisa, mesmo com outras palavras ("avisos no zap" = "notificações via WhatsApp").

Responda só com um array JSON de ids, no máximo 3, do mais parecido ao menos. Itens apenas do mesmo assunto, mas com outro pedido, não entram. Nenhum parecido: [].

Sugestão: ${JSON.stringify(text)}

Itens:
${items.map((i) => `${i.id} | ${i.title} | ${i.description.slice(0, 160).replace(/\s+/g, " ")}`).join("\n")}`;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  const access = await authorizeCompany(companyId);
  if (!access.ok) return access.response;
  if (text.length < 8 || text.length > 1200) {
    return NextResponse.json({ ids: [] });
  }

  try {
    const ref = adminDb.collection("roadmap_items");
    const snaps = await Promise.all([
      ref.where("status", "in", PUBLIC_STATUSES).get(),
      ref.where("companyId", "==", companyId).get(),
    ]);
    const items = new Map<
      string,
      { id: string; title: string; description: string }
    >();
    snaps.forEach((s) =>
      s.docs.forEach((d) => {
        const data = d.data();
        if (data.mergedInto) return;
        items.set(d.id, {
          id: d.id,
          title: String(data.title ?? ""),
          description: String(data.description ?? ""),
        });
      }),
    );
    if (items.size === 0) return NextResponse.json({ ids: [] });

    // ponytail: manda tudo no prompt; passa a filtrar por embeddings se o roadmap passar de algumas centenas de itens
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: PROMPT(text, [...items.values()].slice(0, 300)) }],
        },
      ],
      config: { responseMimeType: "application/json" },
    });
    const parsed: unknown = JSON.parse(response.text ?? "[]");
    const ids = Array.isArray(parsed)
      ? parsed.filter((id): id is string => items.has(id)).slice(0, 3)
      : [];
    return NextResponse.json({ ids });
  } catch (error) {
    // Sem sugestão de parecidos o formulário segue funcionando
    logger.error("POST /api/internal/roadmap/similar failed", { error });
    return NextResponse.json({ ids: [] });
  }
}
