// Tipos e regras do roadmap compartilhados entre tela e rotas do servidor
// (sem SDK do Firebase, para poder ser importado dos dois lados).

export type RoadmapStatus =
  | "suggestion"
  | "planned"
  | "in_progress"
  | "done"
  | "declined";

export const ROADMAP_STATUSES: RoadmapStatus[] = [
  "suggestion",
  "planned",
  "in_progress",
  "done",
  "declined",
];

export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, string> = {
  suggestion: "Em votação",
  planned: "Planejado",
  in_progress: "Em execução",
  done: "Entregue",
  declined: "Encerrada",
};

// A partir de "Em execução" o item vale para todos os clientes; antes disso,
// só a empresa que sugeriu (e o admin) enxerga. As rules seguem a mesma lista.
export const PUBLIC_STATUSES: RoadmapStatus[] = ["in_progress", "done"];
export const VOTABLE_STATUSES: RoadmapStatus[] = [
  "suggestion",
  "planned",
  "in_progress",
];

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  // Empresa de quem sugeriu; ausente nos itens antigos criados pela equipe
  companyId?: string;
  userId: string;
  authorName?: string;
  // "<companyId>:<uid>": um voto por pessoa e por empresa, contável por empresa
  voters: string[];
  // Resposta pública da equipe, mostrada no item e enviada na notificação
  response?: string;
  mergedInto?: string;
  createdAt?: Date;
  updatedAt?: Date;
  doneAt?: Date;
}

export const voterKey = (companyId: string, uid: string) =>
  `${companyId}:${uid}`;

export const votingCompanies = (item: RoadmapItem) =>
  new Set(item.voters.map((v) => v.split(":")[0])).size;
