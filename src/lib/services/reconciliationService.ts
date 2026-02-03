import { BankTransaction, Transaction } from "@/lib/types";
import { differenceInDays } from "date-fns";

export class ReconciliationService {
  static parseStatement(
    fileContent: string,
    type: "csv" | "json" | "ofx",
  ): BankTransaction[] {
    if (type === "json") {
      try {
        const raw = JSON.parse(fileContent);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return raw.map((item: any, index: number) => ({
          id: `bank-tx-${index}-${Date.now()}`,
          date: new Date(item.date),
          amount: Number(item.amount),
          description: item.description,
          type: Number(item.amount) < 0 ? "debit" : "credit",
          status: "unmatched",
          confidence: 0,
        }));
      } catch (e) {
        console.error("Failed to parse JSON", e);
        return [];
      }
    } else if (type === "ofx") {
      return this.parseOFX(fileContent);
    }

    return [];
  }

  static parseOFX(content: string): BankTransaction[] {
    const transactions: BankTransaction[] = [];
    try {
      // Rudimentary Regex OFX Parser
      const transactionRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
      let match;

      while ((match = transactionRegex.exec(content)) !== null) {
        const block = match[1];

        const dateMatch = /<DTPOSTED>(.*)/.exec(block);
        const amountMatch = /<TRNAMT>(.*)/.exec(block);
        const fitidMatch = /<FITID>(.*)/.exec(block);
        const nameMatch = /<NAME>(.*)/.exec(block);
        const memoMatch = /<MEMO>(.*)/.exec(block);

        const dateStr = dateMatch ? dateMatch[1].trim() : "";
        const amountStr = amountMatch ? amountMatch[1].trim() : "0";
        const fitId = fitidMatch
          ? fitidMatch[1].trim()
          : `gen-${Math.random()}`;
        const name = nameMatch ? nameMatch[1].trim() : "";
        const memo = memoMatch ? memoMatch[1].trim() : "";

        // Parse Date: YYYYMMDDHHMMSS[-5:EST]
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        const date = new Date(year, month, day);

        const amount = parseFloat(amountStr); // OFX uses negative for debit usually

        transactions.push({
          id: fitId,
          date: date,
          amount: amount,
          description: memo || name,
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
  ): {
    matchedId?: string;
    matchedTransactionIds?: string[];
    confidence: number;
    status: BankTransaction["status"];
  } {
    // Filter by type (credit/debit must match payable/receivable logic)
    const relevantSystemTxs = systemTransactions.filter((tx) => {
      // Skip already fully reconciled (if we had that flag, for now we assume list passed is candidates)
      if (bankTx.amount < 0 && tx.type === "payable") return true;
      if (bankTx.amount > 0 && tx.type === "receivable") return true;
      return false;
    });

    const bankDate = new Date(bankTx.date);

    // 1. Exact Match (Amount + Date within 1 day)
    const exactMatch = relevantSystemTxs.find((tx) => {
      const txDate = new Date(tx.dueDate);
      const diff = Math.abs(differenceInDays(txDate, bankDate));
      return Math.abs(tx.amount) === Math.abs(bankTx.amount) && diff <= 1;
    });

    if (exactMatch) {
      return {
        matchedId: exactMatch.id,
        confidence: 100,
        status: "matched",
      };
    }

    // 2. Potential Match (Amount + Date within 5 days)
    const amountMatch = relevantSystemTxs.find((tx) => {
      const txDate = new Date(tx.dueDate);
      const diff = Math.abs(differenceInDays(txDate, bankDate));
      return Math.abs(tx.amount) === Math.abs(bankTx.amount) && diff <= 5;
    });

    if (amountMatch) {
      return {
        matchedId: amountMatch.id,
        confidence: 80,
        status: "potential_match",
      };
    }

    // 3. Bundle Match (Multiple transactions summing to bank amount)
    // Only check if no single match found
    const bundleMatch = this.findBundledMatch(bankTx, relevantSystemTxs);
    if (bundleMatch) {
      return {
        matchedTransactionIds: bundleMatch.ids,
        confidence: 90, // High confidence on sum match
        status: "potential_match", // Still potential, requires user confirmation
      };
    }

    return { confidence: 0, status: "unmatched" };
  }

  private static findBundledMatch(
    bankTx: BankTransaction,
    candidates: Transaction[],
  ): { ids: string[] } | null {
    // Logic:
    // 1. Filter candidates close in date (e.g., +/- 3 days)
    // 2. Group by Entity (Payee) if possible
    // 3. For each group (or global if no entity), try to find a subset sum

    const bankDate = new Date(bankTx.date);
    const targetAmount = Math.abs(bankTx.amount);

    const closeCandidates = candidates.filter((tx) => {
      const diff = Math.abs(differenceInDays(new Date(tx.dueDate), bankDate));
      return diff <= 5 && Math.abs(tx.amount) <= targetAmount; // optimization
    });

    // Try to match by Entity first (Heuristic: Bundled payments are usually for the same supplier)
    const byEntity: Record<string, Transaction[]> = {};
    closeCandidates.forEach((tx) => {
      const key = tx.entityId || "unknown";
      if (!byEntity[key]) byEntity[key] = [];
      byEntity[key].push(tx);
    });

    for (const entityId in byEntity) {
      if (entityId === "unknown") continue;

      const group = byEntity[entityId];
      // Try to find sum in this group
      const match = this.subsetSum(group, targetAmount);
      if (match) return { ids: match.map((t) => t.id) };
    }

    // If no entity match, try 'unknown' or global (might be expensive if generic, let's limit to small sets)
    if (closeCandidates.length < 15) {
      const match = this.subsetSum(closeCandidates, targetAmount);
      if (match) return { ids: match.map((t) => t.id) };
    }

    return null;
  }

  // Basic subset sum implementation
  private static subsetSum(
    transactions: Transaction[],
    target: number,
  ): Transaction[] | null {
    // This is 2^N. Keep N small.
    // Epsilon for float comparison
    const EPSILON = 0.001;

    const n = transactions.length;
    // Limit recursion depth/complexity
    const limit = Math.min(n, 12);

    for (let i = 1; i < 1 << limit; i++) {
      let sum = 0;
      const subset: Transaction[] = [];
      for (let j = 0; j < limit; j++) {
        if ((i >> j) & 1) {
          sum += Math.abs(transactions[j].amount);
          subset.push(transactions[j]);
        }
      }
      if (Math.abs(sum - target) < EPSILON) {
        return subset;
      }
    }
    return null;
  }

  static runAutoReconciliation(
    bankTxs: BankTransaction[],
    systemTxs: Transaction[],
  ): BankTransaction[] {
    return bankTxs.map((btx) => {
      const matchResult = this.findMatches(btx, systemTxs);
      return {
        ...btx,
        ...matchResult,
      };
    });
  }
}
