"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/providers/AuthProvider";
import { Suspense, useState } from "react";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

type Tab = "login" | "register";
type Busy = "form" | "google" | null;

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required
          className="pr-10"
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={show}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function FormMessage({
  id,
  tone,
  children,
}: {
  id: string;
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "text-sm text-destructive"
          : "text-sm text-emerald-700 dark:text-emerald-400"
      }
    >
      {children}
    </p>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "register" ? "register" : "login",
  );

  const { loginWithGoogle, loginWithEmail, registerWithEmail } = useAuth();
  const [busy, setBusy] = useState<Busy>(null);
  const [loginError, setLoginError] = useState<{
    field: "email" | "password";
    message: string;
  } | null>(null);
  const [registerError, setRegisterError] = useState("");
  const [resetMessage, setResetMessage] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");

  const passwordsMismatch =
    regConfirmPassword.length > 0 && regPassword !== regConfirmPassword;

  const handleGoogleLogin = async () => {
    try {
      setBusy("google");
      await loginWithGoogle();
    } catch (error) {
      console.error(error);
      toast.error("Erro ao fazer login com Google.");
    } finally {
      setBusy(null);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setResetMessage("");
    try {
      setBusy("form");
      await loginWithEmail(email, password);
    } catch (error) {
      console.error(error);
      const message =
        (error as { code?: string }).code === "auth/invalid-credential"
          ? "Email ou senha incorretos."
          : "Erro ao fazer login. Tente novamente.";
      setLoginError({ field: "password", message });
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const handleResetPassword = async () => {
    setLoginError(null);
    setResetMessage("");
    if (!email) {
      setLoginError({
        field: "email",
        message: "Informe o email acima para receber o link de redefinição.",
      });
      document.getElementById("email")?.focus();
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "auth/user-not-found") {
        console.error(error);
        setLoginError({
          field: "email",
          message: "Não foi possível enviar o link. Tente novamente.",
        });
        return;
      }
    }
    // Mesma resposta exista ou não a conta, para não revelar cadastros.
    setResetMessage(
      `Se ${email} tiver conta, enviamos um link para redefinir a senha.`,
    );
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError("");
    if (regPassword !== regConfirmPassword) {
      setRegisterError("As senhas não conferem.");
      return;
    }
    if (regPassword.length < 6) {
      setRegisterError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    try {
      setBusy("form");
      await registerWithEmail(regEmail, regPassword, regName);
      toast.success("Conta criada com sucesso!");
    } catch (error) {
      console.error(error);
      const code = (error as { code?: string }).code;
      setRegisterError(
        code === "auth/email-already-in-use"
          ? "Este email já está cadastrado."
          : code === "auth/weak-password"
            ? "A senha é muito fraca."
            : "Erro ao criar conta. Tente novamente.",
      );
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <Image src="/favicon.svg" alt="" width={24} height={24} priority />
          <p className="text-base font-semibold tracking-tight">Fin Control</p>
        </div>

        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          {tab === "login" ? "Entrar no Fin Control" : "Criar sua conta"}
        </h1>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="register">Criar conta</TabsTrigger>
          </TabsList>
          <p className="mb-6 mt-2 text-xs text-muted-foreground">
            Foi convidado? Use o link do email de convite em vez de criar uma
            conta nova.
          </p>

          <TabsContent value="login" className="mt-0">
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setLoginError(null);
                  }}
                  autoComplete="email"
                  aria-invalid={loginError?.field === "email" || undefined}
                  aria-describedby={
                    loginError?.field === "email" ? "login-error" : undefined
                  }
                  autoFocus
                  required
                />
              </div>
              <PasswordField
                id="password"
                label="Senha"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setLoginError(null);
                }}
                autoComplete="current-password"
                invalid={loginError?.field === "password"}
                describedBy={
                  loginError?.field === "password" ? "login-error" : undefined
                }
              />
              <div className="-mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleResetPassword}
                  className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  Esqueci minha senha
                </button>
              </div>
              {loginError && (
                <FormMessage id="login-error" tone="error">
                  {loginError.message}
                </FormMessage>
              )}
              {resetMessage && (
                <FormMessage id="reset-message" tone="success">
                  {resetMessage}
                </FormMessage>
              )}
              <Button className="w-full" type="submit" disabled={disabled}>
                {busy === "form" && <Loader2 className="animate-spin" />}
                Acessar plataforma
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="register" className="mt-0">
            <form
              onSubmit={handleRegister}
              onChange={() => setRegisterError("")}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="reg-name">Nome completo</Label>
                <Input
                  id="reg-name"
                  type="text"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <PasswordField
                id="reg-password"
                label="Senha"
                value={regPassword}
                onChange={setRegPassword}
                autoComplete="new-password"
                minLength={6}
              />
              <PasswordField
                id="reg-confirm-password"
                label="Confirmar senha"
                value={regConfirmPassword}
                onChange={setRegConfirmPassword}
                autoComplete="new-password"
                minLength={6}
                invalid={passwordsMismatch}
                describedBy={passwordsMismatch ? "confirm-error" : undefined}
              />
              {passwordsMismatch && (
                <FormMessage id="confirm-error" tone="error">
                  As senhas não conferem.
                </FormMessage>
              )}
              {registerError && !passwordsMismatch && (
                <FormMessage id="register-error" tone="error">
                  {registerError}
                </FormMessage>
              )}
              <Button className="w-full" type="submit" disabled={disabled}>
                {busy === "form" && <Loader2 className="animate-spin" />}
                Criar conta
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleLogin}
          disabled={disabled}
        >
          {busy === "google" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <svg
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

        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
          Ao acessar você concorda com a{" "}
          <a
            href="/politica-privacidade"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Política de Privacidade
          </a>{" "}
          e os{" "}
          <a
            href="/termos-uso"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Termos de Serviço
          </a>
          .
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
