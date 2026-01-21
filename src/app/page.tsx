import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, BarChart3, CheckCircle2, ShieldCheck } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center px-4 md:px-6">
          <div className="mr-4 flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <span className="font-bold text-xl">Fin Control</span>
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-end space-x-2">
            <nav className="flex items-center space-x-2">
              <Link href="/login">
                <Button variant="ghost">Entrar</Button>
              </Link>
              <Link href="/login">
                <Button>Começar Agora</Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
          <div className="container mx-auto px-4 md:px-6">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none">
                  Gestão Financeira Inteligente para sua Empresa
                </h1>
                <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                  Controle total sobre fluxo de caixa, centros de custo e
                  processos de aprovação. Tome decisões baseadas em dados reais.
                </p>
              </div>
              <div className="space-x-4">
                <Link href="/login">
                  <Button size="lg" className="h-11 px-8">
                    Acessar Plataforma <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-12 md:py-24 lg:py-32 bg-gray-100 dark:bg-gray-800">
          <div className="container mx-auto px-4 md:px-6">
            <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="p-4 bg-primary/10 rounded-full">
                  <BarChart3 className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-xl font-bold">
                  Fluxo de Caixa em Tempo Real
                </h2>
                <p className="text-gray-500 dark:text-gray-400">
                  Visualize entradas e saídas com gráficos intuitivos e
                  relatórios detalhados para previsão financeira.
                </p>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="p-4 bg-primary/10 rounded-full">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-xl font-bold">Controle de Aprovações</h2>
                <p className="text-gray-500 dark:text-gray-400">
                  Workflow de aprovação configurável para pagamentos e despesas,
                  garantindo segurança e compliance.
                </p>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="p-4 bg-primary/10 rounded-full">
                  <ShieldCheck className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-xl font-bold">
                  Gestão por Centros de Custo
                </h2>
                <p className="text-gray-500 dark:text-gray-400">
                  Organize suas finanças por departamentos ou projetos para uma
                  análise precisa da rentabilidade.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="w-full border-t py-6">
        <div className="container mx-auto flex flex-col items-center gap-2 px-4 md:px-6 sm:flex-row">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            © 2024 Fin Control. Todos os direitos reservados.
          </p>
          <nav className="flex gap-4 sm:ml-auto sm:gap-6">
            <Link
              className="text-xs hover:underline underline-offset-4"
              href="/termos-uso"
            >
              Termos de Uso
            </Link>
            <Link
              className="text-xs hover:underline underline-offset-4"
              href="/politica-privacidade"
            >
              Política de Privacidade
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
