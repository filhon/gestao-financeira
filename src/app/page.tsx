"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Layers,
  Zap,
  Sun,
  Moon,
} from "lucide-react";

const DemoSection = dynamic(
  () =>
    import("@/components/features/landing/DemoSection").then((m) => ({
      default: m.DemoSection,
    })),
  { ssr: false, loading: () => <div style={{ height: 480 }} /> },
);

// ─── CSS-in-JSX ──────────────────────────────────────────────────────────────
const styles = `
  :root {
    scroll-behavior: smooth;
    --fin-bg:        #080D09;
    --fin-surface:   #0E1511;
    --fin-surface-2: #141E16;
    --fin-border:    rgba(255,255,255,0.055);
    --fin-border-2:  rgba(255,255,255,0.10);
    --fin-gold:      #C9922A;
    --fin-gold-lt:   #E8B84A;
    --fin-gold-glow: rgba(201,146,42,0.10);
    --fin-blue:      #4F86F7;
    --fin-text:      #EDF3EE;
    --fin-muted:     #7A9080;
    --fin-success:   #10B981;
  }

  /* FOUC prevention: applied before React hydrates if localStorage had light theme */
  :root.fin-theme-light-pending .fin-root {
    --fin-bg:        #F3F7F3;
    --fin-surface:   #FFFFFF;
    --fin-surface-2: #E8EDE8;
    --fin-border:    rgba(0,0,0,0.065);
    --fin-border-2:  rgba(0,0,0,0.12);
    --fin-gold:      #C9922A;
    --fin-gold-lt:   #9C7118;
    --fin-gold-glow: rgba(201,146,42,0.09);
    --fin-blue:      #3A6EE0;
    --fin-text:      #0D1510;
    --fin-muted:     #637560;
    --fin-success:   #059669;
    background: var(--fin-bg);
    color: var(--fin-text);
  }
  :root.fin-theme-light-pending .fin-header {
    background: rgba(243,247,243,0.90);
    border-bottom-color: rgba(0,0,0,0.09);
  }

  .fin-root {
    background: var(--fin-bg);
    color: var(--fin-text);
    font-family: var(--font-dm-sans), 'DM Sans', system-ui, sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── Grid background ─────────────────────────────────────── */
  .fin-grid {
    background-image:
      linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
    background-size: 64px 64px;
  }

  /* ── Typography ──────────────────────────────────────────── */
  .fin-serif {
    font-family: var(--font-cormorant), 'Cormorant Garamond', Georgia, serif;
  }

  /* ── Header ──────────────────────────────────────────────── */
  .fin-header {
    position: sticky; top: 0; z-index: 50;
    border-bottom: 1px solid var(--fin-border);
    background: rgba(8,13,9,0.84);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }

  /* ── Buttons ─────────────────────────────────────────────── */
  .fin-btn-primary {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--fin-gold); color: #0A0C0A;
    font-family: var(--font-dm-sans), 'DM Sans', sans-serif;
    font-weight: 600; font-size: 14px;
    padding: 12px 24px; border-radius: 7px; text-decoration: none;
    transition: all 0.2s ease; letter-spacing: 0.01em; white-space: nowrap;
  }
  .fin-btn-primary:hover {
    background: var(--fin-gold-lt);
    transform: translateY(-1px);
    box-shadow: 0 8px 28px rgba(201,146,42,0.28);
    color: #0A0C0A;
  }
  .fin-btn-ghost {
    display: inline-flex; align-items: center; gap: 8px;
    background: transparent; color: var(--fin-text);
    font-family: var(--font-dm-sans), 'DM Sans', sans-serif;
    font-weight: 400; font-size: 14px;
    padding: 11px 22px; border-radius: 7px; text-decoration: none;
    transition: all 0.2s ease; border: 1px solid var(--fin-border-2);
    white-space: nowrap;
  }
  .fin-btn-ghost:hover {
    border-color: var(--fin-gold);
    color: var(--fin-gold-lt);
    background: var(--fin-gold-glow);
  }

  /* ── Feature list (editorial) ────────────────────────────── */
  .fin-feat-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }
  .fin-feat-item {
    padding: 40px 0;
    border-bottom: 1px solid var(--fin-border);
    padding-right: 48px;
  }
  .fin-feat-item:nth-child(even) {
    padding-right: 0;
    padding-left: 48px;
    border-left: 1px solid var(--fin-border);
  }
  .fin-feat-item:nth-child(5),
  .fin-feat-item:nth-child(6) {
    border-bottom: none;
  }

  /* ── Transaction feed mock ───────────────────────────────── */
  .fin-mock {
    background: var(--fin-surface);
    border: 1px solid var(--fin-border-2);
    border-radius: 18px; padding: 24px;
    box-shadow: 0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
  }
  .fin-txn-row {
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--fin-border);
  }
  .fin-txn-row:last-child {
    padding-bottom: 0;
    margin-bottom: 0;
    border-bottom: none;
  }

  /* ── Step chips (workflow) ───────────────────────────────── */
  .fin-step {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 100px;
    font-size: 12px; font-weight: 500;
    font-family: var(--font-dm-sans), 'DM Sans', sans-serif;
    white-space: nowrap;
  }

  /* ── Dividers ────────────────────────────────────────────── */
  .fin-divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--fin-border-2), transparent);
  }

  /* ── Glow orbs ───────────────────────────────────────────── */
  .fin-orb {
    position: absolute; border-radius: 50%;
    filter: blur(80px); pointer-events: none;
  }

  /* ── Footer nav links ────────────────────────────────────── */
  .fin-footer-link {
    font-size: 12px;
    color: var(--fin-muted);
    text-decoration: none;
    transition: color 0.15s ease;
    border-radius: 4px;
    outline-offset: 3px;
  }
  .fin-footer-link:hover,
  .fin-footer-link:focus-visible {
    color: var(--fin-text);
  }
  .fin-footer-link:focus-visible {
    outline: 2px solid var(--fin-gold);
  }

  /* ── Animations ──────────────────────────────────────────── */
  @keyframes fin-up {
    from { opacity: 0; transform: translateY(22px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fin-float {
    0%,100% { transform: translateY(0) rotate(1.2deg); }
    50%     { transform: translateY(-14px) rotate(1.2deg); }
  }
  @keyframes fin-pulse-dot {
    0%,100% { opacity: 1; }
    50%     { opacity: 0.25; }
  }
  @keyframes fin-stat-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .anim-up-0 { animation: fin-up 0.65s ease both; }
  .anim-up-1 { animation: fin-up 0.65s 0.14s ease both; }
  .anim-up-2 { animation: fin-up 0.65s 0.28s ease both; }
  .anim-up-3 { animation: fin-up 0.65s 0.42s ease both; }
  .anim-float { animation: fin-float 6.5s ease-in-out infinite; }
  .pulse-dot { animation: fin-pulse-dot 2.2s ease-in-out infinite; }

  .stat-visible-0 { animation: fin-stat-in 0.5s 0.00s ease both; }
  .stat-visible-1 { animation: fin-stat-in 0.5s 0.12s ease both; }
  .stat-visible-2 { animation: fin-stat-in 0.5s 0.24s ease both; }
  .stat-visible-3 { animation: fin-stat-in 0.5s 0.36s ease both; }

  /* ── Light mode overrides ────────────────────────────────── */
  .fin-root.fin-light {
    --fin-bg:        #F3F7F3;
    --fin-surface:   #FFFFFF;
    --fin-surface-2: #E8EDE8;
    --fin-border:    rgba(0,0,0,0.065);
    --fin-border-2:  rgba(0,0,0,0.12);
    --fin-gold:      #C9922A;
    --fin-gold-lt:   #9C7118;
    --fin-gold-glow: rgba(201,146,42,0.09);
    --fin-blue:      #3A6EE0;
    --fin-text:      #0D1510;
    --fin-muted:     #637560;
    --fin-success:   #059669;
  }
  .fin-root.fin-light .fin-header {
    background: rgba(243,247,243,0.90);
    border-bottom-color: rgba(0,0,0,0.09);
  }
  .fin-root.fin-light .fin-grid {
    background-image:
      linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px);
    background-size: 64px 64px;
  }
  .fin-root.fin-light .fin-mock {
    box-shadow: 0 24px 60px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.08);
  }
  .fin-root.fin-light .fin-divider {
    background: linear-gradient(90deg, transparent, rgba(0,0,0,0.10), transparent);
  }

  /* ── Responsive ──────────────────────────────────────────── */
  @media (max-width: 900px) {
    .fin-hero-grid  { grid-template-columns: 1fr !important; }
    .fin-feat-list  { grid-template-columns: 1fr !important; }
    .fin-stats-grid { grid-template-columns: 1fr 1fr !important; }
    .fin-mock-wrap  { display: none !important; }
  }
  @media (max-width: 680px) {
    .fin-feat-item { padding-right: 0 !important; }
    .fin-feat-item:nth-child(even) {
      padding-left: 0 !important;
      border-left: none !important;
    }
    .fin-feat-item:nth-child(5),
    .fin-feat-item:nth-child(6) {
      border-bottom: 1px solid var(--fin-border) !important;
    }
    .fin-feat-item:last-child {
      border-bottom: none !important;
    }
  }
  @media (max-width: 580px) {
    .fin-stats-grid { grid-template-columns: 1fr 1fr !important; }
    .fin-workflow   { justify-content: flex-start !important; overflow-x: auto; padding-bottom: 8px; }
    .fin-footer-row { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
    .fin-nav-secondary { display: none !important; }
  }
`;

// ─── Features data ────────────────────────────────────────────────────────────
const features = [
  {
    icon: <BarChart3 size={18} />,
    title: "Fluxo de Caixa em Tempo Real",
    desc: "Visualize entradas e saídas com gráficos interativos. Projeções automáticas com base em transações recorrentes e vencimentos.",
  },
  {
    icon: <CheckCircle2 size={18} />,
    title: "Workflow de Aprovações",
    desc: "Fluxo multi-nível: rascunho, aprovação, autorização, pagamento. Controle granular por papel, limite e centro de custo.",
  },
  {
    icon: <ShieldCheck size={18} />,
    title: "Centros de Custo",
    desc: "Hierarquia por departamento ou projeto com drill-down de rentabilidade. Orçamentos com alertas de desvio em tempo real.",
  },
  {
    icon: <TrendingUp size={18} />,
    title: "Conciliação Bancária",
    desc: "Importe extratos OFX e concilie transações automaticamente. Sessões auditáveis com histórico completo de alterações.",
  },
  {
    icon: <Layers size={18} />,
    title: "Multi-Empresa",
    desc: "Gerencie múltiplas empresas com isolamento total de dados. Cada tenant com RBAC e configuração de usuários independente.",
  },
  {
    icon: <Zap size={18} />,
    title: "API Pública REST",
    desc: "Integre via API autenticada por HMAC-SHA256 com rate limiting, sanitização de entrada e logs de auditoria completos.",
  },
] as const;

// ─── Workflow steps ───────────────────────────────────────────────────────────
const workflowSteps = [
  { label: "Rascunho", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
  { label: "Pend. Aprovação", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  { label: "Aprovado", color: "#4F86F7", bg: "rgba(79,134,247,0.12)" },
  { label: "Pend. Autorização", color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" },
  { label: "Autorizado", color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  { label: "Pago", color: "#C9922A", bg: "rgba(201,146,42,0.12)" },
] as const;

// ─── Mock transaction feed ────────────────────────────────────────────────────
const mockTxns = [
  {
    id: "T-0291",
    entity: "Fornecedor ABC Ltda",
    desc: "NF-e 00438 — Materiais",
    amount: "R$ 24.800",
    statusLabel: "Pend. Aprovação",
    statusColor: "#F59E0B",
    meta: null,
  },
  {
    id: "T-0290",
    entity: "Folha DEZ/24",
    desc: "Depto. Comercial",
    amount: "R$ 128.400",
    statusLabel: "Aprovado",
    statusColor: "#4F86F7",
    meta: "Ana Silva · há 12min",
  },
  {
    id: "T-0289",
    entity: "Locação Escritório",
    desc: "Centro: Administrativo",
    amount: "R$ 8.200",
    statusLabel: "Autorizado",
    statusColor: "#10B981",
    meta: "Carlos M. · há 28min",
  },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("fin-theme") as "dark" | "light" | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setTheme(saved);
    // Remove FOUC prevention class now that React controls theming
    document.documentElement.classList.remove("fin-theme-light-pending");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("fin-theme", next);
  }

  // Auth redirect
  useEffect(() => {
    if (!loading && user) {
      const effectiveStatus =
        user.status || (user.active ? "active" : "pending_company_setup");
      if (effectiveStatus === "active") {
        router.push("/dashboard");
      } else if (effectiveStatus === "pending_company_setup") {
        router.push("/company-setup");
      } else if (effectiveStatus === "pending_approval") {
        router.push("/pending-approval");
      }
    }
  }, [user, loading, router]);

  // Trigger stat counters when section enters viewport
  useEffect(() => {
    const node = statsRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      <div
        className={`fin-root${theme === "light" ? " fin-light" : ""}`}
        suppressHydrationWarning
      >
        {/* ── HEADER ──────────────────────────────────────────────── */}
        <header className="fin-header">
          <div
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              padding: "0 24px",
              display: "flex",
              alignItems: "center",
              height: 64,
            }}
          >
            {/* Logo */}
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background:
                    "linear-gradient(135deg, var(--fin-gold), var(--fin-gold-lt))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 12L6 8L10 10L14 4"
                    stroke="#0A0C0A"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 4H14V6"
                    stroke="#0A0C0A"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span
                className="fin-serif"
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "var(--fin-text)",
                  letterSpacing: "-0.01em",
                }}
              >
                Fin<span style={{ color: "var(--fin-gold-lt)" }}>Control</span>
              </span>
            </Link>

            <div style={{ flex: 1 }} />

            <nav
              style={{ display: "flex", alignItems: "center", gap: 8 }}
              aria-label="Navegação principal"
            >
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                aria-label={
                  theme === "dark"
                    ? "Mudar para modo claro"
                    : "Mudar para modo escuro"
                }
                aria-pressed={theme === "light"}
                style={{
                  width: 46,
                  height: 34,
                  borderRadius: 17,
                  position: "relative",
                  border: "1px solid var(--fin-border-2)",
                  background:
                    theme === "light"
                      ? "linear-gradient(135deg, var(--fin-gold), var(--fin-gold-lt))"
                      : "rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  transition: "background 0.3s ease",
                  flexShrink: 0,
                  padding: 0,
                  marginRight: 4,
                }}
              >
                {/* knob */}
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: theme === "light" ? "calc(100% - 26px)" : 4,
                    transform: "translateY(-50%)",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background:
                      theme === "light" ? "#FFFFFF" : "rgba(255,255,255,0.9)",
                    transition: "left 0.25s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                  }}
                >
                  {theme === "light" ? (
                    <Sun size={11} color="#C9922A" />
                  ) : (
                    <Moon size={11} color="#4F86F7" />
                  )}
                </div>
              </button>

              <Link href="/login" className="fin-btn-ghost fin-nav-secondary">
                Entrar
              </Link>

              <Link href="/login?tab=register" className="fin-btn-primary">
                Começar grátis
              </Link>
            </nav>
          </div>
        </header>

        <main>
          {/* ── HERO ──────────────────────────────────────────────── */}
          <section
            className="fin-grid"
            aria-label="Introdução"
            style={{
              position: "relative",
              padding: "96px 0 80px",
              overflow: "hidden",
              minHeight: "92vh",
              display: "flex",
              alignItems: "center",
            }}
          >
            {/* Glow orbs */}
            <div
              className="fin-orb"
              aria-hidden="true"
              style={{
                width: 640,
                height: 640,
                background: "rgba(16,185,129,0.06)",
                top: -220,
                left: -220,
              }}
            />
            <div
              className="fin-orb"
              aria-hidden="true"
              style={{
                width: 480,
                height: 480,
                background: "rgba(201,146,42,0.06)",
                bottom: -120,
                right: -160,
              }}
            />

            <div
              style={{
                maxWidth: 1200,
                margin: "0 auto",
                padding: "0 24px",
                width: "100%",
              }}
            >
              <div
                className="fin-hero-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 64,
                  alignItems: "center",
                }}
              >
                {/* Left: copy */}
                <div>
                  {/* Badge */}
                  <div
                    className="anim-up-0"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "5px 14px",
                      borderRadius: 100,
                      border: "1px solid rgba(201,146,42,0.28)",
                      background: "rgba(201,146,42,0.07)",
                      marginBottom: 28,
                    }}
                  >
                    <span
                      className="pulse-dot"
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--fin-gold)",
                        display: "inline-block",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--fin-gold-lt)",
                        letterSpacing: "0.09em",
                        textTransform: "uppercase",
                      }}
                    >
                      Gestão financeira empresarial
                    </span>
                  </div>

                  {/* Headline */}
                  <h1
                    className="fin-serif anim-up-1"
                    style={{
                      fontSize: "clamp(46px, 5.2vw, 74px)",
                      fontWeight: 700,
                      lineHeight: 1.08,
                      letterSpacing: "-0.025em",
                      marginBottom: 22,
                    }}
                  >
                    Controle Financeiro{" "}
                    <em
                      style={{
                        fontStyle: "italic",
                        color: "var(--fin-gold-lt)",
                      }}
                    >
                      Inteligente
                    </em>{" "}
                    para sua Empresa
                  </h1>

                  {/* Subtitle */}
                  <p
                    className="anim-up-2"
                    style={{
                      fontSize: 16,
                      lineHeight: 1.7,
                      color: "var(--fin-muted)",
                      marginBottom: 36,
                      maxWidth: 470,
                    }}
                  >
                    Fluxo de caixa em tempo real, aprovações multi-nível e
                    centros de custo — tudo em uma plataforma segura,
                    multi-tenant e auditável.
                  </p>

                  {/* CTAs */}
                  <div
                    className="anim-up-3"
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 36,
                    }}
                  >
                    <Link
                      href="/login"
                      className="fin-btn-primary"
                      style={{ fontSize: 15, padding: "13px 26px" }}
                    >
                      Acessar Plataforma <ArrowRight size={16} />
                    </Link>
                    <a
                      href="#demonstracao"
                      className="fin-btn-ghost"
                      style={{
                        fontSize: 15,
                        padding: "13px 22px",
                      }}
                    >
                      Ver demonstração
                    </a>
                  </div>

                  {/* Trust strip */}
                  <div
                    className="anim-up-3"
                    style={{
                      display: "flex",
                      gap: 20,
                      paddingTop: 28,
                      borderTop: "1px solid var(--fin-border)",
                      flexWrap: "wrap",
                    }}
                  >
                    {[
                      "SSL + Criptografia",
                      "LGPD Compliance",
                      "Cloud-native",
                    ].map((label) => (
                      <span
                        key={label}
                        style={{
                          fontSize: 12,
                          color: "var(--fin-muted)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 13 13"
                          fill="none"
                          aria-hidden="true"
                          style={{ flexShrink: 0 }}
                        >
                          <path
                            d="M2 7L5 10L11 3"
                            stroke="var(--fin-gold)"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Right: transaction feed */}
                <div
                  className="fin-mock-wrap anim-up-2"
                  style={{ display: "flex", justifyContent: "center" }}
                >
                  <div
                    className="fin-mock anim-float"
                    style={{ width: "100%", maxWidth: 420 }}
                    aria-hidden="true"
                  >
                    {/* Card header */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 20,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--fin-muted)",
                        }}
                      >
                        Fila de Aprovação
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          className="pulse-dot"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--fin-success)",
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--fin-success)",
                          }}
                        >
                          Ao vivo
                        </span>
                      </div>
                    </div>

                    {/* Transaction rows */}
                    {mockTxns.map((tx) => (
                      <div key={tx.id} className="fin-txn-row">
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{ fontSize: 13, fontWeight: 500, flex: 1 }}
                          >
                            {tx.entity}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: tx.statusColor,
                              padding: "2px 8px",
                              borderRadius: 4,
                              background: `${tx.statusColor}18`,
                              flexShrink: 0,
                              letterSpacing: "0.02em",
                            }}
                          >
                            {tx.statusLabel}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--fin-muted)",
                            }}
                          >
                            {tx.desc}
                          </span>
                          <span
                            className="fin-serif"
                            style={{
                              fontSize: 17,
                              fontWeight: 700,
                              letterSpacing: "-0.02em",
                            }}
                          >
                            {tx.amount}
                          </span>
                        </div>
                        {tx.meta && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--fin-muted)",
                              marginTop: 4,
                            }}
                          >
                            {tx.meta}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Workflow mini-indicator */}
                    <div
                      style={{
                        marginTop: 4,
                        paddingTop: 16,
                        borderTop: "1px solid var(--fin-border)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        overflowX: "auto",
                      }}
                    >
                      {workflowSteps.map(({ label, color }, i) => (
                        <div
                          key={label}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 500,
                              color,
                              letterSpacing: "0.03em",
                            }}
                          >
                            {label}
                          </span>
                          {i < workflowSteps.length - 1 && (
                            <svg
                              width="8"
                              height="8"
                              viewBox="0 0 8 8"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M1 4H7M7 4L5 2M7 4L5 6"
                                stroke="var(--fin-muted)"
                                strokeWidth="1.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── STATS ──────────────────────────────────────────────── */}
          <div className="fin-divider" />
          <section
            ref={statsRef}
            aria-label="Números da plataforma"
            style={{ padding: "56px 0", background: "var(--fin-surface)" }}
          >
            <div
              style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}
            >
              <div
                className="fin-stats-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 32,
                }}
              >
                {(
                  [
                    {
                      value: "2,3bi",
                      prefix: "R$",
                      label: "em transações processadas",
                    },
                    {
                      value: "1.200+",
                      prefix: "",
                      label: "empresas na plataforma",
                    },
                    {
                      value: "99,9%",
                      prefix: "",
                      label: "uptime garantido por SLA",
                    },
                    {
                      value: "6",
                      prefix: "",
                      label: "papéis RBAC configuráveis",
                    },
                  ] as const
                ).map(({ value, prefix, label }, i) => (
                  <div
                    key={label}
                    className={statsVisible ? `stat-visible-${i}` : ""}
                    style={{
                      textAlign: "center",
                      opacity: statsVisible ? undefined : 0,
                    }}
                  >
                    <div
                      className="fin-serif"
                      style={{
                        fontSize: "clamp(32px, 4vw, 48px)",
                        fontWeight: 700,
                        lineHeight: 1,
                        letterSpacing: "-0.025em",
                      }}
                    >
                      {prefix && (
                        <span
                          style={{
                            fontSize: "0.55em",
                            fontFamily:
                              "var(--font-dm-sans), 'DM Sans', sans-serif",
                            fontWeight: 300,
                            color: "var(--fin-muted)",
                            verticalAlign: "middle",
                            marginRight: 2,
                          }}
                        >
                          {prefix}
                        </span>
                      )}
                      {value}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--fin-muted)",
                        marginTop: 6,
                      }}
                    >
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="fin-divider" />

          {/* ── DEMO ───────────────────────────────────────────────── */}
          <div id="demonstracao">
            <DemoSection theme={theme} />
          </div>

          {/* ── FEATURES ───────────────────────────────────────────── */}
          <section
            aria-labelledby="features-heading"
            style={{ padding: "96px 0" }}
          >
            <div
              style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}
            >
              {/* Section label */}
              <div style={{ marginBottom: 64 }}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--fin-gold)",
                    marginBottom: 12,
                  }}
                >
                  Funcionalidades
                </p>
                <h2
                  id="features-heading"
                  className="fin-serif"
                  style={{
                    fontSize: "clamp(30px, 4vw, 50px)",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                    maxWidth: 480,
                  }}
                >
                  Tudo que sua empresa precisa
                </h2>
              </div>

              {/* Editorial numbered list */}
              <div className="fin-feat-list">
                {features.map(({ icon, title, desc }, i) => (
                  <div key={title} className="fin-feat-item">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.10em",
                          color: "var(--fin-gold)",
                          fontVariantNumeric: "tabular-nums",
                          flexShrink: 0,
                        }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        aria-hidden="true"
                        style={{ color: "var(--fin-muted)", flexShrink: 0 }}
                      >
                        {icon}
                      </span>
                      <h3
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          lineHeight: 1.3,
                        }}
                      >
                        {title}
                      </h3>
                    </div>
                    <p
                      style={{
                        fontSize: 13,
                        lineHeight: 1.65,
                        color: "var(--fin-muted)",
                        paddingLeft: 40,
                      }}
                    >
                      {desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── WORKFLOW ────────────────────────────────────────────── */}
          <section
            aria-labelledby="workflow-heading"
            style={{ padding: "80px 0", background: "var(--fin-surface)" }}
          >
            <div
              style={{
                maxWidth: 1100,
                margin: "0 auto",
                padding: "0 24px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--fin-gold)",
                  marginBottom: 12,
                }}
              >
                Fluxo de Transações
              </p>
              <h2
                id="workflow-heading"
                className="fin-serif"
                style={{
                  fontSize: "clamp(28px, 3.5vw, 44px)",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  marginBottom: 44,
                }}
              >
                Do rascunho ao pagamento
              </h2>

              {/* Steps row */}
              <div
                className="fin-workflow"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {workflowSteps.map(({ label, color, bg }, i) => (
                  <div
                    key={label}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <div
                      className="fin-step"
                      style={{
                        background: bg,
                        border: `1px solid ${color}30`,
                        color,
                      }}
                    >
                      {label}
                    </div>
                    {i < workflowSteps.length - 1 && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                        style={{ color: "var(--fin-muted)", flexShrink: 0 }}
                      >
                        <path
                          d="M2 7H12M12 7L8 3M12 7L8 11"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                ))}
              </div>

              <p
                style={{
                  fontSize: 13,
                  color: "var(--fin-muted)",
                  marginTop: 24,
                  maxWidth: 480,
                  margin: "24px auto 0",
                  lineHeight: 1.65,
                }}
              >
                Workflow configurável com aprovação e autorização independentes.
                Rejeição disponível em qualquer etapa com notificação automática
                via e-mail.
              </p>
            </div>
          </section>

          {/* ── CTA FINAL ───────────────────────────────────────────── */}
          <section
            aria-label="Chamada para ação"
            style={{
              padding: "100px 0",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              className="fin-orb"
              aria-hidden="true"
              style={{
                width: 600,
                height: 600,
                background: "rgba(201,146,42,0.05)",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
              }}
            />
            <div
              className="fin-grid"
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, opacity: 0.5 }}
            />
            <div
              style={{
                maxWidth: 760,
                margin: "0 auto",
                padding: "0 24px",
                textAlign: "center",
                position: "relative",
              }}
            >
              <h2
                className="fin-serif"
                style={{
                  fontSize: "clamp(34px, 5vw, 62px)",
                  fontWeight: 700,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.1,
                  marginBottom: 18,
                }}
              >
                Pronto para ter{" "}
                <em
                  style={{
                    fontStyle: "italic",
                    color: "var(--fin-gold-lt)",
                  }}
                >
                  controle total
                </em>{" "}
                das suas finanças?
              </h2>
              <p
                style={{
                  fontSize: 16,
                  color: "var(--fin-muted)",
                  marginBottom: 38,
                  lineHeight: 1.65,
                }}
              >
                Configure sua empresa em minutos. Sem contrato de fidelidade,
                sem pegadinhas.
              </p>
              <Link
                href="/login"
                className="fin-btn-primary"
                style={{ fontSize: 16, padding: "15px 32px" }}
              >
                Começar agora — é grátis <ArrowRight size={17} />
              </Link>
            </div>
          </section>
        </main>

        {/* ── FOOTER ──────────────────────────────────────────────── */}
        <footer
          style={{
            borderTop: "1px solid var(--fin-border)",
            padding: "28px 0",
            background: "var(--fin-surface)",
          }}
        >
          <div
            className="fin-footer-row"
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              padding: "0 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span
              className="fin-serif"
              style={{ fontSize: 17, fontWeight: 700 }}
            >
              Fin<span style={{ color: "var(--fin-gold-lt)" }}>Control</span>
            </span>

            <p style={{ fontSize: 12, color: "var(--fin-muted)" }}>
              &copy; {new Date().getFullYear()} FinControl. Todos os direitos
              reservados.
            </p>

            <nav
              aria-label="Links do rodapé"
              style={{ display: "flex", gap: 24 }}
            >
              {[
                { label: "Termos de Uso", href: "/termos-uso" },
                {
                  label: "Política de Privacidade",
                  href: "/politica-privacidade",
                },
              ].map(({ label, href }) => (
                <Link key={label} href={href} className="fin-footer-link">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}
