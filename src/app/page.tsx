import type { Metadata } from "next";
import { Geist_Mono, Hanken_Grotesk } from "next/font/google";
import LandingPage from "@/components/features/landing/LandingPage";

// Fontes exclusivas da landing: declaradas aqui, não são pré-carregadas nas
// demais rotas.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Financeiro · Hebron ASEEC | Contas a pagar, conciliação e aprovação",
  description:
    "Contas a pagar e a receber com aprovação em etapas, baixa pelo extrato bancário e registro de cada alteração, para empresas brasileiras.",
};

export default function Page() {
  return (
    <div className={`contents ${hanken.variable} ${geistMono.variable}`}>
      <LandingPage />
    </div>
  );
}
