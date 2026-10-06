import { AppProviders } from "@/components/providers/AppProviders";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppProviders>{children}</AppProviders>;
}
