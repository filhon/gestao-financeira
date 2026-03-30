"use client";

/**
 * REDESIGN PROPOSAL — Login Page
 *
 * Aesthetic direction: "Editorial Financeiro"
 * Inspiração: Relatórios anuais de bancos europeus + terminais Bloomberg
 * - Paleta: preto quase-puro (#0a0a0a), branco sujo (#f5f2ec), acento dourado (#c9a84c)
 * - Tipografia: "Playfair Display" (serifada, editorial) no logo + "DM Mono" nos dados
 * - Layout: tela dividida — painel esquerdo com "ticker" decorativo, direito com formulário
 * - Animações sutis: entrada escalonada, cursor de campo customizado
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/providers/AuthProvider";
import { useState, useEffect } from "react";
import { Loader2, Eye, EyeOff, TrendingUp, TrendingDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

// --- Dados decorativos fictícios do painel lateral ---
const TICKER_DATA = [
  { label: "Receitas", value: "R$ 847.2K", trend: "up", delta: "+12.4%" },
  { label: "Despesas", value: "R$ 321.8K", trend: "down", delta: "-3.1%" },
  { label: "Saldo", value: "R$ 525.4K", trend: "up", delta: "+8.7%" },
  { label: "A Pagar", value: "R$ 48.3K", trend: "down", delta: "-5.2%" },
  { label: "A Receber", value: "R$ 93.6K", trend: "up", delta: "+18.9%" },
];

const RECENT_TRANSACTIONS = [
  { desc: "Fornecedor Gráfica Sul", amount: "-R$ 4.200", time: "14:32" },
  { desc: "Cliente Metalúrgica ABC", amount: "+R$ 18.500", time: "13:15" },
  { desc: "Aluguel sede comercial", amount: "-R$ 6.800", time: "11:00" },
  { desc: "Serviços de TI — NF 991", amount: "+R$ 3.400", time: "09:47" },
  { desc: "Reembolso despesas viagem", amount: "-R$ 890", time: "08:20" },
];

function SidePanel() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
      setDate(
        now.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="hidden lg:flex flex-col justify-between h-full p-10 relative overflow-hidden"
      style={{
        background: "#0a0a0a",
        color: "#f5f2ec",
      }}
    >
      {/* Grade decorativa de fundo */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(201,168,76,1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(201,168,76,1) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Gradiente diagonal decorativo */}
      <div
        className="absolute bottom-0 left-0 w-full h-1/2 opacity-20"
        style={{
          background:
            "linear-gradient(135deg, transparent 40%, #c9a84c22 100%)",
        }}
      />

      {/* Header do painel */}
      <div className="relative z-10">
        <div
          className="text-xs tracking-[0.3em] uppercase mb-1"
          style={{ color: "#c9a84c", fontFamily: "'DM Mono', monospace" }}
        >
          Dashboard — Visão Geral
        </div>
        <div
          className="text-3xl font-bold leading-tight mb-1"
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            letterSpacing: "-0.02em",
          }}
        >
          Fin Control
        </div>
        <div
          className="text-xs opacity-50 mt-3"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {date}
        </div>
        <div
          className="text-2xl font-bold mt-1 tabular-nums"
          style={{ fontFamily: "'DM Mono', monospace", color: "#c9a84c" }}
        >
          {time}
        </div>
      </div>

      {/* Métricas principais */}
      <div className="relative z-10 space-y-3">
        <div
          className="text-xs tracking-[0.2em] uppercase opacity-50 mb-4"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Indicadores · Mar 2026
        </div>
        {TICKER_DATA.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between py-2"
            style={{ borderBottom: "1px solid rgba(245,242,236,0.08)" }}
          >
            <span
              className="text-xs opacity-60 tracking-wide"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {item.label}
            </span>
            <div className="flex items-center gap-3">
              <span
                className="text-sm font-medium tabular-nums"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {item.value}
              </span>
              <span
                className="text-xs flex items-center gap-1"
                style={{
                  color: item.trend === "up" ? "#4ade80" : "#f87171",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                {item.trend === "up" ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {item.delta}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Transações recentes */}
      <div className="relative z-10">
        <div
          className="text-xs tracking-[0.2em] uppercase opacity-50 mb-3"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Últimos Lançamentos
        </div>
        <div className="space-y-2">
          {RECENT_TRANSACTIONS.map((tx, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span
                className="text-xs opacity-50 tabular-nums"
                style={{ fontFamily: "'DM Mono', monospace", minWidth: "38px" }}
              >
                {tx.time}
              </span>
              <span
                className="text-xs opacity-70 flex-1 truncate"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {tx.desc}
              </span>
              <span
                className="text-xs tabular-nums font-medium"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  color: tx.amount.startsWith("+") ? "#4ade80" : "#f87171",
                }}
              >
                {tx.amount}
              </span>
            </div>
          ))}
        </div>

        {/* Linha de rodapé */}
        <div
          className="mt-6 pt-4 text-xs opacity-30 text-center"
          style={{
            fontFamily: "'DM Mono', monospace",
            borderTop: "1px solid rgba(245,242,236,0.1)",
          }}
        >
          Dados ilustrativos · Protegido por criptografia AES-256
        </div>
      </div>
    </div>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const defaultTab =
    searchParams.get("tab") === "register" ? "register" : "login";

  const { loginWithGoogle, loginWithEmail, registerWithEmail } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      await loginWithGoogle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      toast.error("Erro ao fazer login com Google.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      await loginWithEmail(email, password);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      if (error.code === "auth/invalid-credential") {
        toast.error("Email ou senha incorretos.");
      } else {
        toast.error("Erro ao fazer login. Tente novamente.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword !== regConfirmPassword) {
      toast.error("As senhas não conferem.");
      return;
    }
    if (regPassword.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    try {
      setIsLoading(true);
      await registerWithEmail(regEmail, regPassword, regName);
      toast.success("Conta criada com sucesso!");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      if (error.code === "auth/email-already-in-use") {
        toast.error("Este email já está cadastrado.");
      } else if (error.code === "auth/weak-password") {
        toast.error("A senha é muito fraca.");
      } else {
        toast.error("Erro ao criar conta. Tente novamente.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Importar fontes via @import no head — alternativa inline */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Mono:wght@300;400;500&display=swap');

        .fc-input {
          background: transparent !important;
          border: none !important;
          border-bottom: 1px solid rgba(10,10,10,0.18) !important;
          border-radius: 0 !important;
          padding: 10px 0 8px !important;
          font-size: 14px !important;
          font-family: 'DM Mono', monospace !important;
          transition: border-color 0.2s ease !important;
          box-shadow: none !important;
        }
        .fc-input:focus {
          border-bottom-color: #c9a84c !important;
          box-shadow: none !important;
          ring: none !important;
          outline: none !important;
        }
        .fc-input::placeholder {
          color: rgba(10,10,10,0.3) !important;
          font-size: 13px !important;
        }
        .fc-tab[data-state="active"] {
          background: #0a0a0a !important;
          color: #f5f2ec !important;
          border-radius: 0 !important;
        }
        .fc-tab {
          border-radius: 0 !important;
          font-family: 'DM Mono', monospace !important;
          font-size: 12px !important;
          letter-spacing: 0.1em !important;
          text-transform: uppercase !important;
        }
        .fc-tablist {
          background: transparent !important;
          border-bottom: 1px solid rgba(10,10,10,0.1) !important;
          border-radius: 0 !important;
          padding: 0 !important;
          height: auto !important;
          margin-bottom: 24px !important;
        }
        .fc-btn-primary {
          background: #0a0a0a !important;
          color: #f5f2ec !important;
          border-radius: 0 !important;
          font-family: 'DM Mono', monospace !important;
          font-size: 12px !important;
          letter-spacing: 0.15em !important;
          text-transform: uppercase !important;
          height: 44px !important;
          transition: background 0.2s ease, transform 0.1s ease !important;
        }
        .fc-btn-primary:hover:not(:disabled) {
          background: #c9a84c !important;
          color: #0a0a0a !important;
          transform: translateY(-1px) !important;
        }
        .fc-btn-google {
          background: transparent !important;
          border: 1px solid rgba(10,10,10,0.15) !important;
          border-radius: 0 !important;
          font-family: 'DM Mono', monospace !important;
          font-size: 12px !important;
          letter-spacing: 0.1em !important;
          text-transform: uppercase !important;
          height: 44px !important;
          transition: all 0.2s ease !important;
        }
        .fc-btn-google:hover:not(:disabled) {
          border-color: #0a0a0a !important;
          background: rgba(10,10,10,0.03) !important;
        }
        .fc-label {
          font-family: 'DM Mono', monospace !important;
          font-size: 10px !important;
          letter-spacing: 0.15em !important;
          text-transform: uppercase !important;
          color: rgba(10,10,10,0.45) !important;
          margin-bottom: 0 !important;
        }
        @keyframes fc-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fc-animate-1 { animation: fc-fade-up 0.5s ease both 0.1s; }
        .fc-animate-2 { animation: fc-fade-up 0.5s ease both 0.2s; }
        .fc-animate-3 { animation: fc-fade-up 0.5s ease both 0.3s; }
        .fc-animate-4 { animation: fc-fade-up 0.5s ease both 0.4s; }
      `}</style>

      <div
        className="min-h-screen grid"
        style={{
          background: "#f5f2ec",
          gridTemplateColumns: "1fr",
        }}
      >
        <div
          className="min-h-screen lg:grid"
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          {/* Painel esquerdo — decorativo */}
          <SidePanel />

          {/* Painel direito — formulário */}
          <div
            className="flex flex-col justify-center px-10 py-16 relative"
            style={{ background: "#f5f2ec", minHeight: "100vh" }}
          >
            {/* Número de linha decorativo */}
            <div
              className="absolute top-8 right-10 text-xs opacity-20 tabular-nums hidden lg:block"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              /auth/login · v2.1
            </div>

            {/* Logo (apenas mobile — no desktop está no painel esquerdo) */}
            <div className="lg:hidden mb-10 fc-animate-1">
              <div
                className="text-xs tracking-[0.3em] uppercase mb-1"
                style={{ color: "#c9a84c", fontFamily: "'DM Mono', monospace" }}
              >
                Gestão Financeira
              </div>
              <div
                className="text-3xl font-bold"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                Fin Control
              </div>
            </div>

            {/* Cabeçalho do formulário */}
            <div className="mb-8 fc-animate-1 max-w-sm">
              <div
                className="text-xs tracking-[0.25em] uppercase opacity-40 mb-2"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                Acesso seguro
              </div>
              <h1
                className="text-2xl font-bold leading-tight"
                style={{
                  fontFamily: "'Playfair Display', Georgia, serif",
                  color: "#0a0a0a",
                  letterSpacing: "-0.02em",
                }}
              >
                Bem-vindo de volta
              </h1>
              <p
                className="text-sm mt-1 opacity-50"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                Gestão financeira inteligente para sua empresa
              </p>
            </div>

            {/* Formulário */}
            <div className="max-w-sm w-full fc-animate-2">
              <Tabs defaultValue={defaultTab} className="w-full">
                <TabsList className="fc-tablist grid w-full grid-cols-2">
                  <TabsTrigger value="login" className="fc-tab">
                    Entrar
                  </TabsTrigger>
                  <TabsTrigger value="register" className="fc-tab">
                    Criar conta
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-5 mt-0">
                  <form onSubmit={handleEmailLogin} className="space-y-5">
                    <div className="space-y-1">
                      <Label htmlFor="email" className="fc-label">
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="fc-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="password" className="fc-label">
                        Senha
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="fc-input pr-8"
                        />
                        <button
                          type="button"
                          className="absolute right-0 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-70 transition-opacity"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="pt-2">
                      <Button
                        className="w-full fc-btn-primary"
                        type="submit"
                        disabled={isLoading}
                      >
                        {isLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Acessar plataforma
                      </Button>
                    </div>
                  </form>
                </TabsContent>

                <TabsContent value="register" className="space-y-4 mt-0">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-1">
                      <Label htmlFor="reg-name" className="fc-label">
                        Nome Completo
                      </Label>
                      <Input
                        id="reg-name"
                        type="text"
                        placeholder="Seu Nome"
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        required
                        className="fc-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="reg-email" className="fc-label">
                        Email
                      </Label>
                      <Input
                        id="reg-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        required
                        className="fc-input"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="reg-password" className="fc-label">
                        Senha
                      </Label>
                      <div className="relative">
                        <Input
                          id="reg-password"
                          type={showRegPassword ? "text" : "password"}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          required
                          minLength={6}
                          className="fc-input pr-8"
                        />
                        <button
                          type="button"
                          className="absolute right-0 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-70 transition-opacity"
                          onClick={() => setShowRegPassword(!showRegPassword)}
                        >
                          {showRegPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="reg-confirm-password"
                        className="fc-label"
                      >
                        Confirmar Senha
                      </Label>
                      <div className="relative">
                        <Input
                          id="reg-confirm-password"
                          type={showRegConfirmPassword ? "text" : "password"}
                          value={regConfirmPassword}
                          onChange={(e) =>
                            setRegConfirmPassword(e.target.value)
                          }
                          required
                          minLength={6}
                          className="fc-input pr-8"
                        />
                        <button
                          type="button"
                          className="absolute right-0 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-70 transition-opacity"
                          onClick={() =>
                            setShowRegConfirmPassword(!showRegConfirmPassword)
                          }
                        >
                          {showRegConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="pt-2">
                      <Button
                        className="w-full fc-btn-primary"
                        type="submit"
                        disabled={isLoading}
                      >
                        {isLoading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Criar conta gratuita
                      </Button>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>

              {/* Divisor */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span
                    className="w-full"
                    style={{ borderTop: "1px solid rgba(10,10,10,0.1)" }}
                  />
                </div>
                <div className="relative flex justify-center">
                  <span
                    className="px-3 text-xs"
                    style={{
                      background: "#f5f2ec",
                      color: "rgba(10,10,10,0.35)",
                      fontFamily: "'DM Mono', monospace",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    ou
                  </span>
                </div>
              </div>

              {/* Google */}
              <Button
                className="w-full fc-btn-google"
                onClick={handleGoogleLogin}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <svg
                    className="mr-2 h-4 w-4"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 488 512"
                  >
                    <path
                      fill="currentColor"
                      d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
                    />
                  </svg>
                )}
                Continuar com Google
              </Button>
            </div>

            {/* Rodapé */}
            <div
              className="mt-10 max-w-sm fc-animate-4"
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "11px",
                color: "rgba(10,10,10,0.3)",
                lineHeight: 1.6,
              }}
            >
              Ao acessar você concorda com a{" "}
              <a
                href="/politica-privacidade"
                className="underline hover:opacity-70 transition-opacity"
              >
                Política de Privacidade
              </a>{" "}
              e os{" "}
              <a
                href="/termos-uso"
                className="underline hover:opacity-70 transition-opacity"
              >
                Termos de Serviço
              </a>
              .
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ background: "#f5f2ec" }}
        >
          <Loader2 className="animate-spin h-6 w-6 opacity-30" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
