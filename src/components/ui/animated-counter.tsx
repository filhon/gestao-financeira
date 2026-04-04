"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
    value: number;
    formatter: (value: number) => string;
    duration?: number;
    className?: string;
}

/**
 * Smoothly animates a numeric value using requestAnimationFrame.
 * Uses an ease-out curve for a premium feel.
 */
export function AnimatedCounter({
    value,
    formatter,
    duration = 600,
    className,
}: AnimatedCounterProps) {
    const [displayed, setDisplayed] = useState(value);
    const prevValue = useRef(value);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const from = prevValue.current;
        const to = value;
        prevValue.current = to;

        if (from === to) return;

        const startTime = performance.now();

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease-out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - progress, 3);

            setDisplayed(from + (to - from) * eased);

            if (progress < 1) {
                rafRef.current = requestAnimationFrame(animate);
            } else {
                setDisplayed(to);
            }
        };

        rafRef.current = requestAnimationFrame(animate);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [value, duration]);

    return <span className={`font-financial${className ? ` ${className}` : ""}`}>{formatter(displayed)}</span>;
}
