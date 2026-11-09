"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { CornerDownLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EnvelopeLeaf } from "@/lib/analytics";
import {
  analyticsService,
  type AnalyticsParams,
} from "@/lib/services/analyticsService";
import { useCompany } from "@/components/providers/CompanyProvider";

const MAX = 300;

interface Answer {
  id: number;
  question: string;
  sentences: string[];
  dropped: { sentence: string; reason: string }[];
}

/**
 * Pergunta em linguagem natural, respondida no servidor só com os fatos do
 * relatório. Frase com número, data ou nome que não está nele é descartada,
 * e a tela diz quantas e por quê.
 */
export function AskSection({
  params,
  cash,
  envelopes,
}: {
  params: AnalyticsParams;
  cash: number | null;
  envelopes: EnvelopeLeaf[] | null;
}) {
  const companyId = useCompany().selectedCompany?.id;
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);

  const ask = useMutation({
    mutationFn: (q: string) =>
      analyticsService.ai<Omit<Answer, "id" | "question">>(companyId!, params, {
        kind: "question",
        question: q,
        cash,
        envelopes,
      }),
    onSuccess: (res, q) => {
      setAnswers((prev) => [{ id: Date.now(), question: q, ...res }, ...prev]);
      setQuestion("");
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q && !ask.isPending) ask.mutate(q);
  }

  return (
    <section
      id="perguntas"
      aria-labelledby="perguntas-title"
      className="scroll-mt-24"
    >
      <h2 id="perguntas-title" className="text-sm font-semibold">
        Pergunte à análise
      </h2>
      <form onSubmit={submit} className="mt-2 flex max-w-3xl gap-2">
        <label htmlFor="analise-pergunta" className="sr-only">
          Pergunta sobre a análise
        </label>
        <Input
          id="analise-pergunta"
          value={question}
          maxLength={MAX}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ex.: quanto da receita veio da mantenedora?"
          className="h-9 text-sm"
          autoComplete="off"
        />
        <Button
          type="submit"
          size="sm"
          className="h-9 shrink-0"
          disabled={!question.trim() || ask.isPending || !companyId}
        >
          {ask.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CornerDownLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Perguntar
        </Button>
      </form>
      <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
        {ask.isPending
          ? "Consultando o relatório…"
          : ask.isError
            ? (ask.error as Error).message
            : "A IA responde só com os números deste relatório; frase com número, data ou nome que não está nele é descartada."}
      </p>

      {answers.length > 0 && (
        <ol className="mt-3 max-w-3xl divide-y border-t">
          {answers.map((a) => (
            <li key={a.id} className="py-3">
              <p className="text-sm font-medium text-pretty">{a.question}</p>
              {a.sentences.length > 0 ? (
                <p className="mt-1 text-sm text-pretty">
                  {a.sentences.join(" ")}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Nenhuma frase da resposta passou na conferência com o
                  relatório.
                </p>
              )}
              {a.dropped.length > 0 && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {a.dropped.length}{" "}
                    {a.dropped.length === 1
                      ? "frase descartada"
                      : "frases descartadas"}{" "}
                    na conferência
                  </summary>
                  <ul className="mt-1 space-y-1 pl-4">
                    {a.dropped.map((d, i) => (
                      <li key={i} className="list-disc">
                        {d.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
