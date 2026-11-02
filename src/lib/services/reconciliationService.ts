import { BankTransaction } from "@/lib/types";
import { parse as parseOFXData } from "ofx-js";
import Papa from "papaparse";
import currency from "currency.js";

export class ReconciliationService {
  /**
   * OFX 1.x é SGML e aceita `&` cru (ex.: "N&M COMERCIO"), mas o ofx-js
   * converte para XML e usa um parser estrito. Escapa todo `&` que não
   * inicia uma entidade.
   */
  private static parseOFXContent(content: string) {
    return parseOFXData(
      content.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;"),
    );
  }

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

  /**
   * Conta de origem (BANKACCTFROM) e saldo final (LEDGERBAL) de um OFX. Tudo
   * opcional: há bancos que omitem o saldo, e cartão vem sem BANKID.
   */
  static async parseOFXMeta(content: string): Promise<{
    bankCode?: string;
    branchId?: string;
    accountNumber?: string;
    balance?: number;
    balanceDate?: Date;
  }> {
    try {
      const parsed = await this.parseOFXContent(content);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const find = (obj: any, key: string): any => {
        if (!obj || typeof obj !== "object") return undefined;
        if (key in obj) return obj[key];
        for (const k in obj) {
          const hit = find(obj[k], key);
          if (hit !== undefined) return hit;
        }
        return undefined;
      };
      const account =
        find(parsed, "BANKACCTFROM") ?? find(parsed, "CCACCTFROM");
      const ledger = find(parsed, "LEDGERBAL");
      return {
        bankCode: account?.BANKID ? String(account.BANKID) : undefined,
        branchId: account?.BRANCHID ? String(account.BRANCHID) : undefined,
        accountNumber: account?.ACCTID ? String(account.ACCTID) : undefined,
        balance:
          ledger?.BALAMT !== undefined
            ? this.parseAmount(ledger.BALAMT)
            : undefined,
        balanceDate: this.parseDate(ledger?.DTASOF) ?? undefined,
      };
    } catch (e) {
      console.error("Failed to parse OFX header", e);
      return {};
    }
  }

  static async parseOFX(content: string): Promise<BankTransaction[]> {
    const transactions: BankTransaction[] = [];
    try {
      const parsedOfx = await this.parseOFXContent(content);

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
        const name = node.NAME || "";
        const memo = node.MEMO || "";

        const date = this.parseDate(dateStr);
        if (!date) continue;

        const amount = this.parseAmount(amountStr);
        const description = (memo || name || "").trim();
        const fitId =
          node.FITID || this.buildDedupId("ofx", date, amount, description);

        transactions.push({
          id: fitId,
          date,
          amount,
          description,
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
}
