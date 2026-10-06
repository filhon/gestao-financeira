import { readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { AppProviders } from "@/components/providers/AppProviders";
import DashboardShell from "@/components/layout/DashboardShell";
import { NovidadesDialog } from "@/components/features/novidades/NovidadesDialog";
import { parseNovidades } from "@/lib/novidades";

// Lê docs/NOVIDADES.md no servidor; o hash serve de versão para o aviso de novidades
function loadNovidades() {
  const raw = readFileSync(
    path.join(process.cwd(), "docs", "NOVIDADES.md"),
    "utf8",
  );
  const releases = parseNovidades(raw);
  const version = createHash("sha1")
    .update(JSON.stringify(releases))
    .digest("hex")
    .slice(0, 10);
  return { releases, version };
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <DashboardShell>{children}</DashboardShell>
      <NovidadesDialog {...loadNovidades()} />
    </AppProviders>
  );
}
