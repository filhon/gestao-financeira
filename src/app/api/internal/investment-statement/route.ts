/**
 * POST /api/internal/investment-statement  (multipart: file, companyId)
 *   → { grossBalance, netBalance, date }
 *
 * Lê o saldo de uma aplicação no extrato do banco (PDF ou print da tela) para
 * preencher a conferência do saldo bruto. Nada é gravado: o usuário vê os
 * números no formulário antes de salvar.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { logger } from "@/lib/logger";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

const PROMPT = `Este é um extrato ou tela de aplicação financeira de um banco brasileiro (CDB, LCI/LCA, fundo, aplicação automática).

Responda só com JSON, sem markdown:
{"grossBalance": 12345.67, "netBalance": 12300.00, "date": "2026-10-30"}

- grossBalance: saldo bruto (antes de IR e IOF) somando todas as aplicações do extrato. Se só houver um saldo sem indicação, use-o aqui.
- netBalance: saldo líquido (após IR/IOF), ou null se não aparecer.
- date: data a que o saldo se refere, AAAA-MM-DD; null se não aparecer.
- Números com ponto decimal, sem R$ nem separador de milhar.`;

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const companyId = form?.get("companyId");
  const access = await authorizeCompany(
    typeof companyId === "string" ? companyId : "",
  );
  if (!access.ok) return access.response;

  const file = form?.get("file");
  if (!(file instanceof File) || !TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Envie o extrato em PDF ou imagem (PNG, JPG)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Arquivo acima de 10 MB." },
      { status: 400 },
    );
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: file.type,
                data: Buffer.from(await file.arrayBuffer()).toString("base64"),
              },
            },
            { text: PROMPT },
          ],
        },
      ],
    });
    const text = (response.text ?? "")
      .trim()
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/, "");
    const data = JSON.parse(text);
    const grossBalance = num(data.grossBalance);
    if (grossBalance === null) {
      return NextResponse.json(
        { error: "Não encontrei o saldo bruto no arquivo." },
        { status: 422 },
      );
    }
    return NextResponse.json({
      grossBalance,
      netBalance: num(data.netBalance),
      date:
        typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
          ? data.date
          : null,
    });
  } catch (error) {
    logger.error("POST /api/internal/investment-statement failed", { error });
    return NextResponse.json(
      { error: "Não consegui ler o extrato." },
      { status: 502 },
    );
  }
}
