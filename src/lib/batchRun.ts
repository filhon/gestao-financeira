/**
 * Motor das ações em lote: um item que falha não derruba os outros, o que já
 * gravou fica gravado e a nova tentativa refaz só a linha que falhou.
 */

export interface BatchFailure {
  id: string;
  label: string;
  message: string;
}

export interface BatchSnapshot {
  total: number;
  done: number;
  /** O item em andamento, ou a etapa final. */
  current: string | null;
  status: "running" | "offline" | "stopped";
  failures: BatchFailure[];
}

export interface BatchRound<T> {
  /** Tudo que deu certo até agora, inclusive em rodadas anteriores. */
  done: T[];
  failed: T[];
  /** Fila vazia, sem falha, e a etapa final (se houver) concluída. */
  complete: boolean;
}

export interface BatchConfig<T> {
  items: T[];
  id: (item: T) => string;
  label: (item: T) => string;
  /**
   * Grava uma fatia inteira ou nada. Se a fatia falhar, os itens são refeitos
   * um a um para achar qual causou o erro.
   */
  work: (chunk: T[]) => Promise<void>;
  chunkSize?: number;
  /** Só roda com todos os itens gravados; se falhar, vira uma falha a refazer. */
  finish?: { label: string; run: () => Promise<void> };
  describeError: (error: unknown) => string;
  onChange: (snapshot: BatchSnapshot) => void;
  /** Ao fim de cada rodada, inclusive das novas tentativas. */
  onRound?: (round: BatchRound<T>) => void;
}

export interface BatchEnv {
  isOnline: () => boolean;
  waitOnline: () => Promise<void>;
}

const browserEnv: BatchEnv = {
  isOnline: () => navigator.onLine,
  waitOnline: () =>
    new Promise((resolve) =>
      window.addEventListener("online", () => resolve(), { once: true }),
    ),
};

const FINISH_ID = "__finish";

export function createBatchRun<T>(
  config: BatchConfig<T>,
  env: BatchEnv = browserEnv,
) {
  const queue = [...config.items];
  const done: T[] = [];
  let failures: { item?: T; failure: BatchFailure }[] = [];
  let current: string | null = null;
  let offline = false;
  let running = false;
  let finished = !config.finish;

  const emit = () =>
    config.onChange({
      total: config.items.length,
      done: done.length,
      current,
      status: !running ? "stopped" : offline ? "offline" : "running",
      failures: failures.map((f) => f.failure),
    });

  const fail = (item: T | undefined, id: string, label: string, e: unknown) => {
    failures.push({
      item,
      failure: { id, label, message: config.describeError(e) },
    });
    emit();
  };

  const attempt = async (chunk: T[]) => {
    current = config.label(chunk[0]);
    emit();
    try {
      await config.work(chunk);
      done.push(...chunk);
      emit();
    } catch (error) {
      if (chunk.length === 1) {
        console.error(error);
        fail(chunk[0], config.id(chunk[0]), config.label(chunk[0]), error);
        return;
      }
      for (const item of chunk) await attempt([item]);
    }
  };

  const round = (): BatchRound<T> => ({
    done: [...done],
    failed: failures.flatMap((f) => (f.item === undefined ? [] : [f.item])),
    complete: queue.length === 0 && failures.length === 0 && finished,
  });

  const drain = async () => {
    if (running) return;
    running = true;
    emit();
    do {
      while (queue.length > 0) {
        if (!env.isOnline()) {
          offline = true;
          emit();
          await env.waitOnline();
          offline = false;
          emit();
        }
        await attempt(queue.splice(0, config.chunkSize ?? 1));
      }
      if (config.finish && !finished && failures.length === 0) {
        current = config.finish.label;
        emit();
        try {
          await config.finish.run();
          finished = true;
        } catch (error) {
          console.error(error);
          fail(undefined, FINISH_ID, config.finish.label, error);
        }
      }
      // Uma nova tentativa pode entrar na fila enquanto a última rodava.
    } while (queue.length > 0);
    running = false;
    current = null;
    emit();
    config.onRound?.(round());
  };

  return {
    start: drain,
    /** Refaz uma linha; sem id, todas as que falharam. */
    retry: (id?: string) => {
      const again = failures.filter((f) => !id || f.failure.id === id);
      failures = failures.filter((f) => !again.includes(f));
      queue.unshift(
        ...again.flatMap((f) => (f.item === undefined ? [] : [f.item])),
      );
      emit();
      return drain();
    },
    round,
  };
}
