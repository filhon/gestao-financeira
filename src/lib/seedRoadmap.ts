import { roadmapService } from "@/lib/services/roadmapService";
import { toast } from "sonner";

const INITIAL_DATA = [
  // DONE
  {
    title: "Dashboard Financeiro",
    description: "Visualização completa dos indicadores financeiros, gráficos de receitas vs despesas e saldos.",
    status: "done",
  },
  {
    title: "Gestão de Contas a Pagar e Receber",
    description: "Controle total de fluxo de caixa, com status de pagamentos e recebimentos.",
    status: "done",
  },
  {
    title: "Recorrências e Automação",
    description: "Criação de templates para despesas e receitas recorrentes (mensais, semanais, etc).",
    status: "done",
  },
  {
    title: "Gestão de Usuários e Permissões",
    description: "Controle granular de acesso com funções (Admin, Gerente, Aprovador).",
    status: "done",
  },
  {
    title: "Multi-empresas",
    description: "Suporte para gerenciamento de múltiplas empresas e filiais na mesma conta.",
    status: "done",
  },
  {
    title: "Auditoria e Logs",
    description: "Rastreamento de ações críticas no sistema para segurança e compliance.",
    status: "done",
  },

  // IN PROGRESS
  {
    title: "Roadmap Público",
    description: "Página para transparência do desenvolvimento e coleta de sugestões dos usuários.",
    status: "in_progress",
  },
  {
    title: "Otimização de Performance",
    description: "Melhorias no carregamento de dados e renderização para maior fluidez.",
    status: "in_progress",
  },

  // PLANNED
  {
    title: "Relatórios Avançados",
    description: "Geração de relatórios personalizados em PDF e Excel.",
    status: "planned",
  },
  {
    title: "Integração Bancária",
    description: "Conciliação bancária automática via Open Finance.",
    status: "planned",
  },
  {
    title: "App Mobile (PWA)",
    description: "Versão otimizada para dispositivos móveis instalável.",
    status: "planned",
  },

  // SUGGESTIONS
  {
    title: "Notificações via WhatsApp",
    description: "Receber alertas de vencimento diretamente no WhatsApp.",
    status: "suggestion",
  },
];

export async function seedRoadmapData(userId: string) {
  try {
    const promises = INITIAL_DATA.map(item => 
      roadmapService.addItem({
        ...item,
        status: item.status as any,
        userId: userId,
        userEmail: "sistema@fincontrol.com",
      })
    );

    await Promise.all(promises);
    toast.success("Roadmap populado com sucesso!");
    return true;
  } catch (error) {
    console.error("Erro ao popular roadmap:", error);
    toast.error("Erro ao popular roadmap.");
    return false;
  }
}
