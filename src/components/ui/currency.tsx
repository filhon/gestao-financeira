import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

interface CurrencyProps {
  value: number;
  className?: string;
}

export function Currency({ value, className }: CurrencyProps) {
  return (
    <span className={cn("font-financial", className)}>
      {formatCurrency(value)}
    </span>
  );
}
