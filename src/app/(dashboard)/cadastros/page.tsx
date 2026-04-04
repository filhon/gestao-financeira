"use client";

import Link from "next/link";
import {
  Users,
  ArrowUpRight,
  Building2,
  Tag,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Featured module ──────────────────────────────────────────────────────────

function EntidadesCard() {
  return (
    <Link href="/cadastros/entidades" className="group block">
      <div className="relative rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5 hover:border-indigo-200 dark:hover:border-indigo-900 overflow-hidden">
        {/* accent strip */}
        <div className="absolute top-0 left-0 h-1 w-full rounded-t-xl bg-gradient-to-r from-indigo-500 to-violet-400" />

        <div className="flex items-start justify-between mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-indigo-500" />
        </div>

        <p className="text-sm font-medium text-muted-foreground mb-1">Entidades</p>
        <p className="text-2xl font-bold tracking-tight text-foreground">
          Fornecedores & Clientes
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Cadastro central de pessoas físicas e jurídicas
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            <Users className="h-3 w-3" />
            Fornecedores
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-950 px-2.5 py-1 text-xs font-medium text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
            <Building2 className="h-3 w-3" />
            Clientes
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── Planned modules (coming soon) ───────────────────────────────────────────

const plannedModules = [
  {
    title: "Plano de Contas",
    description: "Estrutura contábil e categorias de lançamento.",
    icon: LayoutGrid,
    accent: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950",
  },
  {
    title: "Categorias",
    description: "Tags e classificações para transações.",
    icon: Tag,
    accent: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950",
  },
];

function PlannedCard({
  title,
  description,
  icon: Icon,
  accent,
  bg,
}: (typeof plannedModules)[0]) {
  return (
    <div className="h-full rounded-xl border border-border border-dashed bg-card/50 p-5 opacity-60">
      <div className="flex items-start justify-between mb-4">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", bg)}>
          <Icon className={cn("h-4 w-4", accent)} />
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Em breve
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CadastrosPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cadastros</h1>
        <p className="text-muted-foreground mt-1">
          Gerencie os dados mestres do sistema.
        </p>
      </div>

      {/* Featured module */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "0ms", animationFillMode: "both" }}
      >
        <EntidadesCard />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Próximos módulos
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Planned modules */}
      <div className="grid gap-4 sm:grid-cols-2">
        {plannedModules.map((mod, i) => (
          <div
            key={mod.title}
            className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ animationDelay: `${80 + i * 60}ms`, animationFillMode: "both" }}
          >
            <PlannedCard {...mod} />
          </div>
        ))}
      </div>
    </div>
  );
}
