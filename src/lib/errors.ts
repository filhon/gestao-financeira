/**
 * Mensagens de erro vindas de Cloud Functions.
 *
 * As validações de orçamento escrevem mensagens prontas para o usuário
 * ("disponível X, necessário Y"), e engoli-las atrás de um toast genérico
 * transforma uma recusa acionável em frustração. Por outro lado, nem todo erro
 * pode ser exibido: `internal` e `unknown` carregam detalhe de implementação.
 */

/** Códigos cuja mensagem foi escrita para o usuário final ler. */
const USER_FACING_CODES = new Set([
  "functions/failed-precondition",
  "functions/invalid-argument",
  "functions/permission-denied",
  "functions/not-found",
  "functions/unauthenticated",
  "functions/resource-exhausted",
  // Link de aprovação expirado — a mensagem diz exatamente isso.
  "functions/deadline-exceeded",
]);

interface CallableError {
  code?: unknown;
  message?: unknown;
}

/**
 * Devolve a mensagem do servidor quando ela foi escrita para o usuário, e o
 * texto de fallback em qualquer outro caso.
 */
export function friendlyError(error: unknown, fallback: string): string {
  const err = error as CallableError | null;
  const code = typeof err?.code === "string" ? err.code : null;
  const message = typeof err?.message === "string" ? err.message.trim() : "";

  if (code && USER_FACING_CODES.has(code) && message) {
    return message;
  }
  return fallback;
}
