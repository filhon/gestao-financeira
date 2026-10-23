/**
 * Modelos prontos de plano de contas gerencial.
 *
 * Ponto de partida, não norma: cada organização ajusta ao próprio negócio. O
 * formato é o mesmo da planilha de importação — tipo vazio é inferido (tem
 * filhas → sintética), natureza e grupo da DRE vêm da conta superior quando
 * omitidos. Por isso só as contas que mudam algo declaram natureza ou grupo.
 */
import type { AccountNature, DreGroup } from "@/lib/types";
import type { AccountDraft } from "@/lib/chartOfAccounts";

type Row = [
  code: string,
  name: string,
  nature?: AccountNature,
  group?: DreGroup,
];

const toDrafts = (rows: Row[]): AccountDraft[] =>
  rows.map(([code, name, nature, dreGroup]) => ({
    code,
    name,
    nature,
    dreGroup,
  }));

/** Empresa com fins lucrativos — estrutura da DRE da Lei 6.404/76 em versão gerencial. */
const COMPANY: Row[] = [
  ["1", "Receitas", "revenue"],
  ["1.1", "Receita operacional bruta", undefined, "gross_revenue"],
  ["1.1.01", "Venda de mercadorias e produtos"],
  ["1.1.02", "Prestação de serviços"],
  ["1.2", "Receitas financeiras", undefined, "financial_revenue"],
  ["1.2.01", "Rendimentos de aplicações financeiras"],
  ["1.2.02", "Juros e multas recebidos"],
  ["1.2.03", "Descontos obtidos"],
  ["1.3", "Outras receitas", undefined, "other_revenue"],
  ["1.3.01", "Receitas eventuais"],
  ["1.3.02", "Reembolsos e ressarcimentos recebidos"],
  ["1.4", "Entradas fora do resultado", undefined, "financing"],
  ["1.4.01", "Empréstimos e financiamentos recebidos"],
  ["1.4.02", "Aporte de capital dos sócios"],
  ["1.4.03", "Venda de bens do imobilizado", undefined, "investments"],

  ["2", "Deduções da receita", "expense", "revenue_deductions"],
  ["2.1", "Impostos sobre vendas e serviços"],
  ["2.1.01", "Simples Nacional (DAS)"],
  ["2.1.02", "ISS"],
  ["2.1.03", "ICMS"],
  ["2.1.04", "PIS e COFINS"],
  ["2.2", "Devoluções e abatimentos"],
  ["2.2.01", "Devoluções de vendas"],
  ["2.2.02", "Descontos concedidos"],

  ["3", "Custos", "expense", "direct_costs"],
  ["3.1", "Custo das mercadorias e produtos"],
  ["3.1.01", "Compra de mercadorias para revenda"],
  ["3.1.02", "Matéria-prima e insumos"],
  ["3.1.03", "Fretes sobre compras"],
  ["3.2", "Custo dos serviços prestados"],
  ["3.2.01", "Serviços de terceiros"],
  ["3.2.02", "Mão de obra direta"],

  ["4", "Despesas operacionais", "expense", "operating_expenses"],
  ["4.1", "Pessoal"],
  ["4.1.01", "Salários"],
  ["4.1.02", "Pró-labore"],
  ["4.1.03", "Encargos sociais (INSS e FGTS)"],
  ["4.1.04", "Férias e 13º salário"],
  ["4.1.05", "Benefícios (vale-transporte, alimentação, saúde)"],
  ["4.1.06", "Rescisões e indenizações trabalhistas"],
  ["4.2", "Administrativas"],
  ["4.2.01", "Aluguel e condomínio"],
  ["4.2.02", "Energia elétrica"],
  ["4.2.03", "Água e esgoto"],
  ["4.2.04", "Telefone e internet"],
  ["4.2.05", "Material de escritório e limpeza"],
  ["4.2.06", "Contabilidade e consultorias"],
  ["4.2.07", "Softwares e assinaturas"],
  ["4.2.08", "Manutenção e conservação"],
  ["4.2.09", "Seguros"],
  ["4.3", "Comerciais"],
  ["4.3.01", "Marketing e publicidade"],
  ["4.3.02", "Comissões sobre vendas"],
  ["4.3.03", "Viagens e representação"],
  ["4.4", "Tributárias"],
  ["4.4.01", "Taxas, licenças e alvarás"],
  ["4.4.02", "IPTU e IPVA"],

  ["5", "Despesas financeiras", "expense", "financial_expenses"],
  ["5.01", "Tarifas bancárias"],
  ["5.02", "Juros e multas pagos"],
  ["5.03", "IOF"],
  ["5.04", "Taxas de cartão e meios de pagamento"],

  ["6", "Outras despesas", "expense", "other_expenses"],
  ["6.01", "Perdas e indenizações"],
  ["6.02", "Doações e patrocínios concedidos"],

  ["7", "Tributos sobre o resultado", "expense", "income_taxes"],
  ["7.01", "IRPJ"],
  ["7.02", "CSLL"],

  ["8", "Investimentos", "expense", "investments"],
  ["8.01", "Máquinas e equipamentos"],
  ["8.02", "Móveis e utensílios"],
  ["8.03", "Computadores e periféricos"],
  ["8.04", "Veículos"],
  ["8.05", "Obras e benfeitorias"],

  ["9", "Saídas fora do resultado", "expense", "financing"],
  ["9.01", "Amortização de empréstimos e financiamentos"],
  ["9.02", "Distribuição de lucros"],
  ["9.03", "Retirada de sócios"],
];

/**
 * Entidade sem fins lucrativos (associação, instituição religiosa, ONG).
 *
 * Segue a ITG 2002 (R1): receitas com restrição de uso (convênios,
 * subvenções, doações vinculadas a projeto) ficam segregadas das demais, e
 * as despesas feitas com elas também. Resultado é superávit/déficit; não há
 * tributos sobre o resultado (imunidade/isenção).
 */
const NONPROFIT: Row[] = [
  ["1", "Receitas", "revenue"],
  ["1.1", "Contribuições e doações sem restrição", undefined, "gross_revenue"],
  ["1.1.01", "Contribuições de associados e membros"],
  ["1.1.02", "Dízimos"],
  ["1.1.03", "Ofertas"],
  ["1.1.04", "Doações de pessoas físicas"],
  ["1.1.05", "Doações de pessoas jurídicas"],
  ["1.2", "Recursos com restrição de uso", undefined, "gross_revenue"],
  ["1.2.01", "Subvenções e convênios públicos"],
  ["1.2.02", "Termos de fomento e colaboração (MROSC)"],
  ["1.2.03", "Doações vinculadas a projetos"],
  ["1.2.04", "Campanhas com destinação específica"],
  ["1.3", "Receitas de atividades próprias", undefined, "gross_revenue"],
  ["1.3.01", "Eventos, congressos e retiros"],
  ["1.3.02", "Cursos e inscrições"],
  ["1.3.03", "Bazar, cantina e vendas"],
  ["1.3.04", "Locação de espaços"],
  ["1.4", "Receitas financeiras", undefined, "financial_revenue"],
  ["1.4.01", "Rendimentos de aplicações financeiras"],
  ["1.5", "Outras receitas", undefined, "other_revenue"],
  ["1.5.01", "Reembolsos e ressarcimentos recebidos"],
  ["1.5.02", "Receitas eventuais"],
  ["1.6", "Entradas fora do resultado", undefined, "financing"],
  ["1.6.01", "Empréstimos recebidos"],
  ["1.6.02", "Venda de bens patrimoniais", undefined, "investments"],

  ["2", "Custos das atividades e projetos", "expense", "direct_costs"],
  ["2.1", "Programas sociais e assistenciais"],
  ["2.1.01", "Cestas básicas e assistência social"],
  ["2.1.02", "Projetos sociais"],
  ["2.2", "Atividades-fim"],
  ["2.2.01", "Eventos, congressos e retiros"],
  ["2.2.02", "Missões e apoio missionário"],
  ["2.2.03", "Material didático e de ensino"],
  ["2.3", "Projetos com recursos restritos"],
  ["2.3.01", "Despesas de convênios e subvenções"],
  ["2.3.02", "Despesas de projetos com doações vinculadas"],

  ["3", "Despesas com pessoal", "expense", "operating_expenses"],
  ["3.01", "Salários"],
  ["3.02", "Prebendas e côngruas ministeriais"],
  ["3.03", "Encargos sociais (INSS, FGTS e PIS sobre folha)"],
  ["3.04", "Férias e 13º salário"],
  ["3.05", "Benefícios"],
  ["3.06", "Prestadores de serviço pessoa física (RPA)"],

  ["4", "Despesas administrativas", "expense", "operating_expenses"],
  ["4.01", "Aluguel"],
  ["4.02", "Energia elétrica"],
  ["4.03", "Água e esgoto"],
  ["4.04", "Telefone e internet"],
  ["4.05", "Material de escritório e limpeza"],
  ["4.06", "Contabilidade e assessoria jurídica"],
  ["4.07", "Softwares e sistemas"],
  ["4.08", "Manutenção e conservação predial"],
  ["4.09", "Seguros"],
  ["4.10", "Transporte e combustível"],
  ["4.11", "Viagens e hospedagens"],
  ["4.12", "Taxas, licenças e alvarás"],
  ["4.13", "Contribuições a entidades e convenções"],

  ["5", "Despesas financeiras", "expense", "financial_expenses"],
  ["5.01", "Tarifas bancárias"],
  ["5.02", "Juros e multas pagos"],
  ["5.03", "IOF"],

  ["6", "Outras despesas", "expense", "other_expenses"],
  ["6.01", "Doações concedidas a outras entidades"],
  ["6.02", "Perdas e despesas eventuais"],

  ["7", "Investimentos", "expense", "investments"],
  ["7.01", "Construções e reformas"],
  ["7.02", "Móveis e utensílios"],
  ["7.03", "Equipamentos de som, imagem e informática"],
  ["7.04", "Veículos"],
  ["7.05", "Aquisição de imóveis"],

  ["8", "Saídas fora do resultado", "expense", "financing"],
  ["8.01", "Amortização de empréstimos"],
  ["8.02", "Transferências a entidades vinculadas"],
];

export const CHART_MODELS = {
  company: {
    label: "Empresas",
    description:
      "Comércio, indústria e serviços, com DRE no padrão da Lei 6.404/76.",
    accounts: toDrafts(COMPANY),
  },
  nonprofit: {
    label: "Entidades sem fins lucrativos",
    description:
      "Associações, igrejas e ONGs, com recursos restritos segregados (ITG 2002).",
    accounts: toDrafts(NONPROFIT),
  },
} as const;

export type ChartModelKey = keyof typeof CHART_MODELS;
