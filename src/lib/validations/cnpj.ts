/**
 * CNPJ Validation Utility
 * Implements the official Brazilian CNPJ algorithm (modulo 11 with weights).
 */

/**
 * Strip all non-digit characters from a CNPJ string.
 */
const stripNonDigits = (cnpj: string): string => cnpj.replace(/\D/g, "");

/**
 * Validate a CNPJ string using the official digit-checking algorithm.
 * Accepts both formatted (00.000.000/0000-00) and raw (14 digits) formats.
 *
 * @param cnpj - The CNPJ string to validate
 * @returns true if the CNPJ is valid
 */
export function validateCnpj(cnpj: string): boolean {
  const digits = stripNonDigits(cnpj);

  // Must be exactly 14 digits
  if (digits.length !== 14) return false;

  // Reject known invalid patterns (all same digits)
  if (/^(\d)\1{13}$/.test(digits)) return false;

  // Calculate first check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i]) * weights1[i];
  }
  let remainder = sum % 11;
  const checkDigit1 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(digits[12]) !== checkDigit1) return false;

  // Calculate second check digit
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(digits[i]) * weights2[i];
  }
  remainder = sum % 11;
  const checkDigit2 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(digits[13]) !== checkDigit2) return false;

  return true;
}

/**
 * Format a raw digit string into CNPJ display format (XX.XXX.XXX/XXXX-XX).
 * Supports partial input for use during typing.
 *
 * @param value - The raw or partially formatted CNPJ string
 * @returns The formatted CNPJ string
 */
export function formatCnpj(value: string): string {
  const digits = stripNonDigits(value);

  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}
