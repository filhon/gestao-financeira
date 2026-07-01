import {
  BankTransaction,
  Transaction,
  Entity,
  ReconciliationMatchCandidate,
} from "@/lib/types";
import { differenceInDays } from "date-fns";
import { parse as parseOFXData } from "ofx-js";
import Papa from "papaparse";
import currency from "currency.js";

export class ReconciliationService {
  static async parseStatement(
    fileContent: string,
    type: "csv" | "json" | "ofx",
  ): Promise<BankTransaction[]> {
    if (type === "json") {
      try {
        const raw = JSON.parse(fileContent);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return raw.map((item: any) => {
          const date = this.parseDate(item.date) || new Date(item.date);
          const amount = this.parseAmount(item.amount);
          const description = String(item.description || "");
          return {
            id:
              item.id || item.fitid || item.documentNumber
                ? String(item.id || item.fitid || item.documentNumber)
                : this.buildDedupId("json", date, amount, description),
            date,
            amount,
            description,
            type: Number(item.amount) < 0 ? "debit" : "credit",
            status: "unmatched",
            confidence: 0,
          };
        });
      } catch (e) {
        console.error("Failed to parse JSON", e);
        return [];
      }
    } else if (type === "ofx") {
      return await this.parseOFX(fileContent);
    } else if (type === "csv") {
      return this.parseCSV(fileContent);
    }

    return [];
  }

  static parseCSV(content: string): BankTransaction[] {
    const transactions: BankTransaction[] = [];
    const seen = new Set<string>();

    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => this.normalizeText(h),
    });

    if (parsed.errors.length > 0) {
      console.warn("CSV parsing warnings:", parsed.errors);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parsed.data.forEach((row: any) => {
      const dateVal =
        row.data || row.date || row.dt || row.dtpost || row.dtposted;
      const descVal =
        row.descricao ||
        row.description ||
        row.historico ||
        row.memo ||
        row.lancamento ||
        row.narrativa ||
        row.details ||
        "";
      const docVal =
        row.documento || row.doc || row.numero || row.id || row.fitid;

      let amount = 0;
      if (
        row.valor !== undefined ||
        row.amount !== undefined ||
        row.montante !== undefined ||
        row.valorlancamento !== undefined
      ) {
        amount = this.parseAmount(
          row.valor || row.amount || row.montante || row.valorlancamento,
        );
      } else if (
        row.debito !== undefined ||
        row.credito !== undefined ||
        row.debit !== undefined ||
        row.credit !== undefined
      ) {
        const debit = this.parseAmount(row.debito || row.debit || "0");
        const credit = this.parseAmount(row.credito || row.credit || "0");
        amount = currency(credit).subtract(debit).value;
      }

      const date = this.parseDate(dateVal);
      if (!date || !Number.isFinite(amount)) return;

      const description = String(descVal).trim();
      const key = `${date.toISOString().slice(0, 10)}|${amount}|${this.normalizeText(description)}`;

      if (seen.has(key)) return;
      seen.add(key);

      transactions.push({
        id: docVal || this.buildDedupId("csv", date, amount, description),
        date,
        amount,
        description,
        type: amount < 0 ? "debit" : "credit",
        status: "unmatched",
        confidence: 0,
        documentNumber: docVal,
      });
    });

    return transactions;
  }

  static async parseOFX(content: string): Promise<BankTransaction[]> {
    const transactions: BankTransaction[] = [];
    try {
      const parsedOfx = await parseOFXData(content);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findTransactions = (obj: any): any[] => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let results: any[] = [];
        if (!obj || typeof obj !== "object") return results;

        if (Array.isArray(obj)) {
          for (const item of obj) {
            results = results.concat(findTransactions(item));
          }
        } else {
          for (const key in obj) {
            if (key === "STMTTRN") {
              const val = obj[key];
              if (Array.isArray(val)) results = results.concat(val);
              else results.push(val);
            } else {
              results = results.concat(findTransactions(obj[key]));
            }
          }
        }
        return results;
      };

      const txNodes = findTransactions(parsedOfx);

      for (const node of txNodes) {
        const dateStr = node.DTPOSTED || "";
        const amountStr = node.TRNAMT || "0";
        const fitId = node.FITID || `gen-${Math.random()}`;
        const name = node.NAME || "";
        const memo = node.MEMO || "";

        const date = this.parseDate(dateStr);
        if (!date) continue;

        const amount = this.parseAmount(amountStr);

        transactions.push({
          id: fitId,
          date,
          amount,
          description: (memo || name || "").trim(),
          type: amount < 0 ? "debit" : "credit",
          status: "unmatched",
          confidence: 0,
          documentNumber: fitId,
        });
      }
    } catch (e) {
      console.error("Failed to parse OFX", e);
    }
    return transactions;
  }

  static findMatches(
    bankTx: BankTransaction,
    systemTransactions: Transaction[],
    entitiesMap: Record<string, Entity> = {},
  ): {
    matchedId?: string;
    matchedTransactionIds?: string[];
    matchedDetails?: Transaction;
    matchedBundleDetails?: Transaction[];
    matchCandidates?: ReconciliationMatchCandidate[];
    confidence: number;
    status: BankTransaction["status"];
  } {
    // Filter by type (credit/debit must match payable/receivable logic).
    // Already-reconciled transactions are excluded so a bank line can never
    // "steal" a match that was already confirmed against another statement line.
    let relevantSystemTxs = systemTransactions.filter((tx) => {
      if (tx.reconciled) return false;
      if (bankTx.amount < 0 && tx.type === "payable") return true;
      if (bankTx.amount > 0 && tx.type === "receivable") return true;
      return false;
    });

    const bankDate = new Date(bankTx.date);
    const bankCNPJ = this.extractCNPJ(bankTx.description || "");

    if (bankCNPJ) {
      relevantSystemTxs = relevantSystemTxs.filter(
        (tx) => this.getTransactionDocument(tx, entitiesMap) === bankCNPJ,
      );
    }

    const candidates = relevantSystemTxs
      .map((tx) =>
        this.buildCandidate(bankTx, tx, bankDate, bankCNPJ, entitiesMap),
      )
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const top = candidates[0];
    if (top && top.score >= 90) {
      return {
        matchedId: top.id,
        matchedDetails: top.transaction,
        matchCandidates: candidates,
        confidence: top.score,
        status: "matched",
      };
    }

    if (top && top.score >= 70) {
      return {
        matchedId: top.id,
        matchedDetails: top.transaction,
        matchCandidates: candidates,
        confidence: top.score,
        status: "potential_match",
      };
    }

    // 3. Bundle Match (Multiple transactions summing to bank amount)
    const bundleMatch = this.findBundledMatch(
      bankTx,
      relevantSystemTxs,
      entitiesMap,
      bankCNPJ,
    );
    if (bundleMatch) {
      return {
        matchedTransactionIds: bundleMatch.ids,
        matchedBundleDetails: bundleMatch.details,
        matchCandidates: candidates,
        confidence: 90,
        status: "potential_match",
      };
    }

    return { confidence: 0, status: "unmatched", matchCandidates: candidates };
  }

  private static findBundledMatch(
    bankTx: BankTransaction,
    candidates: Transaction[],
    entitiesMap: Record<string, Entity>,
    bankCNPJ: string | null,
  ): { ids: string[]; details: Transaction[] } | null {
    // Logic:
    // 1. Filter candidates close in date (e.g., +/- 3 days)
    // 2. Group by Entity (Payee) if possible
    // 3. For each group (or global if no entity), try to find a subset sum

    const bankDate = new Date(bankTx.date);
    const targetAmount = Math.abs(bankTx.amount);

    const closeCandidates = candidates.filter((tx) => {
      const diff = Math.abs(differenceInDays(new Date(tx.dueDate), bankDate));
      return (
        diff <= 5 &&
        Math.abs(tx.amount) <= currency(targetAmount).add(0.5).value
      ); // tolerance
    });

    // Try to match by Entity/CNPJ first (Heuristic: Bundled payments are usually for the same supplier)
    const byEntity: Record<string, Transaction[]> = {};
    const filteredByCNPJ = bankCNPJ
      ? closeCandidates.filter(
          (tx) => this.getTransactionDocument(tx, entitiesMap) === bankCNPJ,
        )
      : closeCandidates;

    filteredByCNPJ.forEach((tx) => {
      const cnpj = this.getTransactionDocument(tx, entitiesMap);
      const key = cnpj || tx.entityId || "unknown";
      if (!byEntity[key]) byEntity[key] = [];
      byEntity[key].push(tx);
    });

    for (const entityId in byEntity) {
      if (entityId === "unknown") continue;

      const group = byEntity[entityId];
      if (group.length < 2) continue;
      // Try to find sum in this group
      const match = this.subsetSum(group, targetAmount);
      if (match) return { ids: match.map((t) => t.id), details: match };
    }

    // Sem CNPJ explícito, não fazemos bundle global para evitar mistura de fornecedores

    return null;
  }

  // Basic subset sum implementation
  private static subsetSum(
    transactions: Transaction[],
    target: number,
  ): Transaction[] | null {
    // This is 2^N. Keep N small.
    // Epsilon for float comparison
    const EPSILON = 0.05;

    const n = transactions.length;
    // Limit recursion depth/complexity
    const limit = Math.min(n, 12);

    for (let i = 1; i < 1 << limit; i++) {
      let sum = currency(0);
      const subset: Transaction[] = [];
      for (let j = 0; j < limit; j++) {
        if ((i >> j) & 1) {
          sum = sum.add(Math.abs(transactions[j].amount));
          subset.push(transactions[j]);
        }
      }
      if (Math.abs(sum.subtract(target).value) < EPSILON) {
        return subset;
      }
    }
    return null;
  }

  static runAutoReconciliation(
    bankTxs: BankTransaction[],
    systemTxs: Transaction[],
    entities: Entity[] = [],
  ): BankTransaction[] {
    const usedSystemTxIds = new Set<string>();

    // Map entities for fast lookup
    const entitiesMap = entities.reduce(
      (acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      },
      {} as Record<string, Entity>,
    );

    const results = [...bankTxs];

    // PASS 1: High Confidence Matches
    results.forEach((btx, index) => {
      if (btx.status === "matched" || btx.status === "ignored") return;

      // Pass only available system transactions
      const availableSystemTxs = systemTxs.filter(
        (t) => !usedSystemTxIds.has(t.id),
      );
      const match = this.findMatches(btx, availableSystemTxs, entitiesMap);

      if (match.status !== "unmatched" && match.confidence >= 90) {
        results[index] = { ...btx, ...match };
        // Mark used
        if (match.matchedId) usedSystemTxIds.add(match.matchedId);
        if (match.matchedTransactionIds)
          match.matchedTransactionIds.forEach((id) => usedSystemTxIds.add(id));
      }
    });

    // PASS 2: Remaining Matches
    results.forEach((btx, index) => {
      // Skip if already processed in Pass 1 or existing status
      if (
        results[index].status === "matched" ||
        results[index].status === "potential_match" ||
        results[index].status === "ignored"
      )
        return;

      const availableSystemTxs = systemTxs.filter(
        (t) => !usedSystemTxIds.has(t.id),
      );
      const match = this.findMatches(btx, availableSystemTxs, entitiesMap);

      if (match.status !== "unmatched") {
        results[index] = { ...btx, ...match };
        // Mark used
        if (match.matchedId) usedSystemTxIds.add(match.matchedId);
        if (match.matchedTransactionIds)
          match.matchedTransactionIds.forEach((id) => usedSystemTxIds.add(id));
      }
    });

    return results;
  }

  // Deterministic id for statement formats without a native document number
  // (CSV/JSON), so re-importing the same or an overlapping statement produces
  // the same id and the session merge treats it as already-seen.
  private static buildDedupId(
    prefix: string,
    date: Date,
    amount: number,
    description: string,
  ): string {
    const datePart = date.toISOString().slice(0, 10);
    const amountPart = amount.toFixed(2).replace("-", "n").replace(".", "c");
    const descPart =
      this.normalizeText(description).replace(/\s+/g, "-").slice(0, 60) ||
      "sem-descricao";
    return `${prefix}-${datePart}-${amountPart}-${descPart}`;
  }

  private static extractCNPJ(text: string): string | null {
    // Basic extraction of 14 digits or 11 digits
    // Removes non-digits first
    // Look for sequence of 14 (CNPJ) or 11 (CPF) inside the cleaned string?
    // Usually extracting from description: "PAYMENT TO 12.345.678/0001-99"
    // Regex for formatted:
    const formattedMatch = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (formattedMatch) return formattedMatch[0].replace(/\D/g, "");

    const cpfMatch = text.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    if (cpfMatch) return cpfMatch[0].replace(/\D/g, "");

    // Fallback: look for 14 contiguous digits
    const rawMatch = text.match(/\d{14}/);
    if (rawMatch) return rawMatch[0];

    // Fallback: look for 11 contiguous digits (CPF)
    const rawCpfMatch = text.match(/\d{11}/);
    if (rawCpfMatch) return rawCpfMatch[0];

    return null;
  }

  private static buildCandidate(
    bankTx: BankTransaction,
    tx: Transaction,
    bankDate: Date,
    bankCNPJ: string | null,
    entitiesMap: Record<string, Entity>,
  ): ReconciliationMatchCandidate {
    const txDate = new Date(tx.dueDate);
    const dateDiff = Math.abs(differenceInDays(txDate, bankDate));
    const amountDiff = Math.abs(
      currency(Math.abs(tx.amount)).subtract(Math.abs(bankTx.amount)).value,
    );

    const entity = tx.entityId ? entitiesMap[tx.entityId] : undefined;
    const entityName = entity?.name || tx.supplierOrClient;

    const txText = [tx.description, entityName, tx.notes]
      .filter(Boolean)
      .join(" ");
    const normalizedBank = this.normalizeText(bankTx.description);
    const normalizedTx = this.normalizeText(txText);

    const similarity = this.stringSimilarity(normalizedBank, normalizedTx);

    const reasons: string[] = [];

    const amountScore =
      amountDiff <= 0.01
        ? 50
        : amountDiff <= 0.05
          ? 45
          : amountDiff <= 0.5
            ? 30
            : amountDiff <= 1
              ? 20
              : 0;
    if (amountScore > 0)
      reasons.push(`Valor próximo (Δ ${amountDiff.toFixed(2)})`);

    const dateScore =
      dateDiff === 0
        ? 20
        : dateDiff <= 1
          ? 18
          : dateDiff <= 2
            ? 15
            : dateDiff <= 3
              ? 12
              : dateDiff <= 5
                ? 8
                : dateDiff <= 10
                  ? 4
                  : 0;
    if (dateScore > 0) reasons.push(`Data próxima (${dateDiff}d)`);

    const descScore = Math.round(similarity * 20);
    if (descScore > 0)
      reasons.push(`Descrição similar (${Math.round(similarity * 100)}%)`);

    const nameBoost =
      entityName &&
      (normalizedBank.includes(this.normalizeText(entityName)) ||
        this.normalizeText(entityName).includes(normalizedBank))
        ? 10
        : 0;
    if (nameBoost > 0) reasons.push("Entidade compatível");

    const txCNPJ = this.getTransactionDocument(tx, entitiesMap);
    if (bankCNPJ && txCNPJ && txCNPJ !== bankCNPJ) {
      return {
        id: tx.id,
        score: 0,
        reasons: ["CPF/CNPJ divergente"],
        transaction: tx,
        entityName,
      };
    }

    let cnpjScore = 0;
    if (bankCNPJ) {
      if (txCNPJ && txCNPJ === bankCNPJ) {
        cnpjScore = 20;
        reasons.push("CPF/CNPJ compatível");
      }
    }

    if (!bankCNPJ && similarity < 0.12 && !nameBoost) {
      return {
        id: tx.id,
        score: 0,
        reasons: ["Descrição fraca"],
        transaction: tx,
        entityName,
      };
    }

    const score = Math.min(
      100,
      amountScore + dateScore + descScore + cnpjScore + nameBoost,
    );

    return {
      id: tx.id,
      score,
      reasons,
      transaction: tx,
      entityName,
    };
  }

  private static parseDate(
    value: string | number | Date | null | undefined,
  ): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const raw = String(value).trim();
    if (!raw) return null;

    // OFX: YYYYMMDDHHMMSS[...]
    const ofxMatch = raw.match(/^(\d{8})/);
    if (ofxMatch) {
      const y = Number(ofxMatch[1].slice(0, 4));
      const m = Number(ofxMatch[1].slice(4, 6)) - 1;
      const d = Number(ofxMatch[1].slice(6, 8));
      const date = new Date(y, m, d);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const normalized = raw.replace(/T.*$/, "");
    const parts = normalized.split(/[-/]/).map((p) => p.trim());
    if (parts.length === 3) {
      const [p1, p2, p3] = parts;
      // YYYY-MM-DD
      if (p1.length === 4) {
        const date = new Date(Number(p1), Number(p2) - 1, Number(p3));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      // DD/MM/YYYY
      const date = new Date(Number(p3), Number(p2) - 1, Number(p1));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  private static getTransactionDocument(
    tx: Transaction,
    entitiesMap: Record<string, Entity>,
  ): string | null {
    const entity = tx.entityId ? entitiesMap[tx.entityId] : undefined;
    const entityDoc = entity?.document
      ? entity.document.replace(/\D/g, "")
      : null;
    return (
      this.extractCNPJ(tx.description || "") ||
      (tx.supplierOrClient ? this.extractCNPJ(tx.supplierOrClient) : null) ||
      entityDoc
    );
  }

  private static parseAmount(
    value: string | number | null | undefined,
  ): number {
    if (typeof value === "number") return value;
    if (!value) return 0;
    const raw = String(value).trim();
    if (!raw) return 0;

    const sanitized = raw.replace(/[^0-9,.-]/g, "").replace(/\.(?=.*\.)/g, "");

    const hasComma = sanitized.includes(",");
    const hasDot = sanitized.includes(".");

    let normalized = sanitized;
    if (hasComma && hasDot) {
      // Assume last separator is decimal
      const lastComma = sanitized.lastIndexOf(",");
      const lastDot = sanitized.lastIndexOf(".");
      const decimalSeparator = lastComma > lastDot ? "," : ".";
      normalized = sanitized
        .replace(decimalSeparator, "DECIMAL")
        .replace(/[.,]/g, "")
        .replace("DECIMAL", ".");
    } else if (hasComma && !hasDot) {
      normalized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = sanitized;
    }

    const parsed = Number(normalized);
    // Snap to a clean 2-decimal currency value so downstream comparisons
    // never drift on float representation artifacts from the raw string.
    return Number.isNaN(parsed) ? 0 : currency(parsed).value;
  }

  private static normalize(value: string): string {
    return this.normalizeText(value)
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }

  private static normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(
        /\b(pagamento|pagto|transferencia|transf|pix|ted|doc|boleto|tarifa|juros|estorno|compra|debito|credito)\b/g,
        " ",
      )
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static stringSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const bigrams = (str: string) => {
      const s = ` ${str} `;
      const pairs: string[] = [];
      for (let i = 0; i < s.length - 1; i++) {
        pairs.push(s.slice(i, i + 2));
      }
      return pairs;
    };
    const pairsA = bigrams(a);
    const pairsB = bigrams(b);
    const map = new Map<string, number>();
    pairsA.forEach((p) => map.set(p, (map.get(p) || 0) + 1));
    let intersection = 0;
    pairsB.forEach((p) => {
      const count = map.get(p) || 0;
      if (count > 0) {
        map.set(p, count - 1);
        intersection++;
      }
    });
    return (2 * intersection) / (pairsA.length + pairsB.length);
  }
}
