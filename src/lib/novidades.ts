import { parse } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface NovidadeSection {
  title: string;
  // Primeiro parágrafo da seção: o que aparece sem expandir
  summary: string;
  // Restante, em markdown; vazio quando a seção só tem o resumo
  details: string;
}

export interface NovidadeRelease {
  title: string;
  // ISO; null quando o título não segue "Atualização de d de mês de aaaa"
  date: string | null;
  sections: NovidadeSection[];
}

// Convenção do docs/NOVIDADES.md: "## Atualização de <data>" abre uma publicação;
// cada "### título" é uma novidade cujo primeiro parágrafo é o resumo.
export function parseNovidades(raw: string): NovidadeRelease[] {
  return raw
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [heading, ...body] = block.split("\n");
      const title = heading.trim();
      const parsed = parse(
        title.replace(/^Atualização de /i, ""),
        "d 'de' MMMM 'de' yyyy",
        new Date(),
        { locale: ptBR },
      );
      const sections = body
        .join("\n")
        .split(/^### /m)
        .slice(1)
        .map((s) => {
          const [h, ...rest] = s.split("\n");
          const [summary, ...details] = rest
            .join("\n")
            .trim()
            .split(/\n\s*\n/);
          return {
            title: h.trim(),
            summary: summary ?? "",
            details: details.join("\n\n"),
          };
        });
      return {
        title,
        date: isNaN(parsed.getTime()) ? null : parsed.toISOString(),
        sections,
      };
    });
}
