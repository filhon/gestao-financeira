import currency from "currency.js";
import { cn, formatCurrency } from "@/lib/utils";

/** Situação do envelope de um centro num exercício, como o aprovador lê. */
export interface EnvelopeSnapshot {
  year: number;
  envelope: number;
  available: number;
}

/**
 * Despesa reserva envelope desde o rascunho: as transações do lote já estão
 * descontadas. O aprovador vê o que sobra, não um consumo futuro.
 */
export const envelopeSnapshot = (
  b: { received: number; carryIn: number; available: number },
  year: number,
): EnvelopeSnapshot => ({
  year,
  envelope: currency(b.received).add(b.carryIn).value,
  available: b.available,
});

/** A partir daqui o envelope está quase no fim e o aprovador precisa notar. */
const TIGHT_PERCENT = 90;

export function EnvelopeLine({
  snapshot,
  batchAmount,
  className,
}: {
  snapshot: EnvelopeSnapshot;
  /** Quanto deste lote cai no envelope; mostra o consumo antes do saldo. */
  batchAmount?: number;
  className?: string;
}) {
  const { year, envelope, available } = snapshot;
  const over = available < 0;
  const used =
    envelope > 0
      ? Math.round(
          (currency(envelope).subtract(available).value / envelope) * 100,
        )
      : null;
  const tight = !over && used !== null && used >= TIGHT_PERCENT;

  // Cada trecho quebra inteiro: no celular "91% / comprometido" ficava partido
  const parts = over
    ? [
        `Envelope ${year} estourado em ${formatCurrency(-available)}`,
        `de ${formatCurrency(envelope)}`,
      ]
    : [
        `Envelope ${year}:`,
        batchAmount !== undefined &&
          `este lote ${formatCurrency(batchAmount)} ·`,
        `sobram ${formatCurrency(available)} de ${formatCurrency(envelope)}`,
        used !== null && `(${used}% usado)`,
      ];

  return (
    <span
      className={cn(
        "inline-flex flex-wrap gap-x-1 tabular-nums",
        over
          ? "text-destructive"
          : tight
            ? "text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        className,
      )}
    >
      {parts.filter(Boolean).map((p, i) => (
        <span key={i} className="whitespace-nowrap">
          {p}
        </span>
      ))}
    </span>
  );
}
