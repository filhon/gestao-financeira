import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import { auth } from "@/lib/firebase/client";

/**
 * Cache do React Query em IndexedDB: ao reabrir o app (F5, aba nova, manhã
 * seguinte) as telas aparecem na hora com o último dado e se atualizam em
 * seguida. IndexedDB e não localStorage porque o clone estruturado preserva
 * `Date` sem serializar e não tem o teto de ~5 MB.
 *
 * Uma entrada por usuário: quem entra no mesmo navegador nunca vê o cache de
 * outro. O logout apaga tudo (junto com o cache do Firestore).
 */

const DB_NAME = "fincontrol-query-cache";
const STORE = "clients";

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err); // DataCloneError sai síncrono do put()
      } finally {
        db.close(); // fecha depois da transação terminar
      }
    };
  });
}

/** Só objetos literais, arrays e Date: Timestamp, DocumentSnapshot e afins
 *  voltariam do clone sem os métodos e quebrariam a tela. */
function isPlain(v: unknown, depth = 0): boolean {
  if (depth > 30) return false;
  if (typeof v === "function" || typeof v === "symbol") return false;
  if (v === null || typeof v !== "object") return true;
  if (v instanceof Date) return true;
  if (Array.isArray(v)) return v.every((x) => isPlain(x, depth + 1));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v).every((x) => isPlain(x, depth + 1));
}

/** Lista paginada guarda só a 1ª página e sem cursor do Firestore (não
 *  sobrevive ao disco); o refetch logo após restaurar devolve o cursor. */
function trimInfinite(data: unknown): unknown {
  const d = data as { pages?: unknown[]; pageParams?: unknown[] } | null;
  if (!d || !Array.isArray(d.pages) || !Array.isArray(d.pageParams))
    return data;
  const [page] = d.pages;
  return {
    pages: [
      page && typeof page === "object" && "lastDoc" in page
        ? { ...page, lastDoc: null }
        : page,
    ],
    pageParams: d.pageParams.slice(0, 1),
  };
}

const keyFor = () => auth.currentUser?.uid;

let pending: PersistedClient | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const uid = keyFor();
  const client = pending;
  pending = null;
  if (!uid || !client) return;
  const queries = client.clientState.queries.flatMap((q) => {
    const data = trimInfinite(q.state.data);
    return isPlain(data) ? [{ ...q, state: { ...q.state, data } }] : [];
  });
  withStore("readwrite", (s) =>
    s.put({ ...client, clientState: { ...client.clientState, queries } }, uid),
  ).catch(() => {});
}

export const queryPersister: Persister = {
  // O React Query chama isto a cada mudança no cache; grava no máximo 1×/s.
  persistClient(client) {
    pending = client;
    timer ??= setTimeout(flush, 1000);
  },
  async restoreClient() {
    // A sessão do Firebase volta do disco em milissegundos; o teto evita que
    // uma falha aqui segure as telas (as queries esperam a restauração).
    const ready = await Promise.race([
      auth.authStateReady().then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 1500)),
    ]);
    const uid = ready && keyFor();
    if (!uid) return undefined;
    return withStore<PersistedClient | undefined>("readonly", (s) =>
      s.get(uid),
    ).catch(() => undefined);
  },
  async removeClient() {
    const uid = keyFor();
    if (uid) await withStore("readwrite", (s) => s.delete(uid)).catch(() => {});
  },
};

/** Logout: apaga o cache de todos os usuários deste navegador. */
export function clearPersistedQueries() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  return withStore("readwrite", (s) => s.clear()).catch(() => {});
}
