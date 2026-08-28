/**
 * Primitivas de texto do motor de matching de comprovantes.
 *
 * Tudo aqui é puro e sem dependências — o motor roda no servidor
 * (rota `/api/internal/comprovantes/process`) e pode rodar no cliente.
 */

const DIACRITICS = /[̀-ͯ]/g;

/**
 * Minúsculas sem acentos, preservando pontuação e quebras de linha.
 * Índices do texto resultante são estáveis entre si — toda a extração
 * baseada em posição trabalha sobre a versão "folded", nunca sobre a original.
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

/** `fold()` + colapsa qualquer sequência não alfanumérica em um único espaço. */
export function normalize(text: string): string {
  return fold(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function digitsOnly(text: string): string {
  return text.replace(/\D+/g, "");
}

// ── Vocabulário ───────────────────────────────────────────────────────────────

/** Sufixos societários — presentes em quase todo nome, não distinguem nada. */
const LEGAL_SUFFIXES = new Set([
  "ltda",
  "ltd",
  "me",
  "epp",
  "eireli",
  "eirele",
  "sa",
  "cia",
  "mei",
  "ss",
  "spe",
  "filial",
  "matriz",
  "inc",
  "corp",
]);

const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "por",
  "com",
  "a",
  "o",
  "as",
  "os",
  "no",
  "na",
  "nos",
  "nas",
  "ao",
  "aos",
  "um",
  "uma",
  "the",
  "of",
]);

/**
 * Termos que aparecem em uma fração enorme das razões sociais brasileiras.
 * O IDF já os despriorizaria numa base grande; esta lista garante o mesmo
 * comportamento quando há poucos candidatos (IDF quase uniforme).
 */
const GENERIC_BUSINESS_TERMS = new Set([
  "comercio",
  "comercial",
  "servico",
  "servicos",
  "industria",
  "industrial",
  "distribuidora",
  "distribuicao",
  "produto",
  "produtos",
  "empresa",
  "empreendimentos",
  "solucoes",
  "tecnologia",
  "transporte",
  "transportes",
  "material",
  "materiais",
  "construcao",
  "brasil",
  "brasileira",
  "brasileiro",
  "nacional",
  "grupo",
  "holding",
  "participacoes",
  "representacoes",
  "sistemas",
  "engenharia",
  "consultoria",
  "assessoria",
  "administradora",
  "gestao",
  "negocios",
  "importacao",
  "exportacao",
  "atacado",
  "varejo",
  "loja",
  "lojas",
  "centro",
  "geral",
  "sociedade",
  "associacao",
  "instituto",
  "alimentos",
  "agropecuaria",
  "pagamento",
  "pagto",
  "fornecedor",
  "cliente",
  "ref",
  "referente",
  "nota",
  "fiscal",
  "parcela",
  "mensalidade",
]);

/** Tokens informativos de um nome próprio/razão social. */
export function significantTokens(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter(
      (t) =>
        t.length >= 2 &&
        !STOPWORDS.has(t) &&
        !LEGAL_SUFFIXES.has(t) &&
        !/^\d+$/.test(t),
    );
}

/** Tokens de texto livre (descrição, observações) — mantém números curtos úteis (NF, parcela). */
export function contentTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter(
      (t) => t.length >= 3 && !STOPWORDS.has(t) && !LEGAL_SUFFIXES.has(t),
    );
}

/** Iniciais das palavras significativas: "Companhia Brasileira de Distribuição" → "cbd". */
export function initialsOf(name: string): string {
  const tokens = significantTokens(name);
  if (tokens.length < 2) return "";
  return tokens.map((t) => t[0]).join("");
}

// ── Similaridade ──────────────────────────────────────────────────────────────

/**
 * Jaro-Winkler. Robusto para erros de OCR e nomes truncados por extratos
 * bancários ("COMERCIAL SAO JOAO LT").
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions) / matches) /
    3;

  let prefix = 0;
  while (
    prefix < 4 &&
    prefix < a.length &&
    prefix < b.length &&
    a[prefix] === b[prefix]
  ) {
    prefix++;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Coeficiente de Dice sobre bigramas — bom para frases inteiras. */
export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const count = bigrams.get(g) ?? 0;
    if (count > 0) {
      bigrams.set(g, count - 1);
      intersection++;
    }
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

// ── IDF ───────────────────────────────────────────────────────────────────────

export interface TokenWeights {
  /** Peso informativo do token: raro no conjunto de candidatos ⇒ peso alto. */
  weight: (token: string) => number;
}

/**
 * Constrói pesos IDF a partir dos nomes/descrições do conjunto de candidatos.
 * Um token que aparece em quase todo fornecedor da empresa ("transportes")
 * praticamente não distingue nada; um token raro ("bortolotto") distingue muito.
 */
export function createTokenWeights(documents: string[][]): TokenWeights {
  const df = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const total = documents.length;
  const cache = new Map<string, number>();

  return {
    weight(token: string): number {
      const cached = cache.get(token);
      if (cached !== undefined) return cached;

      const frequency = df.get(token) ?? 0;
      const idf = Math.log((total + 1) / (frequency + 1)) + 0.35;
      const genericPenalty = GENERIC_BUSINESS_TERMS.has(token) ? 0.25 : 1;
      const shortPenalty = token.length <= 3 ? 0.5 : 1;
      const value = Math.max(0.05, idf * genericPenalty * shortPenalty);

      cache.set(token, value);
      return value;
    },
  };
}

// ── Índice de tokens do comprovante ───────────────────────────────────────────

export interface TokenIndex {
  set: Set<string>;
  /** Tokens agrupados pelos 2 primeiros caracteres — evita varrer tudo por needle. */
  buckets: Map<string, string[]>;
  size: number;
}

export function buildTokenIndex(tokens: string[]): TokenIndex {
  const set = new Set(tokens);
  const buckets = new Map<string, string[]>();
  for (const token of set) {
    const key = token.slice(0, 2);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(token);
    else buckets.set(key, [token]);
  }
  return { set, buckets, size: set.size };
}

/**
 * Quão bem um token aparece no comprovante: exato, prefixo (nome truncado)
 * ou fuzzy (erro de OCR). Retorna 0..1.
 */
export function tokenPresence(needle: string, index: TokenIndex): number {
  if (index.set.has(needle)) return 1;

  const bucket = index.buckets.get(needle.slice(0, 2));
  if (!bucket) return 0;

  let best = 0;
  for (const candidate of bucket) {
    if (needle.length >= 4 && candidate.startsWith(needle)) {
      best = Math.max(best, 0.85);
      continue;
    }
    if (candidate.length >= 4 && needle.startsWith(candidate)) {
      best = Math.max(best, 0.85);
      continue;
    }
    if (Math.abs(candidate.length - needle.length) <= 2 && needle.length >= 4) {
      const similarity = jaroWinkler(needle, candidate);
      if (similarity >= 0.92) best = Math.max(best, similarity * 0.8);
    }
    if (best >= 0.85) break;
  }
  return best;
}

/**
 * Cobertura ponderada por IDF: fração da "massa informativa" dos tokens
 * procurados que está efetivamente presente no comprovante.
 */
export function weightedCoverage(
  needles: string[],
  index: TokenIndex,
  weights: TokenWeights,
): { score: number; hits: string[] } {
  if (needles.length === 0) return { score: 0, hits: [] };

  let total = 0;
  let matched = 0;
  const hits: string[] = [];

  for (const needle of needles) {
    const weight = weights.weight(needle);
    total += weight;
    const presence = tokenPresence(needle, index);
    if (presence > 0) {
      matched += weight * presence;
      if (presence >= 0.8) hits.push(needle);
    }
  }

  return { score: total > 0 ? matched / total : 0, hits };
}
