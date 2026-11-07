import assert from "node:assert/strict";
import { createBatchRun, type BatchSnapshot } from "../src/lib/batchRun";

const online = { isOnline: () => true, waitOnline: async () => {} };

function setup(
  items: string[],
  bad: Set<string>,
  extra: {
    chunkSize?: number;
    finish?: { label: string; run: () => Promise<void> };
    env?: typeof online;
  } = {},
) {
  const calls: string[][] = [];
  const written: string[] = [];
  const rounds: { done: string[]; failed: string[]; complete: boolean }[] = [];
  let last: BatchSnapshot | undefined;
  const run = createBatchRun<string>(
    {
      items,
      id: (x) => x,
      label: (x) => `linha ${x}`,
      chunkSize: extra.chunkSize,
      finish: extra.finish,
      // Fatia é tudo ou nada, como o writeBatch e a função do razão.
      work: async (chunk) => {
        calls.push(chunk);
        if (chunk.some((x) => bad.has(x))) throw new Error("recusado");
        written.push(...chunk);
      },
      describeError: (e) => (e as Error).message,
      onChange: (s) => (last = s),
      onRound: (r) => rounds.push(r),
    },
    extra.env ?? online,
  );
  return { run, calls, written, rounds, snap: () => last! };
}

const quiet = console.error;
console.error = () => {};

async function main() {
  // A falha de um item não para os outros e identifica a linha.
  {
    const bad = new Set(["b"]);
    const t = setup(["a", "b", "c"], bad);
    await t.run.start();
    assert.deepEqual(t.written, ["a", "c"]);
    assert.equal(t.snap().done, 2);
    assert.equal(t.snap().total, 3);
    assert.equal(t.snap().status, "stopped");
    assert.deepEqual(t.snap().failures, [
      { id: "b", label: "linha b", message: "recusado" },
    ]);
    assert.equal(t.rounds[0].complete, false);

    // A nova tentativa refaz só a linha que falhou.
    bad.clear();
    t.calls.length = 0;
    await t.run.retry("b");
    assert.deepEqual(t.calls, [["b"]]);
    assert.deepEqual(t.written, ["a", "c", "b"]);
    assert.equal(t.snap().failures.length, 0);
    assert.equal(t.snap().done, 3);
    assert.equal(t.rounds[1].complete, true);
    assert.deepEqual(t.rounds[1].done, ["a", "c", "b"]);
  }

  // Refazer uma linha não mexe nas outras falhas.
  {
    const bad = new Set(["a", "b"]);
    const t = setup(["a", "b"], bad);
    await t.run.start();
    bad.delete("a");
    await t.run.retry("a");
    assert.deepEqual(
      t.snap().failures.map((f) => f.id),
      ["b"],
    );
    bad.clear();
    await t.run.retry();
    assert.equal(t.snap().failures.length, 0);
    assert.equal(t.written.length, 2);
  }

  // Fatia recusada é refeita item a item, sem gravar nada duas vezes.
  {
    const bad = new Set(["c"]);
    const t = setup(["a", "b", "c", "d", "e"], bad, { chunkSize: 2 });
    await t.run.start();
    assert.deepEqual(t.calls, [
      ["a", "b"],
      ["c", "d"],
      ["c"],
      ["d"],
      ["e"],
    ]);
    assert.deepEqual(t.written, ["a", "b", "d", "e"]);
    assert.deepEqual(
      t.snap().failures.map((f) => f.id),
      ["c"],
    );
    assert.equal(new Set(t.written).size, t.written.length);
  }

  // A etapa final só roda com tudo gravado e pode ser refeita sozinha.
  {
    const bad = new Set(["a"]);
    let finishes = 0;
    let finishFails = true;
    const t = setup(["a", "b"], bad, {
      finish: {
        label: "Concluir",
        run: async () => {
          finishes++;
          if (finishFails) throw new Error("sem rede");
        },
      },
    });
    await t.run.start();
    assert.equal(finishes, 0);
    assert.equal(t.rounds[0].complete, false);

    bad.clear();
    t.calls.length = 0;
    await t.run.retry("a");
    assert.equal(finishes, 1);
    assert.deepEqual(
      t.snap().failures.map((f) => f.label),
      ["Concluir"],
    );
    assert.deepEqual(t.calls, [["a"]]);

    // Refazer a etapa final não regrava os itens.
    finishFails = false;
    t.calls.length = 0;
    await t.run.retry(t.snap().failures[0].id);
    assert.equal(finishes, 2);
    assert.deepEqual(t.calls, []);
    assert.equal(t.snap().failures.length, 0);
    assert.equal(t.rounds.at(-1)!.complete, true);
  }

  // Sem internet a fila espera, sem queimar os itens como falha.
  {
    let isOnline = false;
    let release = () => {};
    const seen: string[] = [];
    const t = setup(["a"], new Set(), {
      env: {
        isOnline: () => isOnline,
        waitOnline: () =>
          new Promise<void>((resolve) => {
            release = () => {
              isOnline = true;
              resolve();
            };
          }),
      },
    });
    const finished = t.run.start();
    await Promise.resolve();
    seen.push(t.snap().status);
    assert.deepEqual(t.written, []);
    release();
    await finished;
    assert.deepEqual(seen, ["offline"]);
    assert.deepEqual(t.written, ["a"]);
    assert.equal(t.snap().failures.length, 0);
  }

  // Item pedido de novo enquanto a fila roda entra nela, sem rodar em paralelo.
  {
    const bad = new Set(["a"]);
    let active = 0;
    let peak = 0;
    const written: string[] = [];
    const run = createBatchRun<string>(
      {
        items: ["a", "b"],
        id: (x) => x,
        label: (x) => x,
        work: async ([x]) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
          if (bad.has(x)) {
            bad.delete(x);
            throw new Error("uma vez");
          }
          written.push(x);
          if (x === "b") void run.retry("a");
        },
        describeError: () => "erro",
        onChange: () => {},
      },
      online,
    );
    await run.start();
    assert.equal(peak, 1);
    assert.deepEqual(written.sort(), ["a", "b"]);
  }

  console.error = quiet;
  console.log("check:batch-run ok");
}

main().catch((e) => {
  console.error = quiet;
  console.error(e);
  process.exit(1);
});
