import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DemoSection } from "@/components/features/landing/DemoSection";
import "./landing.css";

// Dados fictícios. Datas e valores no formato brasileiro.
// Fila do pagador: libera pagamentos aprovados e dá baixa.
const queue = [
  {
    entity: "Papelaria Central Ltda",
    desc: "NF-e 004381 · Material de escritório",
    due: "05/11/2026",
    amount: "R$ 2.480,00",
    status: "pending_authorization",
    label: "Pend. autorização",
  },
  {
    entity: "Folha de pagamento 11/2026",
    desc: "Comercial",
    due: "05/11/2026",
    amount: "R$ 128.400,00",
    status: "pending_authorization",
    label: "Pend. autorização",
  },
  {
    entity: "Locação do escritório",
    desc: "Administrativo",
    due: "10/11/2026",
    amount: "R$ 8.200,00",
    status: "authorized",
    label: "Autorizado",
  },
  {
    entity: "Energia elétrica",
    desc: "Administrativo",
    due: "12/11/2026",
    amount: "R$ 1.936,52",
    status: "authorized",
    label: "Autorizado",
  },
] as const;

const steps = [
  { s: "draft", label: "Rascunho", who: "Qualquer usuário lança a conta." },
  {
    s: "pending_approval",
    label: "Pendente de aprovação",
    who: "A conta entra na fila do aprovador.",
  },
  {
    s: "approved",
    label: "Aprovado",
    who: "O aprovador confirmou valor e documento.",
  },
  {
    s: "pending_authorization",
    label: "Pendente de autorização",
    who: "O gerente financeiro envia ao pagador.",
  },
  {
    s: "authorized",
    label: "Autorizado",
    who: "O pagador libera a saída do caixa.",
  },
  {
    s: "paid",
    label: "Pago",
    who: "A baixa vem com o comprovante ou pelo extrato.",
  },
] as const;

// Cada prova mostra um registro concreto. Só datas e valores usam fonte mono.
const proofs = [
  {
    title: "Troca de conta bancária passa por aprovação",
    text: "Alterar os dados bancários de um fornecedor só vale depois de aprovado.",
    tag: "Aguarda aprovação",
    meta: "Fornecedor Alpha · alterado por Carlos M.",
    lines: ["Depende de aprovação de Ana Silva"],
  },
  {
    title: "Cada alteração fica no registro",
    text: "O registro guarda quem mudou, quando mudou e o valor antes e depois.",
    tag: "Alterado",
    meta: "02/11/2026 14:32 · Ana Silva",
    lines: ["Valor: R$ 8.200,00 → R$ 8.020,00"],
  },
  {
    title: "Baixa pelo extrato bancário",
    text: "Importe o extrato OFX, confira lançamento por lançamento e dê baixa nos pagamentos a partir dele. Cada conta tem seu saldo e seu fechamento.",
    tag: "Conciliado",
    meta: "29/10/2026 · extrato OFX",
    lines: ["PIX RECEBIDO VENDA 4821 · +R$ 3.200,00", "Venda #4821"],
  },
  {
    title: "Reembolso por foto da nota",
    text: "O funcionário envia a foto do comprovante por um link. A IA lê os dados e o item cai na caixa de entrada do financeiro.",
    tag: "Leitura da IA",
    meta: "NF-e 004381 · 04/11/2026",
    lines: ["Papelaria Central · R$ 2.480,00", "Conferir antes de lançar"],
  },
  {
    title: "DRE por caixa e por competência",
    text: "O mesmo período em duas visões, com detalhamento até os lançamentos.",
    tag: "Outubro/2026",
    meta: "Receitas",
    lines: ["Caixa: R$ 41.200,00", "Competência: R$ 38.750,00"],
  },
  {
    title: "Dados separados por empresa",
    text: "Cada empresa enxerga só os próprios dados, e cada usuário só o que o papel dele permite.",
    tag: "6 papéis",
    meta: "Acesso",
    lines: [
      "Administrador, gerente financeiro, aprovador, pagador, auditor e usuário",
    ],
  },
  {
    title: "Relatórios exportáveis",
    text: "Relatórios saem em PDF, Excel e CSV. Como os dados são tratados está na Política de privacidade.",
    tag: "Exportação",
    meta: "Formatos",
    lines: ["PDF · Excel · CSV"],
  },
  {
    title: "API para integrar outros sistemas",
    text: "Cada chamada à API REST é assinada, então o sistema confere quem enviou e se o conteúdo foi alterado no caminho.",
    tag: "Chamada assinada",
    meta: "HMAC-SHA256",
    lines: ["Limite de chamadas por chave"],
  },
] as const;

export default function LandingPage() {
  return (
    <div className="fin-root">
      <header className="fin-header">
        <div className="fin-wrap fin-header-row">
          <Link href="/" className="fin-logo" aria-label="FinControl, início">
            <span className="fin-logo-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 12L6 8L10 10L14 4M12 4H14V6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            FinControl
          </Link>
          <nav className="fin-nav" aria-label="Principal">
            <a href="#como-funciona" className="fin-navlink fin-hide-sm">
              Como funciona
            </a>
            <a href="#demonstracao" className="fin-navlink fin-hide-sm">
              Demonstração
            </a>
            <a href="#recursos" className="fin-navlink fin-hide-sm">
              Recursos
            </a>
            <Link href="/login" className="fin-btn fin-btn-ghost">
              Entrar
            </Link>
            <Link
              href="/login?tab=register"
              className="fin-btn fin-btn-primary"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section aria-labelledby="hero-title">
          <div className="fin-wrap fin-hero-grid">
            <div className="fin-rise">
              <h1 id="hero-title" className="fin-h1">
                O dia do financeiro, numa fila só.
              </h1>
              <p className="fin-lead">
                Contas a pagar e a receber com aprovação em etapas, baixa pelo
                extrato bancário e registro de cada alteração. Feito para
                empresas brasileiras.
              </p>
              <div className="fin-actions">
                <Link
                  href="/login?tab=register"
                  className="fin-btn fin-btn-primary"
                >
                  Criar conta <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a href="#demonstracao" className="fin-btn fin-btn-ghost">
                  Ver demonstração
                </a>
              </div>
            </div>

            <div className="fin-panel fin-rise fin-rise-2">
              <div className="fin-panel-head">
                <strong>Minha fila · Pagador</strong>
                <span className="fin-small">Dados fictícios</span>
              </div>
              <table className="fin-table">
                <caption className="fin-sr">
                  Contas aguardando ação, com vencimento, valor e situação
                </caption>
                <thead>
                  <tr>
                    <th>Favorecido</th>
                    <th className="fin-hide-sm">Vencimento</th>
                    <th className="r">Valor</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((q) => (
                    <tr key={q.entity}>
                      <td>
                        {q.entity}
                        <span className="fin-cell-sub">{q.desc}</span>
                      </td>
                      <td className="fin-hide-sm fin-num">{q.due}</td>
                      <td className="r fin-num">{q.amount}</td>
                      <td>
                        <span className="fin-pill" data-s={q.status}>
                          {q.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="fin-panel-foot">
                <span>4 contas na fila</span>
                <span className="fin-num">R$ 141.016,52</span>
              </div>
            </div>
          </div>
        </section>

        <section
          id="como-funciona"
          className="fin-band fin-section"
          aria-labelledby="steps-title"
        >
          <div className="fin-wrap">
            <h2 id="steps-title" className="fin-h2">
              Da conta lançada ao pagamento
            </h2>
            <ol className="fin-steps">
              {steps.map((st) => (
                <li key={st.s}>
                  <span className="fin-pill" data-s={st.s}>
                    {st.label}
                  </span>
                  <p>{st.who}</p>
                </li>
              ))}
            </ol>
            <p className="fin-muted" style={{ marginTop: 28 }}>
              O aprovador e o pagador podem rejeitar a conta, e o motivo fica
              registrado.
            </p>
          </div>
        </section>

        <DemoSection />

        <section
          id="recursos"
          className="fin-band fin-section"
          aria-labelledby="proof-title"
        >
          <div className="fin-wrap fin-proof">
            <div>
              <h2 id="proof-title" className="fin-h2">
                O que o sistema confere e registra
              </h2>
            </div>
            <ul className="fin-proof-list">
              {proofs.map((p) => (
                <li key={p.title}>
                  <div>
                    <h3>{p.title}</h3>
                    <p>{p.text}</p>
                  </div>
                  <div className="fin-stamp">
                    <span className="fin-stamp-tag">{p.tag}</span>
                    <span className="fin-num">{p.meta}</span>
                    {p.lines.map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="fin-cta fin-section" aria-labelledby="cta-title">
          <div className="fin-wrap fin-cta-row">
            <div>
              <h2
                id="cta-title"
                className="fin-h2"
                style={{ maxWidth: "22ch" }}
              >
                Cadastre a empresa e lance o primeiro pagamento.
              </h2>
              <p className="fin-lead" style={{ marginTop: 16 }}>
                O cadastro é gratuito e leva poucos minutos.
              </p>
            </div>
            <Link href="/login?tab=register" className="fin-btn">
              Criar conta <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="fin-footer">
        <div className="fin-wrap fin-footer-row">
          <span>&copy; {new Date().getFullYear()} FinControl</span>
          <nav aria-label="Rodapé">
            <Link href="/login">Entrar</Link>
            <Link href="/termos-uso">Termos de uso</Link>
            <Link href="/politica-privacidade">Política de privacidade</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
