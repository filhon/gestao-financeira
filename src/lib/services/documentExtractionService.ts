import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ExtractedDocumentData {
  description: string | null;
  amount: number | null;
  dueDate: string | null;
  paymentMethod: "pix" | "boleto" | "transfer" | "credit_card" | "cash" | null;
  supplierName: string | null;
  supplierDocument: string | null;
  notes: string | null;
  barcode: string | null;
  confidence: number;
}

export interface ExtractedReceiptData {
  description: string | null;
  amount: number | null;
  date: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  accessKey: string | null;
  confidence: number;
}

/** Nota de despesa de funcionário: cupom, NFC-e, recibo, táxi, pedágio. */
export async function extractReceiptData(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ExtractedReceiptData> {
  const empty: ExtractedReceiptData = {
    description: null,
    amount: null,
    date: null,
    supplierName: null,
    supplierDocument: null,
    accessKey: null,
    confidence: 0,
  };
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { responseMimeType: "application/json" },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: fileBuffer.toString("base64") } },
            {
              text: `Este é o comprovante de uma despesa que um funcionário pagou do próprio bolso e quer reembolsar (cupom fiscal, NFC-e, NF-e, recibo, corrida de táxi/app, pedágio, estacionamento).

Devolva só este JSON:
{
  "description": "O que foi, curto, com o estabelecimento. Ex.: 'Almoço - Restaurante Sabor', 'Táxi aeroporto', 'Estacionamento Shopping X'",
  "amount": 58.9,
  "date": "2026-10-31",
  "supplierName": "Nome do estabelecimento",
  "supplierDocument": "CNPJ ou CPF do emitente, só dígitos",
  "accessKey": "Chave de acesso da NF-e/NFC-e, 44 dígitos sem espaços (fica perto do QR code, em grupos de 4)",
  "confidence": 85
}

Regras:
- "amount" é o valor TOTAL pago, número com ponto decimal, sem R$.
- "date" é a data de emissão/da despesa, ISO (AAAA-MM-DD).
- Campo que não aparece no documento: null. Não invente.
- "confidence" de 0 a 100: sua confiança no valor e na data.`,
            },
          ],
        },
      ],
    });
    const text = (response.text ?? "")
      .trim()
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/i, "");
    return { ...empty, ...(JSON.parse(text) as Partial<ExtractedReceiptData>) };
  } catch (error) {
    console.error("[extractReceiptData] leitura falhou:", error);
    return empty;
  }
}

export async function extractDocumentData(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ExtractedDocumentData> {
  const base64 = fileBuffer.toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
          {
            text: `Você é um assistente financeiro especializado em extrair dados de documentos fiscais brasileiros (boletos, notas fiscais, faturas, recibos).

Analise o documento anexo e extraia as seguintes informações em formato JSON:

{
  "description": "Descrição resumida do que se trata o documento (ex: 'Fatura de energia elétrica - Março/2026')",
  "amount": 1234.56,
  "dueDate": "2026-03-15",
  "paymentMethod": "boleto | pix | transfer | credit_card | cash",
  "supplierName": "Nome/Razão Social do emitente",
  "supplierDocument": "CNPJ ou CPF do emitente (apenas números)",
  "notes": "Informações adicionais relevantes (número NF, observações, etc.)",
  "barcode": "Linha digitável do boleto, se houver",
  "confidence": 85
}

Regras:
- Retorne APENAS o JSON, sem markdown ou texto adicional.
- Se um campo não puder ser identificado, use null.
- O campo "amount" deve ser numérico (sem R$, sem pontos de milhar, use ponto como separador decimal).
- O campo "dueDate" deve estar no formato ISO (YYYY-MM-DD).
- O campo "paymentMethod" deve ser um dos valores exatos: "boleto", "pix", "transfer", "credit_card" ou "cash". Infira pelo tipo de documento.
- O campo "confidence" é sua confiança geral de 0 a 100 na precisão da extração.
- O "supplierDocument" deve conter apenas dígitos (sem pontos, barras ou traços).`,
          },
        ],
      },
    ],
  });

  const text = response.text?.trim() ?? "";
  const cleanJson = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleanJson) as ExtractedDocumentData;
  } catch {
    return {
      description: null,
      amount: null,
      dueDate: null,
      paymentMethod: null,
      supplierName: null,
      supplierDocument: null,
      notes: null,
      barcode: null,
      confidence: 0,
    };
  }
}
