"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { formatCnpj } from "@/lib/validations/cnpj";
import type { CashClosing, ClosingFile } from "@/lib/cashClosing";

interface ClosingView
  extends Pick<
    CashClosing,
    "opening" | "inflow" | "outflow" | "closing" | "proof" | "gaps" | "version"
  > {
  companyName: string;
  cnpj: string | null;
  periodName: string;
  headline: string;
  count: number;
  reason: string | null;
  superseded: boolean;
  closedBy: string;
  closedAt: string;
  expiresAt: string;
  files: Record<ClosingFile, { size: number; sha256: string }>;
}

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/internal/cash-closing-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error("Sem conexão. Confira a internet e tente de novo.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Não foi possível abrir.");
  return data as T;
}

const size = (bytes: number) =>
  bytes < 1e6
    ? `${Math.max(1, Math.round(bytes / 1e3))} KB`
    : `${(bytes / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

const day = (iso: string) => iso.split("-").reverse().join("/");

/** O fechamento como a contabilidade o recebe: sem login, só leitura. */
export function ClosingLinkPage({ token }: { token: string }) {
  const [data, setData] = useState<ClosingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ClosingFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const opened = useRef(false);

  const load = () => {
    setError(null);
    post<ClosingView>({ token })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    // O modo estrito monta duas vezes: seriam dois acessos no registro.
    if (opened.current) return;
    opened.current = true;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const download = async (file: ClosingFile) => {
    setBusy(file);
    setFileError(null);
    try {
      const { url } = await post<{ url: string }>({ token, file });
      window.location.assign(url);
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-base font-semibold">{error}</h1>
        <Button variant="outline" size="sm" onClick={load}>
          Tentar de novo
        </Button>
      </main>
    );
  }
  if (!data) {
    return (
      <main aria-busy="true" className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  const sums: [string, number][] = [
    ["Saldo inicial", data.opening],
    ["+ Entradas", data.inflow],
    ["− Saídas", data.outflow],
    ["= Saldo final", data.closing],
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 text-sm sm:py-12">
      <header className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {data.companyName}
          {data.cnpj && ` · CNPJ ${formatCnpj(data.cnpj)}`}
        </p>
        <h1
          className={cn(
            "text-xl font-bold tracking-tight text-balance sm:text-2xl",
            data.proof.status === "mismatch" &&
              "text-red-700 dark:text-red-400",
          )}
        >
          {data.headline}
        </h1>
        <p className="text-xs text-muted-foreground">
          Versão {data.version}, fechada em{" "}
          {format(new Date(data.closedAt), "dd/MM/yyyy 'às' HH:mm")} por{" "}
          {data.closedBy}. {data.count} lançamentos.
        </p>
        {data.reason && (
          <p className="pt-1">
            <span className="font-medium">Observação do fechamento:</span>{" "}
            {data.reason}
          </p>
        )}
      </header>

      {data.superseded && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          Há uma versão mais nova deste mês. Peça o link dela a quem enviou
          este.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            loading={busy === "package"}
            disabled={busy !== null}
            onClick={() => void download("package")}
          >
            {busy !== "package" && <Download className="h-4 w-4" />}
            Baixar o pacote ({size(data.files.package.size)})
          </Button>
          <Button
            size="lg"
            variant="outline"
            loading={busy === "summary"}
            disabled={busy !== null}
            onClick={() => void download("summary")}
          >
            Só a síntese em PDF ({size(data.files.summary.size)})
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O pacote traz a síntese, a planilha, as notas e os comprovantes.
          Extraia o ZIP inteiro antes de abrir a planilha, para os links dos
          documentos funcionarem.
        </p>
        {fileError && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {fileError}
          </p>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-4 sm:grid-cols-4">
        {sums.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "mt-0.5 font-financial text-base font-semibold",
                value < 0 && "text-red-700 dark:text-red-400",
              )}
            >
              {formatCurrency(value)}
            </dd>
          </div>
        ))}
      </dl>

      {data.proof.total !== null && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Conferência com o banco</h2>
          <Rows
            rows={[
              ...data.proof.rows.map((r) => ({
                label: r.name,
                note: r.date ? `extrato de ${day(r.date)}` : "",
                value: formatCurrency(r.balance ?? 0),
              })),
              {
                label: "Saldo no banco",
                value: formatCurrency(data.proof.total),
                strong: true,
              },
              {
                label: "Diferença",
                note: data.proof.difference === 0 ? "confere" : "não confere",
                value: formatCurrency(data.proof.difference ?? 0),
                strong: true,
              },
            ]}
          />
        </section>
      )}

      {data.gaps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">O que falta</h2>
          <Rows
            rows={data.gaps.map((g) => ({
              label: g.label,
              note: `${g.count} ${g.count === 1 ? "lançamento" : "lançamentos"}`,
              value: formatCurrency(g.value),
            }))}
          />
          <p className="text-xs text-muted-foreground">
            A lista completa está no PDF e na aba Pendências da planilha.
          </p>
        </section>
      )}

      <footer className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
        <p>
          Este link é pessoal, vale até{" "}
          {format(new Date(data.expiresAt), "dd/MM/yyyy")} e registra cada
          acesso (data, IP e navegador).
        </p>
        <p className="break-all">
          Código de integridade do pacote (SHA-256):{" "}
          <span className="font-financial">{data.files.package.sha256}</span>
        </p>
      </footer>
    </main>
  );
}

function Rows({
  rows,
}: {
  rows: { label: string; note?: string; value: string; strong?: boolean }[];
}) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li
          key={r.label}
          className={cn(
            "flex items-baseline justify-between gap-4 py-1.5",
            r.strong && "font-semibold",
          )}
        >
          <span>
            {r.label}
            {r.note && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {r.note}
              </span>
            )}
          </span>
          <span className="shrink-0 font-financial">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
