import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import LandingPage from "@/components/features/landing/LandingPage";

// Fontes exclusivas da landing: declaradas aqui, não são pré-carregadas nas
// demais rotas.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

export default function Page() {
  return (
    <div className={`contents ${cormorant.variable} ${dmSans.variable}`}>
      <LandingPage />
    </div>
  );
}
