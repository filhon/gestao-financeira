import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatCurrencyAbbr(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}R$\u00A0${(abs / 1_000_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}R$\u00A0${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1_000) {
    return `${sign}R$\u00A0${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  }
  return formatCurrency(value);
}
