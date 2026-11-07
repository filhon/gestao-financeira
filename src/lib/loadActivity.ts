/**
 * Leituras de tela fora do React Query, para a barra de carga contá-las junto
 * com as consultas.
 */
let started = 0;
let active = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const loadActivity = {
  snapshot: () => ({ started, active }),
  /** A barra zera a contagem quando tudo parou. */
  reset: () => {
    started = 0;
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Devolve a mesma promessa, com o mesmo resultado ou erro. */
export function trackLoad<T>(load: Promise<T>): Promise<T> {
  started++;
  active++;
  notify();
  return load.finally(() => {
    active--;
    notify();
  });
}
