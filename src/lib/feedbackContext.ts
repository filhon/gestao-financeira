import { browserLabel } from "@/lib/feedback";
import type { FeedbackContext } from "@/lib/types";

/**
 * Últimos erros da sessão, só a mensagem. De propósito não grava console, rede
 * nem tela: nessas telas há dados bancários e fiscais.
 */
const KEEP = 5;
const MAX_AGE_MS = 10 * 60_000;
let errors: { message: string; at: number }[] = [];
let installed = false;

export function recordError(message: string) {
  const clean = message.trim().slice(0, 300);
  if (!clean) return;
  errors = [
    ...errors.filter((e) => e.message !== clean),
    {
      message: clean,
      at: Date.now(),
    },
  ].slice(-KEEP);
}

export function installErrorCapture() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => recordError(e.message ?? ""));
  window.addEventListener("unhandledrejection", (e) =>
    recordError(
      e.reason instanceof Error ? e.reason.message : String(e.reason ?? ""),
    ),
  );
}

export function currentContext(screen: string): FeedbackContext {
  const cutoff = Date.now() - MAX_AGE_MS;
  return {
    screen: screen.slice(0, 100),
    url: `${location.pathname}${location.search}`.slice(0, 500),
    browser: browserLabel(navigator.userAgent).slice(0, 100),
    viewport: `${innerWidth}x${innerHeight}`,
    errors: errors
      .filter((e) => e.at >= cutoff)
      .map((e) => ({
        message: e.message,
        at: new Date(e.at).toISOString(),
      })),
  };
}
