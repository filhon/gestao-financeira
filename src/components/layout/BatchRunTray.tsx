"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  dismissBatchRun,
  retryBatchRun,
  useBatchRunStore,
  type BatchRunView,
} from "@/lib/store/useBatchRunStore";
import { plural } from "@/lib/utils";

/** Leva à linha que falhou, quando ela está nesta tela. */
function locate(id: string) {
  const row = document.querySelector<HTMLElement>(
    `[data-row-id="${CSS.escape(id)}"]`,
  );
  row?.scrollIntoView({ block: "center", behavior: "smooth" });
  row?.focus({ preventScroll: true });
}

/** Ação rápida termina antes de aparecer: nada pisca na tela. */
const REVEAL = { animationDelay: "300ms", animationFillMode: "both" };

function RunCard({ run }: { run: BatchRunView }) {
  const running = run.status !== "stopped";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const seconds = Math.round((now - run.startedAt) / 1000);
  const failed = run.failures.length;

  return (
    <section
      aria-label={run.title}
      className="pointer-events-auto rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in duration-150"
      style={REVEAL}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 font-medium">
          {running ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          )}
          <span className="truncate">{run.title}</span>
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {run.done} de {run.total}
          {running && seconds >= 3 && ` · ${seconds} s`}
        </span>
      </div>

      <Progress
        value={run.total ? (run.done / run.total) * 100 : 0}
        className="mt-2 h-1.5"
        aria-label={`${run.title}: ${run.done} de ${run.total}`}
      />

      <p
        role="status"
        aria-live="polite"
        className="mt-1.5 truncate text-xs text-muted-foreground"
      >
        {run.status === "offline" ? (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <WifiOff className="h-3 w-3" />
            Sem internet. Continua quando a conexão voltar.
          </span>
        ) : running ? (
          run.current
        ) : (
          `${plural(failed, "item falhou", "itens falharam")}. O que já foi gravado continua gravado.`
        )}
      </p>

      {failed > 0 && (
        <>
          <ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-md border">
            {run.failures.map((f) => (
              <li key={f.id} className="flex items-start gap-2 p-2">
                <button
                  type="button"
                  onClick={() => locate(f.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  {/* Inteiro: o que distingue uma linha costuma estar no fim. */}
                  <span className="block wrap-break-word font-medium">
                    {f.label}
                  </span>
                  <span className="block text-xs text-destructive">
                    {f.message}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => retryBatchRun(run.key, f.id)}
                >
                  Tentar de novo
                </Button>
              </li>
            ))}
          </ul>
          {!running && (
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={run.dismissing}
                onClick={() => dismissBatchRun(run.key)}
              >
                {run.dismissing && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {run.dismissLabel ?? "Fechar"}
              </Button>
              {failed > 1 && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={run.dismissing}
                  onClick={() => retryBatchRun(run.key)}
                >
                  Tentar todos ({failed})
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Ações em lote em andamento. Fica de fora das telas para seguir na troca de
 * página.
 */
export function BatchRunTray() {
  const runs = useBatchRunStore((s) => s.runs);

  // Fechar a aba interrompe a fila no meio.
  const running = runs.some((r) => r.status !== "stopped");
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  if (runs.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-20 z-60 flex flex-col gap-2 md:bottom-4 md:left-auto md:w-96">
      {runs.map((run) => (
        <RunCard key={run.key} run={run} />
      ))}
    </div>
  );
}
