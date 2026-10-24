/**
 * Verificação das regras do dashboard (envelope e simulação de caixa).
 *   npm run check:dashboard
 * Falha com exceção na primeira regra quebrada.
 */
import assert from "node:assert/strict";
import {
  annotateWithSimulations,
  envelopePace,
  envelopeRank,
  coveringCounterparts,
  envelopeStatus,
  groupByCounterpart,
  negativeRuns,
  bankHolidays,
  isBusinessDay,
  nextBusinessDay,
  niceTicks,
} from "../src/lib/dashboardRules";

const today = new Date(2026, 9, 23); // 23/10/2026

// Ritmo: exercício corrente proporcional, passado cheio, futuro sem ritmo.
assert.equal(Math.round(envelopePace(2026, today)!), 81);
assert.equal(envelopePace(2025, today), 100);
assert.equal(envelopePace(2027, today), null);

// Pai que distribuiu tudo não é alarme; pai que distribuiu além do envelope é.
assert.equal(envelopeStatus(1000, 1000, 0, false, 81).status, "success");
assert.equal(envelopeStatus(1000, 1200, 0, false, 81).status, "danger");

// Folha: acima do envelope é vermelho, mesmo com pouco pago.
assert.deepEqual(envelopeStatus(1000, 1400, 100, true, 81), {
  percentage: 140,
  paidPercentage: 10,
  status: "danger",
  exhausted: false,
  tight: false,
});
// Tudo comprometido já pago: projeto concluído, sem alerta.
const done = envelopeStatus(1000, 1000, 1000, true, 81);
assert.equal(done.status, "success");
assert.equal(done.exhausted, true);
assert.equal(done.tight, false);
// Empenhado no início do ano é planejamento: o ritmo olha o pago...
assert.equal(envelopeStatus(1000, 900, 600, true, 81).status, "success");
// ...mas a 95% com contas por pagar e ano pela frente, não cabe mais nada.
const tight = envelopeStatus(1000, 1000, 600, true, 81);
assert.equal(tight.status, "warning");
assert.equal(tight.tight, true);
// Em exercício encerrado não há "próxima despesa": sem folga não alerta.
assert.equal(envelopeStatus(1000, 1000, 600, true, 100).tight, false);
// Pago 10 pontos acima do tempo decorrido é amarelo.
assert.equal(envelopeStatus(1000, 940, 920, true, 81).status, "warning");
assert.equal(envelopeStatus(1000, 940, 900, true, 81).status, "success");
// Exercício futuro não tem ritmo: não há amarelo.
assert.equal(envelopeStatus(1000, 990, 990, true, null).status, "success");

// Sem envelope: gasto é estouro, sem gasto é "sem envelope".
assert.equal(envelopeStatus(0, 50, 0, true, 81).status, "danger");
assert.equal(envelopeStatus(0, 0, 0, true, 81).status, "no-budget");

// Ordem: estouro, ritmo, folhas, pais, sem envelope.
assert.ok(
  envelopeRank({ status: "danger", isLeaf: false }) <
    envelopeRank({ status: "warning", isLeaf: true }),
);
assert.ok(
  envelopeRank({ status: "success", isLeaf: true }) <
    envelopeRank({ status: "success", isLeaf: false }),
);

// Simulação diária: entra no dia e se acumula; antes dele, nada muda.
const days = [
  { isoDate: "2026-10-23", balance: 100 },
  { isoDate: "2026-10-24", balance: 100 },
  { isoDate: "2026-10-25", balance: 100 },
];
const sim = annotateWithSimulations(days, [
  { id: "a", amount: 30.1, type: "payable", date: "2026-10-24" },
  { id: "b", amount: 0.2, type: "receivable", date: "2026-10-24" },
]);
assert.deepEqual(
  sim.map((p) => p.simulatedBalance),
  [100, 70.1, 70.1],
);

// Simulação semanal: data no meio da semana cai no balde daquela semana.
const weeks = [
  { isoDate: "2026-01-01", balance: 0 },
  { isoDate: "2026-01-08", balance: 0 },
  { isoDate: "2026-01-15", balance: 0 },
];
const weekly = annotateWithSimulations(weeks, [
  { id: "c", amount: 50, type: "receivable", date: "2026-01-10" },
]);
assert.deepEqual(
  weekly.map((p) => p.simulatedBalance),
  [0, 50, 50],
);

// Fila: parcelas do mesmo doador viram um grupo, com total, a mais antiga e
// quanto passa de 90 dias.
const groups = groupByCounterpart(
  [
    {
      entityId: "vj",
      supplierOrClient: "VJ Farma",
      amount: 0.1,
      dueDate: new Date(2026, 4, 1),
    },
    {
      entityId: "vj",
      supplierOrClient: "VJ Farma",
      amount: 0.2,
      dueDate: new Date(2026, 3, 1),
    },
    {
      supplierOrClient: " Outro ",
      amount: 0.25,
      dueDate: new Date(2026, 9, 1),
    },
    { supplierOrClient: "outro", amount: 0.05, dueDate: new Date(2026, 9, 10) },
  ],
  today,
);
assert.deepEqual(
  groups.map((g) => [g.name, g.count, g.total, g.over90]),
  [
    ["VJ Farma", 2, 0.3, 0.3],
    ["Outro", 2, 0.3, 0],
  ],
);
assert.equal(groups[0].oldest.getMonth(), 3);

// Quem cobre o buraco: os atrasos mais recentes primeiro.
const owed = [
  { name: "antigo", oldest: new Date(2026, 3, 1), total: 400 },
  { name: "recente", oldest: new Date(2026, 9, 12), total: 500 },
];
assert.deepEqual(
  coveringCounterparts(owed, 90)?.map((g) => g.name),
  ["recente"],
);
assert.deepEqual(
  coveringCounterparts(owed, 800)?.map((g) => g.name),
  ["recente", "antigo"],
);
assert.equal(coveringCounterparts(owed, 1000), null);

// Trechos negativos: dois episódios separados por uma entrada grande.
const series = [10, -5, -8, 900, -50, -87, -40].map((balance, i) => ({
  i,
  balance,
}));
const runs = negativeRuns(series);
assert.deepEqual(
  runs.map((r) => [r.start.i, r.end.i, r.lowest.i, r.open]),
  [
    [1, 2, 2, false],
    [4, 6, 5, true],
  ],
);
assert.equal(negativeRuns([{ balance: 1 }]).length, 0);

// Dias úteis: fim de semana e feriado bancário compensam no próximo dia útil.
const ymd = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
assert.equal(ymd(nextBusinessDay(new Date(2026, 9, 24))), "26/10"); // sábado
assert.equal(ymd(nextBusinessDay(new Date(2026, 9, 23))), "23/10"); // sexta
assert.equal(ymd(nextBusinessDay(new Date(2026, 10, 2))), "3/11"); // Finados
assert.equal(ymd(nextBusinessDay(new Date(2026, 10, 20))), "23/11"); // Consciência Negra (sexta)
// Móveis de 2026: Páscoa 05/04 → Carnaval 16-17/02, Sexta Santa 03/04, Corpus Christi 04/06.
const h2026 = bankHolidays(2026);
for (const d of ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04"]) {
  assert.ok(h2026.has(d), d);
}
assert.equal(isBusinessDay(new Date(2026, 1, 18)), true); // quarta de cinzas

// Eixo: marcas redondas, com o zero.
assert.deepEqual(
  niceTicks(-87_724, 1_100_000),
  [-250_000, 0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000],
);
assert.deepEqual(niceTicks(0, 0), [0, 1]);
assert.ok(niceTicks(10, 95).includes(0));

console.log("dashboard: ok");
