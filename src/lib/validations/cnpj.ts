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

/** CPF pelo algoritmo oficial (dois dígitos verificadores, módulo 11). */
export function validateCpf(cpf: string): boolean {
  const d = stripNonDigits(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === parseInt(d[9]) && check(10) === parseInt(d[10]);
}

/** Máscara enquanto digita: até 11 dígitos é CPF, depois vira CNPJ. */
export function maskCpfCnpj(value: string): string {
  const d = stripNonDigits(value).slice(0, 14);
  if (d.length > 11) return formatCnpj(d);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

/** CPF (11 dígitos) ou CNPJ (14) com máscara; outro tamanho volta como veio. */
export function formatCpfCnpj(value: string): string {
  const d = stripNonDigits(value);
  if (d.length === 11)
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d.length === 14 ? formatCnpj(d) : value;
}

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
