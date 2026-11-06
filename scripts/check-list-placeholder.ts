/**
 * Verificação da lista mantida na tela durante a troca de aba: não pode vazar
 * dados de outra empresa nem parecer dado real da aba nova.
 *   npm run check:list-placeholder
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  InfiniteQueryObserver,
  QueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { placeholderWithin } from "../src/hooks/usePaginatedQuery";

type Page = { items: string[] };
type Key = readonly string[];

const client = new QueryClient();
const seed = (key: Key, items: string[]) =>
  client.setQueryData<InfiniteData<Page>>(key, {
    pages: [{ items }],
    pageParams: [null],
  });

/** O fetch nunca termina: congela a tela no instante logo depois da troca. */
const options = (queryKey: Key, company: string) => ({
  queryKey,
  queryFn: () => new Promise<Page>(() => {}),
  initialPageParam: null,
  getNextPageParam: () => "proxima",
  placeholderData: placeholderWithin(company),
  staleTime: Infinity,
});

const A_VENCIDAS = ["tx-list", "payable", "empresa-a", "overdue"];
const A_SEMANA = ["tx-list", "payable", "empresa-a", "week"];
const B_VENCIDAS = ["tx-list", "payable", "empresa-b", "overdue"];

seed(A_VENCIDAS, ["a1"]);
const observer = new InfiniteQueryObserver(
  client,
  options(A_VENCIDAS, "empresa-a"),
);
const stop = observer.subscribe(() => {});
assert.equal(observer.getCurrentResult().isPlaceholderData, false);

// Mesma empresa, aba nova sem cache: mantém as linhas, marcadas como anteriores.
observer.setOptions(options(A_SEMANA, "empresa-a"));
let r = observer.getCurrentResult();
assert.deepEqual(r.data?.pages[0].items, ["a1"]);
assert.equal(r.isPlaceholderData, true);
assert.equal(r.isLoading, false);
// Sem cursor real: a lista anterior não pode disparar "carregar mais".
assert.equal(r.hasNextPage, false);

// Volta para uma aba em cache: dado real, sem placeholder.
observer.setOptions(options(A_VENCIDAS, "empresa-a"));
assert.equal(observer.getCurrentResult().isPlaceholderData, false);

// Outra empresa: nunca mostra as linhas da anterior.
observer.setOptions(options(B_VENCIDAS, "empresa-b"));
r = observer.getCurrentResult();
assert.equal(r.data, undefined);
assert.equal(r.isPlaceholderData, false);
assert.equal(r.isLoading, true);

// Sem companyId: nunca reaproveita.
assert.equal(
  placeholderWithin(undefined)("x", { queryKey: A_SEMANA }),
  undefined,
);

stop();
client.clear();

// Releitura: voltar à aba dentro do prazo não vai ao servidor; invalidar e
// entrar na tela vão. Mesmas opções que TransactionList usa por usePaginatedQuery.
async function checkRereads() {
  const qc = new QueryClient();
  let reads = 0;
  const tabOptions = (queryKey: Key) => ({
    queryKey,
    queryFn: async () => {
      reads++;
      return { items: [] };
    },
    initialPageParam: null,
    getNextPageParam: () => undefined,
    staleTime: 60_000,
    refetchOnMount: "always" as const,
  });
  const settled = () => new Promise((done) => setTimeout(done, 10));

  const tabs = new InfiniteQueryObserver(qc, tabOptions(A_VENCIDAS));
  const leave = tabs.subscribe(() => {});
  await settled();
  tabs.setOptions(tabOptions(A_SEMANA));
  await settled();
  assert.equal(reads, 2);

  tabs.setOptions(tabOptions(A_VENCIDAS));
  await settled();
  assert.equal(reads, 2, "voltar à aba não relê");

  await qc.invalidateQueries({ queryKey: A_SEMANA, refetchType: "none" });
  tabs.setOptions(tabOptions(A_SEMANA));
  await settled();
  assert.equal(reads, 3, "aba invalidada relê ao abrir");
  leave();

  const page = new InfiniteQueryObserver(qc, tabOptions(A_SEMANA));
  const leavePage = page.subscribe(() => {});
  await settled();
  assert.equal(reads, 4, "entrar na tela relê sempre");
  leavePage();
  qc.clear();
}

checkRereads().then(() => console.log("ok: lista mantida na troca de aba"));
