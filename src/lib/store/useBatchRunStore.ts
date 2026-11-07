import { create } from "zustand";
import { toast } from "sonner";
import {
  createBatchRun,
  type BatchConfig,
  type BatchRound,
  type BatchSnapshot,
} from "@/lib/batchRun";
import { connectionAwareError } from "@/lib/errors";

export interface BatchRunView extends BatchSnapshot {
  key: string;
  title: string;
  startedAt: number;
  /** Sem isto, fechar só tira o painel; o que gravou continua gravado. */
  dismissLabel?: string;
  dismissing: boolean;
}

interface BatchRunState {
  runs: BatchRunView[];
}

export const useBatchRunStore = create<BatchRunState>(() => ({ runs: [] }));

type Controller = {
  retry: (id?: string) => Promise<unknown>;
  dismiss: () => Promise<void>;
};
const controllers = new Map<string, Controller>();

const patchRun = (key: string, patch: Partial<BatchRunView>) =>
  useBatchRunStore.setState((s) => ({
    runs: s.runs.map((r) => (r.key === key ? { ...r, ...patch } : r)),
  }));

const removeRun = (key: string) => {
  controllers.delete(key);
  useBatchRunStore.setState((s) => ({
    runs: s.runs.filter((r) => r.key !== key),
  }));
};

export interface StartBatchRun<T>
  extends Omit<BatchConfig<T>, "describeError" | "onChange"> {
  /** Uma ação por chave: repetir com a primeira em curso não faz nada. */
  key: string;
  title: string;
  /** Mensagem quando o erro não foi escrito para o usuário. */
  fallback: string;
  /** Oferece um botão no lugar de "Fechar", com o que fazer ao desistir. */
  dismiss?: {
    label: (round: BatchRound<T>) => string | undefined;
    run: (round: BatchRound<T>) => Promise<void> | void;
  };
}

/**
 * Roda fora da tela que pediu: o painel e a fila seguem na troca de página,
 * como o envio de comprovantes. A promessa resolve ao fim da primeira rodada.
 */
export function startBatchRun<T>(config: StartBatchRun<T>) {
  const { key, title, fallback, dismiss, onRound, ...batch } = config;
  if (controllers.has(key)) {
    toast.info("Esta ação já está em andamento.");
    return Promise.resolve(null);
  }

  const run = createBatchRun<T>({
    ...batch,
    describeError: (error) => connectionAwareError(error, fallback),
    onChange: (snapshot) =>
      patchRun(key, {
        ...snapshot,
        dismissLabel: dismiss?.label(run.round()),
      }),
    onRound: (round) => {
      // Tudo gravado: o painel some e o aviso fica por conta de quem chamou.
      if (round.complete) removeRun(key);
      onRound?.(round);
    },
  });

  controllers.set(key, {
    retry: run.retry,
    dismiss: async () => {
      patchRun(key, { dismissing: true });
      try {
        await dismiss?.run(run.round());
        removeRun(key);
      } catch (error) {
        console.error(error);
        patchRun(key, { dismissing: false });
        toast.error(connectionAwareError(error, "Não foi possível desistir."));
      }
    },
  });
  useBatchRunStore.setState((s) => ({
    runs: [
      ...s.runs,
      {
        key,
        title,
        startedAt: Date.now(),
        dismissing: false,
        total: batch.items.length,
        done: 0,
        current: null,
        status: "running",
        failures: [],
      },
    ],
  }));
  return run.start().then(() => run.round());
}

export const retryBatchRun = (key: string, id?: string) =>
  controllers.get(key)?.retry(id);

export const dismissBatchRun = (key: string) => controllers.get(key)?.dismiss();
