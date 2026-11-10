/**
 * POST /api/internal/analytics/ai
 *   { companyId, from, to, compare, regime, cash, envelopes, kind, question? }
 *
 * Textos da Análise redigidos pela IA, sempre a partir do relatório montado
 * aqui no servidor (o mesmo da tela):
 *   kind "summary"   → resumo executivo que abre o PDF;
 *   kind "attention" → destaques de "O que pede atenção" redigidos;
 *   kind "question"  → resposta a uma pergunta, só com o relatório.
 *
 * Toda frase da IA passa por `verifyAiText`: número, data, mês ou nome que não
 * está nos fatos derruba a frase. Destaque reprovado volta ao texto de modelo;
 * resumo com menos de duas frases aprovadas volta ao resumo por regra.
 *
 * O caixa de hoje e os envelopes vêm da tela (são lidos pelo SDK do cliente);
 * o resto sai do relatório do servidor.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "@/lib/gemini";
import { logger } from "@/lib/logger";
import { limitAi } from "@/lib/api/aiRateLimit";
import {
  authorizeAnalytics,
  getAnalyticsReport,
  parseReportParams,
} from "@/lib/analyticsServer";
import {
  aiPrompt,
  analysisBrief,
  factsText,
  ruleSummary,
  verifyAiText,
  verifyAttention,
  type EnvelopeLeaf,
} from "@/lib/analytics";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = GEMINI_MODEL;
const MAX_QUESTION = 300;

async function generate(prompt: string, json = false) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return response.text ?? "";
}

const STATUSES = ["success", "warning", "danger", "no-budget"];
function readEnvelopes(v: unknown): EnvelopeLeaf[] | null {
  if (!Array.isArray(v)) return null;
  return v.slice(0, 500).flatMap((e) =>
    e &&
    typeof e.name === "string" &&
    STATUSES.includes(e.status) &&
    typeof e.isLeaf === "boolean"
      ? [
          {
            name: e.name.slice(0, 120),
            status: e.status,
            isLeaf: e.isLeaf,
            tight: e.tight === true,
          },
        ]
      : [],
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  const access = await authorizeAnalytics(companyId);
  if (!access.ok) return access.response;

  const params = parseReportParams(body ?? {});
  const kind = body?.kind;
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";
  const cash =
    typeof body?.cash === "number" && Number.isFinite(body.cash)
      ? body.cash
      : null;
  if (
    !params ||
    !["summary", "attention", "question"].includes(kind) ||
    (kind === "question" && (!question || question.length > MAX_QUESTION))
  ) {
    return NextResponse.json(
      {
        error:
          kind === "question"
            ? `Escreva a pergunta em até ${MAX_QUESTION} caracteres.`
            : "Pedido inválido.",
      },
      { status: 400 },
    );
  }
  const limited = await limitAi("analytics", access.uid);
  if (limited) return limited;

  let brief: ReturnType<typeof analysisBrief>;
  let facts: string;
  try {
    const { report, companyName } = await getAnalyticsReport(companyId, params);
    brief = analysisBrief(report, {
      cash,
      envelopes: readEnvelopes(body.envelopes),
    });
    facts = factsText(report, brief, companyName);
  } catch (err) {
    logger.error("Analytics AI: report failed", { err, companyId });
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }

  if (kind === "attention") {
    if (!brief.attention.length) return NextResponse.json({ items: [] });
    try {
      const text = await generate(aiPrompt.attention(brief.attention), true);
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed.filter(
            (x) => typeof x?.id === "string" && typeof x?.text === "string",
          )
        : [];
      return NextResponse.json({
        items: verifyAttention(brief.attention, list),
      });
    } catch (err) {
      logger.error("Analytics AI: attention failed", { err, companyId });
      return NextResponse.json({
        items: brief.attention.map((i) => ({ ...i, ai: false })),
      });
    }
  }

  if (kind === "summary") {
    const fallback = {
      sentences: ruleSummary(brief),
      source: "rules" as const,
      dropped: 0,
    };
    try {
      const text = await generate(aiPrompt.summary(facts));
      const { kept, dropped } = verifyAiText(text, facts);
      if (kept.length < 2) return NextResponse.json(fallback);
      return NextResponse.json({
        sentences: kept,
        source: "ai",
        dropped: dropped.length,
      });
    } catch (err) {
      logger.error("Analytics AI: summary failed", { err, companyId });
      return NextResponse.json(fallback);
    }
  }

  try {
    const text = await generate(aiPrompt.question(facts, question));
    const { kept, dropped } = verifyAiText(text, facts);
    return NextResponse.json({ sentences: kept, dropped });
  } catch (err) {
    logger.error("Analytics AI: question failed", { err, companyId });
    return NextResponse.json(
      { error: "A IA não respondeu. Tente de novo." },
      { status: 502 },
    );
  }
}
