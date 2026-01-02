import * as XLSX from "xlsx";
import {
  ImportedRow,
  ImportResult,
  ValidationError,
  ValidationWarning,
  COLUMN_MAP,
  PAYMENT_METHOD_MAP,
} from "@/lib/types/importTypes";
import { CostCenter, PaymentMethod } from "@/lib/types";
import { transactionService } from "./transactionService";
import { TransactionFormData } from "@/lib/validations/transaction";
import { parse, isValid, format } from "date-fns";
import { ptBR } from "date-fns/locale";

// Helper to generate unique IDs
const generateId = () => crypto.randomUUID();

// Parse various date formats
const parseDate = (value: string | number | Date): Date | null => {
  if (!value) return null;

  // If it's a Date object already
  if (value instanceof Date) return isValid(value) ? value : null;

  // If it's a number (Excel serial date)
  if (typeof value === "number") {
    // Excel serial date (days since 1900-01-01)
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(
      excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000
    );
    return isValid(date) ? date : null;
  }

  // Try common date formats
  const formats = [
    "dd/MM/yyyy",
    "dd-MM-yyyy",
    "yyyy-MM-dd",
    "dd/MM/yy",
    "d/M/yyyy",
    "d/M/yy",
  ];

  for (const fmt of formats) {
    const parsed = parse(value.toString(), fmt, new Date(), { locale: ptBR });
    if (isValid(parsed)) return parsed;
  }

  // Try native Date parsing as last resort
  const native = new Date(value);
  return isValid(native) ? native : null;
};

// Parse currency values
const parseAmount = (value: string | number): number | null => {
  if (typeof value === "number") return value > 0 ? value : null;
  if (!value) return null;

  // Remove currency symbols and spaces
  let cleaned = value
    .toString()
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "")
    .trim();

  // Handle Brazilian format: 1.234,56
  if (cleaned.includes(",") && cleaned.includes(".")) {
    // Check if comma is decimal separator (BR format)
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Brazilian format: remove dots, replace comma with dot
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    }
  } else if (cleaned.includes(",")) {
    // Only comma - treat as decimal separator
    cleaned = cleaned.replace(",", ".");
  }

  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : null;
};

export const importService = {
  /**
   * Parse a file (CSV or XLSX) and return raw imported rows
   */
  parseFile: async (file: File): Promise<ImportedRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: "array", cellDates: true });

          // Get first sheet
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];

          // Convert to JSON with header row
          const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(
            sheet,
            {
              defval: "",
              raw: false,
            }
          );

          if (jsonData.length === 0) {
            reject(new Error("Arquivo vazio ou sem dados válidos"));
            return;
          }

          // Map columns to our format
          const rows: ImportedRow[] = jsonData.map((row, index) => {
            const mappedRow: ImportedRow = {
              rowNumber: index + 2, // +2 because Excel is 1-indexed and has header
              id: generateId(),
              description: "",
              amount: "",
              dueDate: "",
              supplierOrClient: "",
              errors: [],
              warnings: [],
              isValid: false,
            };

            // Map each column based on header
            for (const [header, value] of Object.entries(row)) {
              const normalizedHeader = header.toLowerCase().trim();
              const field = COLUMN_MAP[normalizedHeader];

              if (field && value !== undefined && value !== null) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (mappedRow as any)[field] = value;
              }
            }

            return mappedRow;
          });

          resolve(rows);
        } catch {
          reject(
            new Error(
              "Erro ao processar arquivo. Verifique se o formato está correto."
            )
          );
        }
      };

      reader.onerror = () => {
        reject(new Error("Erro ao ler o arquivo"));
      };

      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * Validate a single row and return it with errors/warnings populated
   */
  validateRow: (row: ImportedRow, costCenters: CostCenter[]): ImportedRow => {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let costCenterId = row.costCenterId;

    // Validate description
    if (!row.description || row.description.toString().trim().length < 3) {
      errors.push({
        field: "description",
        message: "Descrição deve ter pelo menos 3 caracteres",
      });
    }

    // Validate amount
    const amount = parseAmount(row.amount);
    if (amount === null) {
      errors.push({
        field: "amount",
        message: "Valor inválido ou menor que zero",
      });
    }

    // Validate due date
    const dueDate = parseDate(row.dueDate);
    if (!dueDate) {
      errors.push({ field: "dueDate", message: "Data de vencimento inválida" });
    }

    // Validate supplier/client
    if (
      !row.supplierOrClient ||
      row.supplierOrClient.toString().trim().length < 2
    ) {
      errors.push({
        field: "supplierOrClient",
        message: "Fornecedor/Cliente é obrigatório",
      });
    }

    // Validate/resolve cost center
    if (row.costCenterCode && !costCenterId) {
      const code = row.costCenterCode.toString().trim().toUpperCase();
      const found = costCenters.find(
        (cc) => cc.code.toUpperCase() === code || cc.name.toUpperCase() === code
      );
      if (found) {
        costCenterId = found.id;
      } else {
        warnings.push({
          field: "costCenterCode",
          message: `Centro de custo "${row.costCenterCode}" não encontrado`,
        });
      }
    }

    // Check if cost center is missing (warning, not error - can be bulk assigned)
    if (!costCenterId && !row.costCenterCode) {
      warnings.push({
        field: "costCenterCode",
        message: "Centro de custo não informado",
      });
    }

    // Validate payment method if provided
    let paymentMethod: string | undefined = undefined;
    if (row.paymentMethod) {
      const normalized = row.paymentMethod.toString().toLowerCase().trim();
      paymentMethod = PAYMENT_METHOD_MAP[normalized];
      if (!paymentMethod) {
        warnings.push({
          field: "paymentMethod",
          message: `Forma de pagamento "${row.paymentMethod}" não reconhecida`,
        });
      }
    }

    return {
      ...row,
      costCenterId,
      paymentMethod: paymentMethod || row.paymentMethod,
      errors,
      warnings,
      isValid: errors.length === 0,
    };
  },

  /**
   * Validate all rows
   */
  validateRows: (
    rows: ImportedRow[],
    costCenters: CostCenter[]
  ): ImportedRow[] => {
    return rows.map((row) => importService.validateRow(row, costCenters));
  },

  /**
   * Apply default cost center to rows without one
   */
  applyDefaultCostCenter: (
    rows: ImportedRow[],
    defaultCostCenterId: string
  ): ImportedRow[] => {
    return rows.map((row) => {
      if (!row.costCenterId) {
        const updatedRow = {
          ...row,
          costCenterId: defaultCostCenterId,
          // Remove the warning about missing cost center
          warnings: row.warnings.filter(
            (w) =>
              w.field !== "costCenterCode" ||
              w.message !== "Centro de custo não informado"
          ),
        };
        return updatedRow;
      }
      return row;
    });
  },

  /**
   * Apply cost center to selected rows
   */
  applyCostCenterToSelected: (
    rows: ImportedRow[],
    selectedIds: Set<string>,
    costCenterId: string
  ): ImportedRow[] => {
    return rows.map((row) => {
      if (selectedIds.has(row.id)) {
        const updatedRow = {
          ...row,
          costCenterId,
          // Remove the warning about missing cost center
          warnings: row.warnings.filter(
            (w) =>
              w.field !== "costCenterCode" ||
              w.message !== "Centro de custo não informado"
          ),
        };
        return updatedRow;
      }
      return row;
    });
  },

  /**
   * Create transactions in batch
   */
  createTransactions: async (
    rows: ImportedRow[],
    type: "payable" | "receivable",
    user: { uid: string; email: string },
    companyId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<ImportResult> => {
    const validRows = rows.filter((r) => r.isValid && r.costCenterId);
    const result: ImportResult = {
      success: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];

      try {
        const amount = parseAmount(row.amount);
        const dueDate = parseDate(row.dueDate);

        if (!amount || !dueDate || !row.costCenterId) {
          throw new Error("Dados inválidos");
        }

        const data: TransactionFormData = {
          type,
          description: row.description.toString().trim(),
          amount,
          dueDate,
          supplierOrClient: row.supplierOrClient.toString().trim(),
          status: "draft",
          requestOrigin: {
            type: "department",
            name: "Importação em Massa",
          },
          costCenterAllocation: [
            {
              costCenterId: row.costCenterId,
              percentage: 100,
              amount,
            },
          ],
          paymentMethod: row.paymentMethod as PaymentMethod | undefined,
          notes: row.notes?.toString(),
        };

        await transactionService.create(data, user, companyId);
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: row.rowNumber,
          message: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }

      onProgress?.(i + 1, validRows.length);
    }

    return result;
  },

  /**
   * Generate and download a template spreadsheet
   */
  generateTemplate: (type: "payable" | "receivable") => {
    const headers = [
      "Descrição",
      "Valor",
      "Vencimento",
      type === "payable" ? "Fornecedor" : "Cliente",
      "Centro de Custo",
      "Forma de Pagamento",
      "Observações",
    ];

    const exampleData = [
      [
        "Pagamento de aluguel",
        "1500,00",
        format(new Date(), "dd/MM/yyyy"),
        type === "payable" ? "Imobiliária XYZ" : "Cliente ABC",
        "ADM",
        "PIX",
        "Referente ao mês de dezembro",
      ],
      [
        "Conta de energia",
        "450,50",
        format(new Date(), "dd/MM/yyyy"),
        type === "payable" ? "CEMIG" : "Cliente 123",
        "OPE",
        "Boleto",
        "",
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);

    // Set column widths
    ws["!cols"] = [
      { wch: 30 }, // Descrição
      { wch: 12 }, // Valor
      { wch: 12 }, // Vencimento
      { wch: 25 }, // Fornecedor/Cliente
      { wch: 15 }, // Centro de Custo
      { wch: 18 }, // Forma de Pagamento
      { wch: 35 }, // Observações
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo");

    const filename =
      type === "payable"
        ? "modelo_contas_a_pagar.xlsx"
        : "modelo_contas_a_receber.xlsx";

    XLSX.writeFile(wb, filename);
  },
};
