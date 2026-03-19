import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

interface IntentResult {
  action: "CREATE_PAYABLE" | "CREATE_RECEIVABLE" | "MAPS_REPORT" | "UNKNOWN";
  params: {
    amount?: number;
    vendor?: string;
    date?: string;
    category?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input: string = body?.input;

    if (!input || typeof input !== "string") {
      return NextResponse.json(
        { error: "O campo 'input' é obrigatório e deve ser uma string." },
        { status: 400 },
      );
    }

    const prompt = `Você é um assistente financeiro brasileiro. Analise o comando do usuário e extraia a intenção e os parâmetros relevantes.

Comando do usuário: "${input}"

Retorne APENAS um JSON com a seguinte estrutura (sem markdown, sem texto adicional):
{
  "action": "CREATE_PAYABLE | CREATE_RECEIVABLE | MAPS_REPORT | UNKNOWN",
  "params": {
    "amount": 1234.56,
    "vendor": "Nome do fornecedor ou cliente",
    "date": "YYYY-MM-DD",
    "category": "categoria da transação"
  }
}

Regras de mapeamento:
- "CREATE_PAYABLE": quando o usuário quer pagar, lançar uma despesa, conta a pagar (ex: "pagar R$50 pro João", "conta de luz vence amanhã").
- "CREATE_RECEIVABLE": quando o usuário quer registrar uma receita, valor a receber (ex: "receber R$200 do cliente", "lançar cobrança").
- "MAPS_REPORT": quando o usuário quer ver relatórios, gráficos, resumos financeiros (ex: "ver relatório", "mostrar gráfico").
- "UNKNOWN": para qualquer outra intenção.

Regras para os parâmetros:
- "amount": valor numérico sem R$, sem pontos de milhar, com ponto decimal. Se não mencionado, omita o campo.
- "vendor": nome da pessoa, empresa ou fornecedor. Se não mencionado, omita o campo.
- "date": data no formato ISO YYYY-MM-DD. Interprete expressões como "amanhã", "hoje", "próxima semana" relativas à data atual. Se não mencionada, omita o campo.
- "category": categoria inferida (ex: "alimentação", "energia", "aluguel"). Se não identificada, omita o campo.
- Se um parâmetro não puder ser identificado, omita-o do objeto "params".`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });

    const text = response.text?.trim() ?? "";
    const cleanJson = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");

    let result: IntentResult;
    try {
      result = JSON.parse(cleanJson) as IntentResult;
    } catch {
      return NextResponse.json(
        { error: "Falha ao interpretar a resposta da IA." },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro no intent-parser:", message);
    return NextResponse.json(
      { error: `Erro ao processar o comando: ${message}` },
      { status: 500 },
    );
  }
}
