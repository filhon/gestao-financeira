"use client";

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
import { DemoSection } from "@/components/features/landing/DemoSection";

// ─── CSS-in-JSX (React 19 hoists <style> + <link> to <head>) ────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --fin-bg:           #06091A;
    --fin-surface:      #0C1228;
    --fin-surface-2:    #111B36;
    --fin-border:       rgba(255,255,255,0.06);
    --fin-border-2:     rgba(255,255,255,0.11);
    --fin-gold:         #C8962A;
    --fin-gold-lt:      #E5B44A;
    --fin-gold-glow:    rgba(200,150,42,0.10);
    --fin-blue:         #4478F5;
    --fin-text:         #E8EFFF;
    --fin-muted:        #7A889E;
    --fin-success:      #10B981;
  }

  .fin-root {
    background: var(--fin-bg);
    color: var(--fin-text);
    font-family: 'DM Sans', system-ui, sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── Grid background ─────────────────────────────────────────── */
  .fin-grid {
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 64px 64px;
  }

  /* ── Typography ──────────────────────────────────────────────── */
  .fin-serif { font-family: 'Cormorant Garamond', Georgia, serif; }

  .fin-gold-gradient {
    background: linear-gradient(135deg, #C8962A 0%, #E5B44A 50%, #C8962A 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* ── Header ──────────────────────────────────────────────────── */
  .fin-header {
    position: sticky; top: 0; z-index: 50;
    border-bottom: 1px solid var(--fin-border);
    background: rgba(6,9,26,0.82);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }

  /* ── Buttons ─────────────────────────────────────────────────── */
  .fin-btn-primary {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--fin-gold); color: #0A0C18;
    font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px;
    padding: 12px 24px; border-radius: 7px; text-decoration: none;
    transition: all 0.2s ease; letter-spacing: 0.01em; white-space: nowrap;
  }
  .fin-btn-primary:hover {
    background: var(--fin-gold-lt);
    transform: translateY(-1px);
    box-shadow: 0 8px 28px rgba(200,150,42,0.28);
    color: #0A0C18;
  }
  .fin-btn-ghost {
    display: inline-flex; align-items: center; gap: 8px;
    background: transparent; color: var(--fin-text);
    font-family: 'DM Sans', sans-serif; font-weight: 400; font-size: 14px;
    padding: 11px 22px; border-radius: 7px; text-decoration: none;
    transition: all 0.2s ease; border: 1px solid var(--fin-border-2);
    white-space: nowrap;
  }
  .fin-btn-ghost:hover {
    border-color: var(--fin-gold);
    color: var(--fin-gold-lt);
    background: var(--fin-gold-glow);
  }

  /* ── Feature cards ───────────────────────────────────────────── */
  .fin-card {
    background: var(--fin-surface);
    border: 1px solid var(--fin-border);
    border-radius: 14px; padding: 28px;
    position: relative; overflow: hidden;
    transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
  }
  .fin-card::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--fin-gold), transparent);
    opacity: 0; transition: opacity 0.3s ease;
  }
  .fin-card:hover {
    transform: translateY(-5px);
    border-color: rgba(200,150,42,0.22);
    box-shadow: 0 24px 48px rgba(0,0,0,0.35);
  }
  .fin-card:hover::before { opacity: 1; }

  /* ── Dashboard mock card ─────────────────────────────────────── */
  .fin-mock {
    background: var(--fin-surface);
    border: 1px solid var(--fin-border-2);
    border-radius: 18px; padding: 24px;
    box-shadow: 0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
  }

  /* ── Step chips (workflow) ───────────────────────────────────── */
  .fin-step {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 100px;
    font-size: 12px; font-weight: 500;
    font-family: 'DM Sans', sans-serif; white-space: nowrap;
  }

  /* ── Dividers ────────────────────────────────────────────────── */
  .fin-divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--fin-border-2), transparent);
  }

  /* ── Glow orbs ───────────────────────────────────────────────── */
  .fin-orb {
    position: absolute; border-radius: 50%;
    filter: blur(80px); pointer-events: none;
  }

  /* ── Animations ──────────────────────────────────────────────── */
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

  .anim-up-0 { animation: fin-up 0.65s ease both; }
  .anim-up-1 { animation: fin-up 0.65s 0.14s ease both; }
  .anim-up-2 { animation: fin-up 0.65s 0.28s ease both; }
  .anim-up-3 { animation: fin-up 0.65s 0.42s ease both; }
  .anim-float { animation: fin-float 6.5s ease-in-out infinite; }
  .pulse-dot { animation: fin-pulse-dot 2.2s ease-in-out infinite; }

  /* ── Light mode overrides ───────────────────────────────────── */
  .fin-root.fin-light {
    --fin-bg:        #F7F4EF;
    --fin-surface:   #FFFFFF;
    --fin-surface-2: #EEEAE1;
    --fin-border:    rgba(0,0,0,0.07);
    --fin-border-2:  rgba(0,0,0,0.13);
    --fin-gold:      #C8962A;
    --fin-gold-lt:   #9A7020;
    --fin-gold-glow: rgba(200,150,42,0.09);
    --fin-text:      #0F1523;
    --fin-muted:     #6B7280;
    --fin-success:   #059669;
  }
  .fin-root.fin-light .fin-header {
    background: rgba(247,244,239,0.90);
    border-bottom-color: rgba(0,0,0,0.09);
  }
  .fin-root.fin-light .fin-grid {
    background-image:
      linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px);
    background-size: 64px 64px;
  }
  .fin-root.fin-light .fin-gold-gradient {
    background: linear-gradient(135deg, #7A5510 0%, #A8780F 50%, #7A5510 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .fin-root.fin-light .fin-card {
    box-shadow: 0 2px 10px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04);
  }
  .fin-root.fin-light .fin-mock {
    box-shadow: 0 24px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.09);
  }
  .fin-root.fin-light .fin-divider {
    background: linear-gradient(90deg, transparent, rgba(0,0,0,0.10), transparent);
  }

  /* ── Responsive ──────────────────────────────────────────────── */
  @media (max-width: 900px) {
    .fin-hero-grid  { grid-template-columns: 1fr !important; }
    .fin-feat-grid  { grid-template-columns: 1fr 1fr !important; }
    .fin-stats-grid { grid-template-columns: 1fr 1fr !important; }
    .fin-mock-wrap  { display: none !important; }
  }
  @media (max-width: 580px) {
    .fin-feat-grid  { grid-template-columns: 1fr !important; }
    .fin-stats-grid { grid-template-columns: 1fr 1fr !important; }
    .fin-workflow   { justify-content: flex-start !important; overflow-x: auto; padding-bottom: 8px; }
    .fin-footer-row { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
  }
`;

// ─── Features data ───────────────────────────────────────────────────────────
const features = [
  {
    icon: <BarChart3 size={22} />,
    color: "#4478F5",
    title: "Fluxo de Caixa em Tempo Real",
    desc: "Visualize entradas e saídas com gráficos interativos. Projeções automáticas com base em transações recorrentes e vencimentos.",
  },
  {
    icon: <CheckCircle2 size={22} />,
    color: "#C8962A",
    title: "Workflow de Aprovações",
    desc: "Fluxo multi-nível: rascunho → aprovação → autorização → pagamento. Controle granular por papel, limite e centro de custo.",
  },
  {
    icon: <ShieldCheck size={22} />,
    color: "#10B981",
    title: "Centros de Custo",
    desc: "Hierarquia por departamento ou projeto com drill-down de rentabilidade. Orçamentos com alertas de desvio em tempo real.",
  },
  {
    icon: <TrendingUp size={22} />,
    color: "#8B5CF6",
    title: "Conciliação Bancária",
    desc: "Importe extratos OFX e concilie transações automaticamente. Sessões auditáveis com histórico completo de alterações.",
  },
  {
    icon: <Layers size={22} />,
    color: "#EF4444",
    title: "Multi-Empresa",
    desc: "Gerencie múltiplas empresas com isolamento total de dados. Cada tenant com RBAC e configuração de usuários independente.",
  },
  {
    icon: <Zap size={22} />,
    color: "#F59E0B",
    title: "API Pública REST",
    desc: "Integre via API autenticada por HMAC-SHA256 com rate limiting, sanitização de entrada e logs de auditoria completos.",
  },
] as const;

// ─── Workflow steps ───────────────────────────────────────────────────────────
const workflowSteps = [
  { label: "Rascunho", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
  { label: "Pend. Aprovação", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  { label: "Aprovado", color: "#4478F5", bg: "rgba(68,120,245,0.12)" },
  { label: "Pend. Autorização", color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" },
  { label: "Autorizado", color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  { label: "Pago", color: "#C8962A", bg: "rgba(200,150,42,0.12)" },
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

      <div className={`fin-root${theme === "light" ? " fin-light" : ""}`}>
        {/* ── HEADER ─────────────────────────────────────────────────── */}
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
                    stroke="#0A0C18"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 4H14V6"
                    stroke="#0A0C18"
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

            <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                title={
                  theme === "dark"
                    ? "Mudar para modo claro"
                    : "Mudar para modo escuro"
                }
                style={{
                  width: 46,
                  height: 26,
                  borderRadius: 13,
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
                  style={{
                    position: "absolute",
                    top: 3,
                    left: theme === "light" ? "calc(100% - 22px)" : 3,
                    width: 18,
                    height: 18,
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
                    <Sun size={10} color="#C8962A" />
                  ) : (
                    <Moon size={10} color="#4478F5" />
                  )}
                </div>
              </button>

              <Link href="/login" className="fin-btn-ghost">
                Entrar
              </Link>

              <Link href="/login?tab=register" className="fin-btn-primary">
                Começar grátis
              </Link>
            </nav>
          </div>
        </header>

        {/* ── HERO ───────────────────────────────────────────────────── */}
        <section
          className="fin-grid"
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
            style={{
              width: 640,
              height: 640,
              background: "rgba(68,120,245,0.07)",
              top: -220,
              left: -220,
            }}
          />
          <div
            className="fin-orb"
            style={{
              width: 480,
              height: 480,
              background: "rgba(200,150,42,0.06)",
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
                    border: "1px solid rgba(200,150,42,0.28)",
                    background: "rgba(200,150,42,0.07)",
                    marginBottom: 28,
                  }}
                >
                  <span
                    className="pulse-dot"
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
                    className="fin-gold-gradient"
                    style={{ fontStyle: "italic" }}
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
                  Fluxo de caixa em tempo real, aprovações multi-nível e centros
                  de custo — tudo em uma plataforma segura, multi-tenant e
                  auditável.
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
                    onClick={(e) => {
                      e.preventDefault();
                      document
                        .getElementById("demonstracao")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="fin-btn-ghost"
                    style={{
                      fontSize: 15,
                      padding: "13px 22px",
                      cursor: "pointer",
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
                    { label: "SSL + Criptografia" },
                    { label: "LGPD Compliance" },
                    { label: "Cloud-native" },
                  ].map(({ label }) => (
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

              {/* Right: dashboard preview */}
              <div
                className="fin-mock-wrap anim-up-2"
                style={{ display: "flex", justifyContent: "center" }}
              >
                <div
                  className="fin-mock anim-float"
                  style={{ width: "100%", maxWidth: 420 }}
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
                      Fluxo de Caixa
                    </span>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
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
                        style={{ fontSize: 11, color: "var(--fin-success)" }}
                      >
                        Ao vivo
                      </span>
                    </div>
                  </div>

                  {/* Balance */}
                  <div style={{ marginBottom: 6 }}>
                    <div
                      className="fin-serif"
                      style={{
                        fontSize: 36,
                        fontWeight: 700,
                        letterSpacing: "-0.025em",
                        lineHeight: 1,
                      }}
                    >
                      R$ 847.320
                      <span style={{ fontSize: 20, color: "var(--fin-muted)" }}>
                        ,00
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 6,
                      }}
                    >
                      <span style={{ fontSize: 12, color: "var(--fin-muted)" }}>
                        Saldo disponível
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--fin-success)",
                          background: "rgba(16,185,129,0.1)",
                          padding: "2px 8px",
                          borderRadius: 4,
                        }}
                      >
                        ↑ +12,4%
                      </span>
                    </div>
                  </div>

                  {/* Sparkline */}
                  <div
                    style={{
                      margin: "18px 0",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.02)",
                      padding: "10px 0 0",
                      overflow: "hidden",
                    }}
                  >
                    <svg
                      width="100%"
                      height="60"
                      viewBox="0 0 380 60"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="var(--fin-gold)"
                            stopOpacity="0.28"
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--fin-gold)"
                            stopOpacity="0"
                          />
                        </linearGradient>
                      </defs>
                      <path
                        d="M0,50 L38,42 L76,46 L114,36 L152,30 L190,38 L228,20 L266,26 L304,14 L342,18 L380,10"
                        fill="none"
                        stroke="var(--fin-gold)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M0,50 L38,42 L76,46 L114,36 L152,30 L190,38 L228,20 L266,26 L304,14 L342,18 L380,10 L380,60 L0,60 Z"
                        fill="url(#sg)"
                      />
                    </svg>
                  </div>

                  {/* Status chips */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 10,
                    }}
                  >
                    {(
                      [
                        { label: "Pendentes", value: "12", color: "#F59E0B" },
                        { label: "Aprovados", value: "8", color: "#4478F5" },
                        { label: "Pagos", value: "147", color: "#10B981" },
                      ] as const
                    ).map(({ label, value, color }) => (
                      <div
                        key={label}
                        style={{
                          padding: "12px 8px",
                          borderRadius: 8,
                          background: "rgba(255,255,255,0.025)",
                          border: "1px solid var(--fin-border)",
                          textAlign: "center",
                        }}
                      >
                        <div
                          className="fin-serif"
                          style={{
                            fontSize: 26,
                            fontWeight: 700,
                            color,
                            lineHeight: 1,
                          }}
                        >
                          {value}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--fin-muted)",
                            marginTop: 4,
                          }}
                        >
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── STATS ──────────────────────────────────────────────────── */}
        <div className="fin-divider" />
        <section
          ref={statsRef}
          style={{ padding: "56px 0", background: "var(--fin-surface)" }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
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
              ).map(({ value, prefix, label }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div
                    className={`fin-serif${statsVisible ? "" : ""}`}
                    style={{
                      fontSize: "clamp(32px, 4vw, 48px)",
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: "-0.025em",
                      opacity: statsVisible ? 1 : 0,
                      transition: "opacity 0.6s ease",
                    }}
                  >
                    {prefix && (
                      <span
                        style={{
                          fontSize: "0.55em",
                          fontFamily: "'DM Sans', sans-serif",
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

        {/* ── DEMO ───────────────────────────────────────────────────── */}
        <div id="demonstracao">
          <DemoSection theme={theme} />
        </div>

        {/* ── FEATURES ───────────────────────────────────────────────── */}
        <section style={{ padding: "96px 0" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
            {/* Section label */}
            <div style={{ textAlign: "center", marginBottom: 56 }}>
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
                className="fin-serif"
                style={{
                  fontSize: "clamp(30px, 4vw, 50px)",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                }}
              >
                Tudo que sua empresa precisa
              </h2>
            </div>

            {/* Cards */}
            <div
              className="fin-feat-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 22,
              }}
            >
              {features.map(({ icon, color, title, desc }) => (
                <div key={title} className="fin-card">
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      marginBottom: 20,
                      background: `${color}18`,
                      border: `1px solid ${color}28`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color,
                    }}
                  >
                    {icon}
                  </div>
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      marginBottom: 10,
                      lineHeight: 1.4,
                    }}
                  >
                    {title}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      lineHeight: 1.65,
                      color: "var(--fin-muted)",
                    }}
                  >
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── WORKFLOW ───────────────────────────────────────────────── */}
        <section
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

        {/* ── CTA FINAL ──────────────────────────────────────────────── */}
        <section
          style={{
            padding: "100px 0",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            className="fin-orb"
            style={{
              width: 600,
              height: 600,
              background: "rgba(200,150,42,0.05)",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
            }}
          />
          <div
            className="fin-grid"
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
              <em className="fin-gold-gradient" style={{ fontStyle: "italic" }}>
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
              Configure sua empresa em minutos. Sem contrato de fidelidade, sem
              pegadinhas.
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

        {/* ── FOOTER ─────────────────────────────────────────────────── */}
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
              © {new Date().getFullYear()} FinControl. Todos os direitos
              reservados.
            </p>

            <nav style={{ display: "flex", gap: 24 }}>
              {[
                { label: "Termos de Uso", href: "/termos-uso" },
                {
                  label: "Política de Privacidade",
                  href: "/politica-privacidade",
                },
              ].map(({ label, href }) => (
                <Link
                  key={label}
                  href={href}
                  style={{
                    fontSize: 12,
                    color: "var(--fin-muted)",
                    textDecoration: "none",
                  }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "var(--fin-text)";
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.color =
                      "var(--fin-muted)";
                  }}
                >
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
