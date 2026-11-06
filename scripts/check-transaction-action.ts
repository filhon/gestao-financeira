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
  approvalRecipients,
  pendingLabel,
  TX_ACTION_OPTIONS,
  TX_ACTION_PENDING,
  type TransactionActionInput,
} from "../src/lib/transactionAction";
import type {
  CostCenterAllocation,
  Transaction,
  UserProfile,
  UserRole,
} from "../src/lib/types";

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

  await checkApprovalRecipients();
  console.log("ok: link de aprovação não sai da empresa");
}

async function checkApprovalRecipients() {
  const usuario = (
    email: string,
    companyRoles: Record<string, UserRole>,
    extra: { status?: UserProfile["status"]; active?: boolean; role?: UserRole } = {},
  ) => ({ email, companyRoles, status: "active" as const, active: true, ...extra });

  const usuarios = [
    // A causa da falha: admin global de outra empresa vinha primeiro na busca.
    usuario("outra@x.com", { B: "admin" }, { role: "admin" }),
    usuario("aprovador@a.com", { A: "approver" }),
    usuario("gestor@a.com", { A: "financial_manager" }),
    usuario("Dono@a.com", { A: "admin" }),
    usuario("comum@a.com", { A: "user" }),
    usuario("auditor@a.com", { A: "auditor" }),
    usuario("saiu@a.com", { A: "approver" }, { status: "rejected", active: false }),
  ];
  const centros: Record<string, { companyId: string; approverEmail?: string }> = {
    cc1: { companyId: "A", approverEmail: "centro@a.com" },
    cc2: { companyId: "A", approverEmail: "CENTRO@a.com" },
    semAprovador: { companyId: "A" },
    deOutra: { companyId: "B", approverEmail: "centro@b.com" },
  };
  let leuUsuarios = 0;
  const load = {
    costCenter: async (id: string) => centros[id] ?? null,
    users: async () => {
      leuUsuarios++;
      return usuarios;
    },
  };
  const para = (...ccs: string[]) =>
    approvalRecipients(
      {
        companyId: "A",
        costCenterAllocation: ccs.map(
          (costCenterId) => ({ costCenterId }) as CostCenterAllocation,
        ),
      },
      "pede@a.com",
      load,
    );

  // Aprovador do centro de custo vem primeiro, sem repetir e sem ler usuários.
  assert.deepEqual(await para("cc1", "cc2", "semAprovador"), ["CENTRO@a.com"]);
  assert.equal(leuUsuarios, 0);

  // Centro de outra empresa não conta; cai nos aprovadores só desta empresa.
  const daEmpresa = ["aprovador@a.com", "gestor@a.com", "Dono@a.com"];
  assert.deepEqual(await para("deOutra"), daEmpresa);
  assert.deepEqual(await para(), daEmpresa);

  // Quem pediu não recebe o próprio link: nem como aprovador do centro...
  assert.deepEqual(
    await approvalRecipients(
      { companyId: "A", costCenterAllocation: [{ costCenterId: "cc1" } as CostCenterAllocation] },
      " Centro@A.com ",
      load,
    ),
    daEmpresa,
  );
  // ...nem como aprovador da empresa, mesmo com o e-mail em outra caixa.
  assert.deepEqual(
    await approvalRecipients({ companyId: "A" }, "dono@a.com", load),
    ["aprovador@a.com", "gestor@a.com"],
  );

  // Empresa sem aprovador: ninguém recebe, e não um usuário de outra empresa.
  assert.deepEqual(
    await approvalRecipients({ companyId: "C" }, "pede@a.com", load),
    [],
  );
}

main();
