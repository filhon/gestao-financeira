/**
 * POST /api/internal/search/interpret  { input, companyId } → { query }
 *
 * Traduz uma frase ("reembolsos do Filipe sem comprovante em julho acima de
 * 100") para a linguagem de busca de src/lib/search/query.ts. A resposta da IA
 * passa pelo mesmo parser: o que não for token válido é descartado, e o
 * usuário vê o resultado como chips editáveis antes de confiar nele.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { format } from "date-fns";
import { authorizeCompany } from "@/lib/api/companyAccess";
import { logger } from "@/lib/logger";
import { sanitizeQuery } from "@/lib/search/query";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const PROMPT = (
  input: string,
  today: string,
) => `Converta a busca de um sistema financeiro brasileiro para a linguagem de filtros abaixo. Hoje é ${today}.

Linguagem (tokens separados por espaço):
- palavra livre: casa com descrição, fornecedor/cliente, origem, centro de custo, documento. Use "aspas" para nomes com espaço.
- tipo:pagar | tipo:receber
- status:atrasado | status:rascunho | status:aprovacao | status:aprovado | status:autorizacao | status:autorizado | status:pago | status:rejeitado
- valor:>500 | valor:<1000 | valor:100-500 | valor:1234,56
- venc:2026 | venc:2026-07 | venc:2026-07-01..2026-07-31   (data de vencimento)
- pago:2026-07 | pago:2026-07-01..2026-07-31                 (data de pagamento)
- sem:comprovante   (pagas sem comprovante anexado)
- -palavra          (exclui)

Regras:
- Responda só com os tokens, numa linha, sem explicação nem markdown.
- Datas relativas ("mês passado", "esta semana", "julho") viram intervalos explícitos a partir de hoje. Mês sem ano = ano corrente.
- "despesa", "conta a pagar", "pagamento" → tipo:pagar. "receita", "recebimento" → tipo:receber.
- Palavras de ligação (do, da, de, em, com, acima, contas, transações) não viram termos.
- Nomes de pessoa ou empresa viram termo livre, entre aspas se tiverem espaço.

Busca: ${JSON.stringify(input)}`;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";

  const access = await authorizeCompany(companyId);
  if (!access.ok) return access.response;

  if (!input || input.length > 300) {
    return NextResponse.json(
      { error: "Escreva a busca em até 300 caracteres." },
      { status: 400 },
    );
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: PROMPT(input, format(new Date(), "yyyy-MM-dd")) }],
        },
      ],
    });
    const line = (response.text ?? "").replace(/`/g, "").split("\n")[0];
    const query = sanitizeQuery(line);
    if (!query) {
      return NextResponse.json(
        { error: "Não consegui transformar a frase em filtros." },
        { status: 422 },
      );
    }
    return NextResponse.json({ query });
  } catch (error) {
    logger.error("POST /api/internal/search/interpret failed", { error });
    return NextResponse.json(
      { error: "Falha ao interpretar a frase." },
      { status: 502 },
    );
  }
}
