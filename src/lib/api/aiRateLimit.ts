/**
 * Limite de uso das rotas de IA. Toda rota que chama o Gemini passa por aqui
 * antes de chamar, sem exceção.
 *
 * Contador por janela fixa no Firestore (`rate_limits`, só Admin SDK: as
 * rules negam tudo que não está listado). Fica no banco, e não em memória,
 * para valer igual em todas as instâncias do servidor. Cada janela é um
 * documento próprio, então não há reinício a coordenar: incrementa e lê.
 *
 * `expiresAt` serve para a política de TTL do Firestore apagar as janelas
 * velhas (configurar uma vez no console, campo `expiresAt` de `rate_limits`).
 */
import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { logger } from "@/lib/logger";

/** Chamadas por minuto, por quem chama (usuário, ou o link do funcionário). */
export const AI_LIMITS = {
  analytics: 20,
  "search-interpret": 20,
  // O envio de comprovantes manda 4 páginas por vez; um PDF grande chega
  // perto de 1 por segundo. O limite fica acima disso e abaixo de abuso.
  comprovantes: 240,
  "investment-statement": 10,
  "roadmap-similar": 20,
  "extract-document": 20,
  "expense-link": 10,
} as const;

export type AiScope = keyof typeof AI_LIMITS;

const WINDOW_MS = 60_000;

/**
 * null = pode chamar a IA. Senão, a resposta 429 (com Retry-After) ou 503,
 * se o contador não pôde ser lido: sem contador, a IA não é chamada.
 */
export async function limitAi(
  scope: AiScope,
  who: string,
): Promise<NextResponse | null> {
  const now = Date.now();
  const window = Math.floor(now / WINDOW_MS);
  const ref = adminDb
    .collection("rate_limits")
    .doc(`ai_${scope}_${who}_${window}`);
  try {
    await ref.set(
      {
        count: FieldValue.increment(1),
        expiresAt: Timestamp.fromMillis((window + 2) * WINDOW_MS),
      },
      { merge: true },
    );
    const count = Number((await ref.get()).get("count")) || 0;
    if (count <= AI_LIMITS[scope]) return null;

    const retryAfter = Math.ceil(((window + 1) * WINDOW_MS - now) / 1000);
    return NextResponse.json(
      {
        error: `Muitos pedidos à IA em pouco tempo. Tente de novo em ${retryAfter} s.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  } catch (err) {
    logger.error("AI rate limit unavailable", { err, scope });
    return NextResponse.json(
      {
        error:
          "Não foi possível conferir o limite de uso da IA. Tente de novo.",
      },
      { status: 503 },
    );
  }
}
