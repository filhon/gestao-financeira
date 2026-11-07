"use client";

import { useEffect, useState } from "react";

/**
 * Tempo corrido de uma chamada que não informa andamento: mostra que segue viva
 * sem inventar porcentagem. Monte só enquanto ela roda; aparece a partir de 3 s.
 */
export function ElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  if (seconds < 3) return null;
  return <span className="tabular-nums opacity-70">· {seconds} s</span>;
}
