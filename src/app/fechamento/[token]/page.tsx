import type { Metadata } from "next";
import { ClosingLinkPage } from "@/components/features/reports/ClosingLinkPage";

export const metadata: Metadata = {
  title: "Fechamento do mês",
  robots: { index: false, follow: false },
  // O endereço é a credencial: não vai para outros sites.
  referrer: "no-referrer",
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <ClosingLinkPage token={(await params).token} />;
}
