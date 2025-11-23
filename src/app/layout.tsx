import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { CompanyProvider } from "@/components/providers/CompanyProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fin Control",
  description: "Sistema de Gestão Financeira",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <AuthProvider>
          <CompanyProvider>
            {children}
            <ToastProvider />
          </CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
