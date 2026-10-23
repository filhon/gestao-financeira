import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { format } from "date-fns";
import { db } from "@/lib/firebase/client";
import { auditService } from "@/lib/services/auditService";
import { ChartAccount } from "@/lib/types";
import { stripUndefined } from "@/lib/utils";
import {
  ACCOUNT_NATURE_LABEL,
  ACCOUNT_TYPE_LABEL,
  AccountDraft,
  compareCodes,
  DRE_GROUP_LABEL,
  DRE_GROUPS,
  normalizeCode,
  parentCodeOf,
  parseAccountNature,
  parseAccountType,
  parseDreGroup,
  PlanIssue,
  ResolvedAccount,
  resolvePlan,
} from "@/lib/chartOfAccounts";
import { CHART_MODELS, ChartModelKey } from "@/lib/chartOfAccountsModels";

const COLLECTION_NAME = "chart_of_accounts";

type Actor = { uid: string; email: string };

// As guardas abaixo vivem aqui, e não nas rules, pelo mesmo motivo das de
// centro de custo: exigem consultar outras coleções. O risco é gestor errando,
// não atacante — mexer no plano não move dinheiro.

const fromDoc = (id: string, data: Record<string, unknown>) =>
  ({
    id,
    ...data,
    createdAt: (data.createdAt as Timestamp)?.toDate(),
    updatedAt: (data.updatedAt as Timestamp)?.toDate(),
  }) as ChartAccount;

const toDraft = (a: ChartAccount): AccountDraft => ({
  code: a.code,
  name: a.name,
  type: a.type,
  nature: a.nature,
  dreGroup: a.dreGroup,
  description: a.description,
  archived: a.archived,
});

const firstIssue = (issues: PlanIssue[]) => {
  if (issues.length > 0) throw new Error(issues[0].message);
};

/** Campos gravados de uma conta resolvida; vazio vira remoção no update. */
const writable = (a: ResolvedAccount, forUpdate: boolean) => ({
  code: a.code,
  name: a.name,
  type: a.type,
  nature: a.nature,
  dreGroup: a.dreGroup ?? (forUpdate ? deleteField() : undefined),
  description: a.description?.trim()
    ? a.description.trim()
    : forUpdate
      ? deleteField()
      : undefined,
});

const sameAccount = (a: ChartAccount, b: ResolvedAccount) =>
  a.name === b.name &&
  a.type === b.type &&
  a.nature === b.nature &&
  (a.dreGroup ?? null) === (b.dreGroup ?? null) &&
  (a.description?.trim() || null) === (b.description?.trim() || null);

/**
 * O que ainda aponta para as contas: transação em qualquer status (a conta
 * aparece na DRE de qualquer período) e recorrência ativa (a próxima geração
 * nasceria nela).
 */
async function referencesTo(companyId: string, ids: string[]) {
  const [transactions, templates] = await Promise.all([
    Promise.all(
      // `in` aceita até 30 valores.
      Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) =>
        getDocs(
          query(
            collection(db, "transactions"),
            where("companyId", "==", companyId),
            where("accountId", "in", ids.slice(i * 30, i * 30 + 30)),
            limit(1),
          ),
        ),
      ),
    ),
    getDocs(
      query(
        collection(db, "recurring_templates"),
        where("companyId", "==", companyId),
        where("active", "==", true),
      ),
    ),
  ]);

  return {
    transactions: transactions.some((s) => !s.empty),
    recurrences: templates.docs
      .filter((d) => ids.includes(d.data().baseTransactionData?.accountId))
      .map((d) => (d.data().description as string) || d.id),
  };
}

/**
 * Mudanças que deixariam lançamentos existentes num lugar impossível: conta
 * analítica com lançamento que vira sintética (sintética não recebe
 * lançamento) ou que troca de natureza (despesa classificada como receita).
 */
async function assertSafeChanges(
  companyId: string,
  before: ChartAccount[],
  after: ResolvedAccount[],
) {
  const afterByCode = new Map(after.map((a) => [a.code, a]));
  const risky = before.filter((b) => {
    const a = afterByCode.get(b.code);
    return (
      a &&
      b.type === "analytic" &&
      (a.type !== "analytic" || a.nature !== b.nature)
    );
  });
  for (const account of risky) {
    const refs = await referencesTo(companyId, [account.id]);
    if (refs.transactions || refs.recurrences.length > 0) {
      throw new Error(
        `${account.code} · ${account.name} tem lançamentos ou recorrências e não pode ` +
          "virar sintética nem mudar de natureza. Crie uma conta nova e arquive esta.",
      );
    }
  }
}

async function companyAccounts(companyId: string) {
  const snapshot = await getDocs(
    query(collection(db, COLLECTION_NAME), where("companyId", "==", companyId)),
  );
  return snapshot.docs
    .map((d) => fromDoc(d.id, d.data()))
    .sort((a, b) => compareCodes(a.code, b.code));
}

/** Grava em blocos: um writeBatch aceita no máximo 500 operações. */
async function commitInChunks(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
}

export interface ImportPreview {
  issues: PlanIssue[];
  toCreate: ResolvedAccount[];
  toUpdate: Array<{ current: ChartAccount; next: ResolvedAccount }>;
  unchanged: number;
  /** Contas que já existem e não estão na planilha — ficam como estão. */
  kept: number;
}

// ─── Planilha ────────────────────────────────────────────────────────────────

const HEADERS = [
  "Código",
  "Nome",
  "Tipo",
  "Natureza",
  "Grupo DRE",
  "Descrição",
];

const headerKey = (h: unknown) =>
  String(h ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z/ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const HEADER_MAP: Record<string, keyof AccountDraft> = {
  codigo: "code",
  cod: "code",
  code: "code",
  conta: "code",
  "codigo da conta": "code",
  classificacao: "code",
  nome: "name",
  "nome da conta": "name",
  name: "name",
  titulo: "name",
  "descricao da conta": "name",
  tipo: "type",
  "tipo da conta": "type",
  tipoconta: "type",
  "s/a": "type",
  "sintetica/analitica": "type",
  natureza: "nature",
  "natureza da conta": "nature",
  "natureza saldo": "nature",
  "receita/despesa": "nature",
  "grupo dre": "dreGroup",
  "grupo da dre": "dreGroup",
  "linha da dre": "dreGroup",
  dre: "dreGroup",
  grupo: "dreGroup",
  descricao: "description",
  observacao: "description",
  observacoes: "description",
};

/**
 * CSV salvo pelo Excel no Windows costuma vir em Windows-1252, não UTF-8; lido
 * como UTF-8, "Analítica" vira "Anal�tica" e deixa de ser reconhecido.
 */
async function decodeText(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Linhas da planilha para um conjunto de contas: tudo explícito, nada herdado. */
const sheetRows = (accounts: ResolvedAccount[]) =>
  accounts.map((a) => [
    a.code,
    a.name,
    ACCOUNT_TYPE_LABEL[a.type],
    ACCOUNT_NATURE_LABEL[a.nature],
    a.dreGroup ? DRE_GROUP_LABEL[a.dreGroup] : "",
    a.description ?? "",
  ]);

const EXAMPLE_ROWS = [
  ["1", "Receitas", "Sintética", "Receita", "", ""],
  ["1.1", "Receitas operacionais", "Sintética", "Receita", "Receita bruta", ""],
  [
    "1.1.01",
    "Prestação de serviços",
    "Analítica",
    "Receita",
    "Receita bruta",
    "",
  ],
  ["2", "Despesas", "Sintética", "Despesa", "", ""],
  [
    "2.1",
    "Administrativas",
    "Sintética",
    "Despesa",
    "Despesas operacionais",
    "",
  ],
  [
    "2.1.01",
    "Energia elétrica",
    "Analítica",
    "Despesa",
    "Despesas operacionais",
    "",
  ],
];

const INSTRUCTIONS: Array<[string, string]> = [
  [
    "Código",
    "Obrigatório. Números separados por ponto; o código define a hierarquia: 3.1.02 fica dentro de 3.1, que fica dentro de 3. Mantenha a coluna formatada como Texto — se o Excel converter 1.10 em número, ele vira 1.1.",
  ],
  ["Nome", "Obrigatório. Até 120 caracteres."],
  [
    "Tipo",
    "Sintética (agrupa e totaliza, não recebe lançamento) ou Analítica (recebe lançamento). Em branco: sintética se tiver subcontas na planilha, analítica se não tiver.",
  ],
  [
    "Natureza",
    "Receita (entrada) ou Despesa (saída). Obrigatória nas contas de primeiro nível; nas demais, em branco herda da conta superior. Toda a subárvore tem a mesma natureza.",
  ],
  [
    "Grupo DRE",
    "Linha da DRE em que a conta aparece. Obrigatório nas analíticas; em branco herda da conta superior mais próxima que tenha um. Investimentos e Financiamentos ficam fora do resultado.",
  ],
  [
    "Descrição",
    "Opcional. Quando usar a conta — ajuda quem lança a escolher certo.",
  ],
  ["", ""],
  [
    "Importação",
    "Contas com código que já existe no sistema são atualizadas; códigos novos são criados; contas do sistema que não estão na planilha ficam como estão (nada é excluído). Se houver qualquer erro, nada é gravado e a tela lista as linhas a corrigir.",
  ],
  [
    "CSV",
    "Também aceito, com as mesmas colunas, separado por ponto e vírgula ou vírgula, em UTF-8 ou no padrão do Excel.",
  ],
  ["", ""],
  ["Grupos da DRE", ""],
  ...DRE_GROUPS.map((g): [string, string] => [g.label, g.hint]),
];

export const chartOfAccountsService = {
  getAll: (companyId: string) => companyAccounts(companyId),

  /** Ano a partir do qual a classificação é obrigatória (ou `null`). */
  getRequiredFrom: async (companyId: string): Promise<number | null> => {
    const snap = await getDoc(doc(db, "companies", companyId));
    return (snap.data()?.chartOfAccountsRequiredFrom as number) ?? null;
  },

  setRequiredFrom: async (
    companyId: string,
    year: number | null,
    actor: Actor,
  ) => {
    await updateDoc(doc(db, "companies", companyId), {
      chartOfAccountsRequiredFrom: year ?? deleteField(),
    });
    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "update",
      entity: "company",
      entityId: companyId,
      details: { chartOfAccountsRequiredFrom: year ?? "opcional" },
    });
  },

  create: async (draft: AccountDraft, companyId: string, actor: Actor) => {
    const all = await companyAccounts(companyId);
    const { accounts, issues } = resolvePlan([...all.map(toDraft), draft]);
    firstIssue(issues);
    const resolved = accounts.find((a) => a.code === draft.code)!;

    const ref = await addDoc(
      collection(db, COLLECTION_NAME),
      stripUndefined({
        ...writable(resolved, false),
        archived: false,
        companyId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );

    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "create",
      entity: "chart_account",
      entityId: ref.id,
      details: { code: resolved.code, name: resolved.name },
    });
    return ref.id;
  },

  /**
   * Atualiza uma conta. Mudar o código de uma sintética leva junto todas as
   * descendentes (3.1 → 3.4 faz 3.1.02 virar 3.4.02): o código é a hierarquia,
   * e filhas com o prefixo antigo ficariam órfãs.
   */
  update: async (id: string, draft: AccountDraft, actor: Actor) => {
    const snap = await getDoc(doc(db, COLLECTION_NAME, id));
    const companyId = snap.data()?.companyId as string | undefined;
    if (!companyId) throw new Error("Conta não encontrada.");

    const all = await companyAccounts(companyId);
    const self = all.find((a) => a.id === id)!;
    const oldCode = self.code;
    const renamed = (code: string) =>
      code === oldCode
        ? draft.code
        : code.startsWith(`${oldCode}.`)
          ? draft.code + code.slice(oldCode.length)
          : code;

    const nextDrafts = all.map((a) =>
      a.id === id
        ? { ...draft, archived: a.archived }
        : { ...toDraft(a), code: renamed(a.code) },
    );
    const { accounts, issues } = resolvePlan(nextDrafts);
    firstIssue(issues);
    await assertSafeChanges(
      companyId,
      all.map((a) => ({ ...a, code: renamed(a.code) })),
      accounts,
    );

    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const ops = all
      .filter((a) => a.id === id || a.code !== renamed(a.code))
      .map(
        (a) => (batch: ReturnType<typeof writeBatch>) =>
          batch.update(doc(db, COLLECTION_NAME, a.id), {
            ...writable(byCode.get(renamed(a.code))!, true),
            updatedAt: serverTimestamp(),
          }),
      );
    await commitInChunks(ops);

    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "update",
      entity: "chart_account",
      entityId: id,
      details: stripUndefined({
        code: draft.code,
        name: draft.name,
        previousCode: oldCode !== draft.code ? oldCode : undefined,
        descendantsRenamed: ops.length - 1 || undefined,
      }),
    });
  },

  /**
   * Excluir só conta sem uso. Com lançamento ou recorrência, a saída é
   * arquivar: some dos formulários e a DRE de períodos passados continua
   * fechando.
   */
  delete: async (id: string, actor: Actor) => {
    const snap = await getDoc(doc(db, COLLECTION_NAME, id));
    const companyId = snap.data()?.companyId as string | undefined;
    if (!companyId) throw new Error("Conta não encontrada.");
    const code = snap.data()!.code as string;

    const all = await companyAccounts(companyId);
    if (all.some((a) => parentCodeOf(a.code) === code)) {
      throw new Error(
        "Não é possível excluir: esta conta tem subcontas. Exclua-as primeiro.",
      );
    }

    const refs = await referencesTo(companyId, [id]);
    const reasons = [
      refs.transactions && "lançamentos",
      refs.recurrences.length > 0 &&
        `recorrências ativas (${refs.recurrences.join(", ")})`,
    ].filter(Boolean);
    if (reasons.length > 0) {
      throw new Error(
        `Não é possível excluir: esta conta tem ${reasons.join(" e ")}. ` +
          "Arquive-a — ela sai dos formulários e os relatórios continuam fechando.",
      );
    }

    await deleteDoc(doc(db, COLLECTION_NAME, id));

    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "delete",
      entity: "chart_account",
      entityId: id,
      details: { code, name: snap.data()!.name },
    });
  },

  /**
   * Arquivar vale para a subárvore inteira (uma sintética arquivada com filhas
   * ativas não faria sentido); desarquivar também, e exige a conta superior
   * ativa.
   */
  setArchived: async (id: string, archived: boolean, actor: Actor) => {
    const snap = await getDoc(doc(db, COLLECTION_NAME, id));
    const companyId = snap.data()?.companyId as string | undefined;
    if (!companyId) throw new Error("Conta não encontrada.");
    const code = snap.data()!.code as string;

    const all = await companyAccounts(companyId);
    const subtree = all.filter(
      (a) => a.code === code || a.code.startsWith(`${code}.`),
    );

    if (archived) {
      const { recurrences } = await referencesTo(
        companyId,
        subtree.map((a) => a.id),
      );
      if (recurrences.length > 0) {
        throw new Error(
          `Há recorrências ativas nesta conta: ${recurrences.join(", ")}. ` +
            "Aponte-as para outra conta antes de arquivar.",
        );
      }
    } else {
      const parent = all.find((a) => a.code === parentCodeOf(code));
      if (parent?.archived) {
        throw new Error(
          `Desarquive antes a conta superior, ${parent.code} · ${parent.name}.`,
        );
      }
    }

    await commitInChunks(
      subtree.map(
        (a) => (batch) =>
          batch.update(doc(db, COLLECTION_NAME, a.id), {
            archived,
            updatedAt: serverTimestamp(),
          }),
      ),
    );

    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "update",
      entity: "chart_account",
      entityId: id,
      details: { code, archived, accounts: subtree.length },
    });
  },

  /**
   * Confronta a planilha com o plano atual sem gravar nada.
   *
   * Mescla por código: o que existe é atualizado, o que é novo é criado, e o
   * que só existe no sistema fica como está. O plano resultante é validado
   * inteiro — uma planilha que só acrescenta subcontas a uma conta que já
   * existe precisa ser checada contra ela.
   */
  previewImport: async (
    companyId: string,
    drafts: AccountDraft[],
  ): Promise<ImportPreview> => {
    const existing = await companyAccounts(companyId);
    const fileCodes = new Set(drafts.map((d) => d.code));
    const byCode = new Map(existing.map((a) => [a.code, a]));

    const { accounts, issues } = resolvePlan([
      ...existing.filter((a) => !fileCodes.has(a.code)).map(toDraft),
      ...drafts.map((d) => ({ ...d, archived: byCode.get(d.code)?.archived })),
    ]);

    const preview: ImportPreview = {
      issues,
      toCreate: [],
      toUpdate: [],
      unchanged: 0,
      kept: existing.filter((a) => !fileCodes.has(a.code)).length,
    };
    if (issues.length > 0) return preview;

    for (const next of accounts) {
      if (!fileCodes.has(next.code)) continue;
      const current = byCode.get(next.code);
      if (!current) preview.toCreate.push(next);
      else if (sameAccount(current, next)) preview.unchanged++;
      else preview.toUpdate.push({ current, next });
    }

    try {
      await assertSafeChanges(companyId, existing, accounts);
    } catch (e) {
      preview.issues.push({ message: (e as Error).message });
    }
    return preview;
  },

  applyImport: async (
    companyId: string,
    preview: ImportPreview,
    actor: Actor,
    source: string,
  ) => {
    if (preview.issues.length > 0) throw new Error(preview.issues[0].message);

    await commitInChunks([
      ...preview.toCreate.map(
        (a) => (batch: ReturnType<typeof writeBatch>) =>
          batch.set(
            doc(collection(db, COLLECTION_NAME)),
            stripUndefined({
              ...writable(a, false),
              archived: false,
              companyId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
          ),
      ),
      ...preview.toUpdate.map(
        ({ current, next }) =>
          (batch: ReturnType<typeof writeBatch>) =>
            batch.update(doc(db, COLLECTION_NAME, current.id), {
              ...writable(next, true),
              updatedAt: serverTimestamp(),
            }),
      ),
    ]);

    auditService.log({
      companyId,
      userId: actor.uid,
      userEmail: actor.email,
      action: "create",
      entity: "chart_account",
      entityId: `import:${preview.toCreate.length + preview.toUpdate.length}`,
      details: {
        source,
        created: preview.toCreate.length,
        updated: preview.toUpdate.length,
        unchanged: preview.unchanged,
      },
    });
  },

  /** Lê .xlsx, .xls ou .csv no formato do modelo. */
  parseFile: async (
    file: File,
  ): Promise<{ drafts: AccountDraft[]; issues: PlanIssue[] }> => {
    const XLSX = await import("xlsx");
    const isText = /\.(csv|txt)$/i.test(file.name);
    const workbook = isText
      ? XLSX.read(await decodeText(file), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });

    const sheetName =
      workbook.SheetNames.find((n) => headerKey(n) === "plano de contas") ??
      workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      { header: 1, raw: false, defval: "" },
    );

    // Cabeçalho: a primeira linha (entre as 10 primeiras) com coluna de código.
    const headerIndex = rows
      .slice(0, 10)
      .findIndex((r) => r.some((h) => HEADER_MAP[headerKey(h)] === "code"));
    if (headerIndex === -1) {
      return {
        drafts: [],
        issues: [
          {
            message:
              'Não encontramos a coluna "Código". Use o modelo do sistema ou mantenha os títulos das colunas na primeira linha.',
          },
        ],
      };
    }

    const columns = rows[headerIndex].map((h) => HEADER_MAP[headerKey(h)]);
    // Muitos planos chamam o nome da conta de "Descrição".
    if (!columns.includes("name")) {
      const i = columns.indexOf("description");
      if (i !== -1) columns[i] = "name";
    }

    const drafts: AccountDraft[] = [];
    const issues: PlanIssue[] = [];
    rows.slice(headerIndex + 1).forEach((row, i) => {
      const line = headerIndex + i + 2;
      const cell = (field: keyof AccountDraft) => {
        const c = columns.indexOf(field);
        return c === -1 ? "" : String(row[c] ?? "").trim();
      };
      if (!cell("code") && !cell("name")) return;

      const type = parseAccountType(cell("type"));
      const nature = parseAccountNature(cell("nature"));
      const dreGroup = parseDreGroup(cell("dreGroup"));
      const code = normalizeCode(cell("code"));
      const bad = (field: string, value: string) =>
        issues.push({
          line,
          code,
          message: `Linha ${line}: ${field} "${value}" não reconhecido.`,
        });
      if (type === null) bad("tipo", cell("type"));
      if (nature === null) bad("natureza", cell("nature"));
      if (dreGroup === null) bad("grupo DRE", cell("dreGroup"));

      drafts.push({
        line,
        code,
        name: cell("name"),
        type: type ?? undefined,
        nature: nature ?? undefined,
        dreGroup: dreGroup ?? undefined,
        description: cell("description") || undefined,
      });
    });

    return { drafts, issues };
  },

  /**
   * Planilha no formato de importação: o modelo (em branco ou pronto) ou o
   * plano atual da empresa. Tipo, natureza e grupo saem com lista suspensa.
   */
  downloadSpreadsheet: async (
    source:
      | { kind: "blank" }
      | { kind: "model"; model: ChartModelKey }
      | { kind: "current"; accounts: ChartAccount[]; companyName: string },
  ) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FinControl";
    workbook.created = new Date();

    const rows =
      source.kind === "blank"
        ? EXAMPLE_ROWS
        : source.kind === "model"
          ? sheetRows(
              resolvePlan([...CHART_MODELS[source.model].accounts]).accounts,
            )
          : sheetRows(source.accounts);

    const sheet = workbook.addWorksheet("Plano de Contas", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { width: 14, style: { numFmt: "@" } },
      { width: 48 },
      { width: 13 },
      { width: 12 },
      { width: 40 },
      { width: 50 },
    ];
    const header = sheet.addRow(HEADERS);
    header.height = 22;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
      cell.alignment = { vertical: "middle" };
    });
    for (const r of rows) {
      const row = sheet.addRow(r);
      if (r[2] === ACCOUNT_TYPE_LABEL.synthetic) row.font = { bold: true };
    }

    // Listas das validações numa aba oculta: a lista de grupos passa de 255
    // caracteres, o limite de uma lista digitada direto na validação.
    const lists = workbook.addWorksheet("Listas", { state: "hidden" });
    const typeLabels = Object.values(ACCOUNT_TYPE_LABEL);
    const natureLabels = Object.values(ACCOUNT_NATURE_LABEL);
    lists.getColumn(1).values = ["Tipo", ...typeLabels];
    lists.getColumn(2).values = ["Natureza", ...natureLabels];
    lists.getColumn(3).values = [
      "Grupo DRE",
      ...DRE_GROUPS.map((g) => g.label),
    ];
    const lastRow = Math.max(rows.length + 500, 1000);
    const listRange = (col: string, n: number) => [
      `Listas!$${col}$2:$${col}$${n + 1}`,
    ];
    for (let r = 2; r <= lastRow; r++) {
      sheet.getCell(`C${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: listRange("A", typeLabels.length),
      };
      sheet.getCell(`D${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: listRange("B", natureLabels.length),
      };
      sheet.getCell(`E${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: listRange("C", DRE_GROUPS.length),
      };
    }

    const help = workbook.addWorksheet("Instruções");
    help.columns = [{ width: 26 }, { width: 110 }];
    help.addRow(["Como preencher o plano de contas"]).font = {
      bold: true,
      size: 13,
    };
    help.addRow([]);
    for (const [k, v] of INSTRUCTIONS) {
      const row = help.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename =
      source.kind === "current"
        ? `plano_de_contas_${format(new Date(), "yyyyMMdd")}.xlsx`
        : source.kind === "model"
          ? `modelo_plano_de_contas_${source.model === "company" ? "empresas" : "terceiro_setor"}.xlsx`
          : "modelo_plano_de_contas.xlsx";
    downloadBlob(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      filename,
    );
  },

  /** Mesmo modelo em CSV — ponto e vírgula, como o Excel em português abre. */
  downloadCsvTemplate: () => {
    const esc = (v: string) =>
      /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const content = [HEADERS, ...EXAMPLE_ROWS]
      .map((r) => r.map(esc).join(";"))
      .join("\r\n");
    downloadBlob(
      new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" }),
      "modelo_plano_de_contas.csv",
    );
  },
};
