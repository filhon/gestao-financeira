import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
    value: number | undefined;
    onChange: (value: number) => void;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
    ({ value, onChange, className, ...props }, ref) => {
        const [displayValue, setDisplayValue] = useState("");

        // Format value on initial load or external change
        useEffect(() => {
            if (value !== undefined) {
                const formatted = new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    minimumFractionDigits: 2,
                }).format(value);
                // eslint-disable-next-line
                setDisplayValue(formatted);
            } else {
                setDisplayValue("");
            }
        }, [value]);

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const inputValue = e.target.value;

            // Remove non-numeric characters
            const numericValue = inputValue.replace(/\D/g, "");

            // Convert to number (divide by 100 for cents)
            const numberValue = Number(numericValue) / 100;

            // Update parent with the actual number
            onChange(numberValue);

            // Update display value immediately for smooth typing
            // We use the same formatting logic but applied to the new numeric value
            const formatted = new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
                minimumFractionDigits: 2,
            }).format(numberValue);

            setDisplayValue(formatted);
        };

        return (
            <Input
                {...props}
                ref={ref}
                value={displayValue}
                onChange={handleChange}
                className={className}
                placeholder="R$ 0,00"
            />
        );
    }
);

CurrencyInput.displayName = "CurrencyInput";
