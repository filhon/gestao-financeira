/**
 * Verificação da trava das ações em segundo plano: a linha fica presa até a
 * lista ser relida, solta no erro e não fica pausada sem internet.
 *   npm run check:transaction-action
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  MutationObserver,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import {
  pendingLabel,
  TX_ACTION_OPTIONS,
  TX_ACTION_PENDING,
  type TransactionActionInput,
} from "../src/lib/transactionAction";
import type { Transaction } from "../src/lib/types";

const transaction = { id: "t1" } as Transaction;
const settle: TransactionActionInput = {
  kind: "settle",
  transaction,
  data: { paymentDate: new Date(), finalAmount: 1, discount: 0, interest: 0 },
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  assert.equal(pendingLabel(settle), "Confirmando…");
  assert.equal(
    pendingLabel({ kind: "status", transaction, status: "approved" }),
    "Aprovando…",
  );
  assert.equal(
    pendingLabel({ kind: "status", transaction, status: "paid" }),
    "Atualizando…",
  );

  const client = new QueryClient();
  const pendentes = () =>
    client.getMutationCache().findAll(TX_ACTION_PENDING).length;

  // A trava sobrevive à resposta do servidor até a lista ser relida.
  const relida = deferred();
  const ok = new MutationObserver<string, Error, TransactionActionInput>(client, {
    ...TX_ACTION_OPTIONS,
    mutationFn: async () => "ok",
    onSuccess: () => relida.promise,
  });
  const fim = ok.mutate(settle);
  await tick();
  assert.equal(pendentes(), 1);
  relida.resolve();
  await fim;
  assert.equal(pendentes(), 0);

  // Erro solta a linha.
  const falha = new MutationObserver<string, Error, TransactionActionInput>(client, {
    ...TX_ACTION_OPTIONS,
    mutationFn: async () => {
      throw new Error("recusada");
    },
  });
  await assert.rejects(falha.mutate(settle));
  assert.equal(pendentes(), 0);

  // Sem internet: falha na hora, não pausa.
  onlineManager.setOnline(false);
  const offline = new MutationObserver<string, Error, TransactionActionInput>(client, {
    ...TX_ACTION_OPTIONS,
    mutationFn: async () => {
      throw new Error("sem rede");
    },
  });
  await assert.rejects(offline.mutate(settle));
  assert.equal(offline.getCurrentResult().isPaused, false);
  assert.equal(pendentes(), 0);
  onlineManager.setOnline(true);

  client.clear();
  console.log("ok: trava das ações em segundo plano");
}

main();
