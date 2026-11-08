"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadActivity } from "@/lib/loadActivity";

/**
 * Barra de carga da tela: consultas concluídas sobre consultas iniciadas desde
 * a última vez que tudo parou. É contagem real, sem relógio; como as consultas
 * não têm o mesmo peso, a barra anda aos saltos. Só aparece depois de 300 ms.
 */
export function QueryActivityBar() {
  const cache = useQueryClient().getQueryCache();
  const [progress, setProgress] = useState<number | null>(null);
  const started = useRef(new Set<string>());

  useEffect(() => {
    // O cache avisa de forma síncrona quando um useQuery monta, ainda durante
    // a renderização de outro componente; setState ali é proibido. Adiar para
    // um microtask também junta a rajada de avisos numa só atualização.
    let pending = false;
    let alive = true;
    const schedule = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (alive) update();
      });
    };
    const update = () => {
      const fetching = cache.findAll({ fetchStatus: "fetching" });
      const other = loadActivity.snapshot();
      if (fetching.length === 0 && other.active === 0) {
        started.current.clear();
        loadActivity.reset();
        setProgress(null);
        return;
      }
      fetching.forEach((q) => started.current.add(q.queryHash));
      const total = started.current.size + other.started;
      setProgress((total - fetching.length - other.active) / total);
    };
    const stopCache = cache.subscribe(schedule);
    const stopOther = loadActivity.subscribe(schedule);
    return () => {
      alive = false;
      stopCache();
      stopOther();
    };
  }, [cache]);

  if (progress === null) return null;
  const percent = Math.round(progress * 100);

  return (
    <div
      role="progressbar"
      aria-label="Carregando os dados da tela"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="fixed inset-x-0 top-0 z-70 h-0.5 bg-primary/20 animate-in fade-in duration-150"
      style={{ animationDelay: "300ms", animationFillMode: "both" }}
    >
      {/* Nada concluído ainda: 0 de verdade não diria que há atividade. */}
      <div
        className={
          percent === 0
            ? "h-full w-1/4 animate-pulse bg-primary"
            : "h-full bg-primary transition-[width] duration-200"
        }
        style={percent === 0 ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
