"use client";

import { useEffect, useState, useCallback } from "react";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  Plus,
  Copy,
  Check,
  Download,
  FileText,
  Eye,
  EyeOff,
  Key,
  Loader2,
  ShieldOff,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ApiKeyPermissions {
  balance: boolean;
  transactions: boolean;
  budgets: boolean;
  costCenters: boolean;
  financialSummary: boolean;
}

type Ts = { _seconds: number } | { seconds: number };

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  permissions: ApiKeyPermissions;
  allowedIPs: string[];
  rateLimitPerMinute: number;
  active: boolean;
  createdAt?: Ts;
  updatedAt?: Ts;
  lastUsedAt?: Ts;
  expiresAt?: Ts;
  revokedAt?: Ts;
  createdByName?: string;
  revokedByName?: string;
}

interface NewKeyResult {
  id: string;
  apiKey: string;
  secretKey: string;
  prefix: string;
  name: string;
  permissions: ApiKeyPermissions;
}

const PERMISSION_LABELS: Record<keyof ApiKeyPermissions, string> = {
  balance: "Saldo",
  transactions: "Transações",
  budgets: "Orçamentos",
  costCenters: "Centros de custo",
  financialSummary: "Resumo financeiro",
};

const PERMISSION_DESCRIPTIONS: Record<keyof ApiKeyPermissions, string> = {
  balance: "Saldos das contas",
  transactions: "Transações financeiras",
  budgets: "Orçamentos e limites",
  costCenters: "Centros de custo",
  financialSummary: "Relatórios e resumos consolidados",
};

const VALIDITY_OPTIONS = [
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "1 ano" },
  { value: "none", label: "Sem validade" },
] as const;

/** Sem uso por mais que isso, a chave aparece sinalizada. */
const STALE_DAYS = 30;

const emptyPermissions = (): ApiKeyPermissions => ({
  balance: false,
  transactions: false,
  budgets: false,
  costCenters: false,
  financialSummary: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDate(ts?: Ts): Date | null {
  if (!ts) return null;
  const secs = "_seconds" in ts ? ts._seconds : ts.seconds;
  return secs ? new Date(secs * 1000) : null;
}

function formatDate(ts?: Ts) {
  const d = toDate(ts);
  return d ? format(d, "dd/MM/yyyy", { locale: ptBR }) : "—";
}

function daysUntil(ts: Ts | undefined, now: number): number | null {
  const d = toDate(ts);
  return d ? (d.getTime() - now) / 86_400_000 : null;
}

function activePermissions(p: ApiKeyPermissions) {
  return (Object.keys(PERMISSION_LABELS) as (keyof ApiKeyPermissions)[]).filter(
    (k) => p[k],
  );
}

function isValidIp(ip: string) {
  return /^[0-9a-fA-F:.]+(\/32)?$/.test(ip);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie à mão.");
    return false;
  }
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function PermissionToggle({
  permKey,
  checked,
  onChange,
}: {
  permKey: keyof ApiKeyPermissions;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <label
      htmlFor={`perm-${permKey}`}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors duration-150",
        checked
          ? "border-primary/40 bg-primary/5"
          : "border-border hover:bg-muted/50",
      )}
    >
      <Checkbox
        id={`perm-${permKey}`}
        checked={checked}
        onCheckedChange={(val) => onChange(!!val)}
      />
      <span className="text-sm font-medium">{PERMISSION_LABELS[permKey]}</span>
      <span className="text-xs text-muted-foreground">
        {PERMISSION_DESCRIPTIONS[permKey]}
      </span>
    </label>
  );
}

function LastUsed({ item, now }: { item: ApiKeyItem; now: number }) {
  const d = toDate(item.lastUsedAt);
  if (!d) return <span className="text-muted-foreground">Nunca usada</span>;
  const stale = (now - d.getTime()) / 86_400_000 > STALE_DAYS;
  return (
    <div>
      <div>{formatDate(item.lastUsedAt)}</div>
      <div
        className={cn(
          "flex items-center gap-1 text-xs",
          stale
            ? "font-medium text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {stale && <AlertTriangle className="h-3 w-3" aria-hidden />}
        {stale ? "Sem uso " : ""}
        {formatDistanceToNow(d, { locale: ptBR, addSuffix: true })}
      </div>
    </div>
  );
}

function Restrictions({ item, now }: { item: ApiKeyItem; now: number }) {
  const left = daysUntil(item.expiresAt, now);
  const expired = left !== null && left <= 0;
  return (
    <div className="space-y-0.5 text-xs">
      <div>
        {item.allowedIPs.length > 0
          ? `IPs: ${item.allowedIPs.join(", ")}`
          : "Qualquer IP"}
      </div>
      <div
        className={cn(
          expired
            ? "font-medium text-destructive"
            : left !== null && left <= 7
              ? "font-medium text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
        )}
      >
        {item.expiresAt
          ? expired
            ? `Expirada em ${formatDate(item.expiresAt)}`
            : `Expira em ${formatDate(item.expiresAt)}`
          : "Sem validade"}
      </div>
      <div className="text-muted-foreground">
        {item.rateLimitPerMinute} req/min
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ApiKeysPage() {
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { canManageCompanies } = usePermissions();

  const [now] = useState(() => Date.now());
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);

  // Dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [copied, setCopied] = useState({ key: false, secret: false });
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);

  // Form
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPerms, setNewKeyPerms] =
    useState<ApiKeyPermissions>(emptyPermissions());
  const [newKeyValidity, setNewKeyValidity] = useState("365");
  const [newKeyIps, setNewKeyIps] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // ── Guards ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canManageCompanies) {
      router.push("/dashboard");
    }
  }, [canManageCompanies, router]);

  // ── Load keys ─────────────────────────────────────────────────────────────
  const loadKeys = useCallback(async () => {
    if (!selectedCompany) return;
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/v1/admin/keys", {
        headers: { "x-company-id": selectedCompany.id },
      });
      if (!res.ok) throw new Error("Falha ao carregar chaves.");
      const json = await res.json();
      setKeys(json.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  // ── Criar chave ───────────────────────────────────────────────────────────
  const ips = newKeyIps
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalidIps = ips.filter((ip) => !isValidIp(ip));
  const hasPermission = activePermissions(newKeyPerms).length > 0;
  const canCreate =
    newKeyName.trim().length >= 3 &&
    hasPermission &&
    invalidIps.length === 0 &&
    ips.length <= 20;

  const resetForm = () => {
    setNewKeyName("");
    setNewKeyPerms(emptyPermissions());
    setNewKeyValidity("365");
    setNewKeyIps("");
  };

  const handleCreate = async () => {
    if (!selectedCompany || !canCreate) return;

    setIsCreating(true);
    try {
      const expiresAt =
        newKeyValidity === "none"
          ? undefined
          : new Date(
              Date.now() + Number(newKeyValidity) * 86_400_000,
            ).toISOString();

      const res = await fetch("/api/v1/admin/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-company-id": selectedCompany.id,
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
          permissions: newKeyPerms,
          allowedIPs: ips,
          expiresAt,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Erro ao criar chave.");
      }

      const json = await res.json();
      setCopied({ key: false, secret: false });
      setShowSecretKey(false);
      setNewKeyResult(json.data);
      setShowCreateDialog(false);
      resetForm();
      await loadKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar chave.");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Revogar chave ─────────────────────────────────────────────────────────
  // Lança em caso de erro para o ConfirmDialog continuar aberto.
  const handleRevoke = async (key: ApiKeyItem) => {
    if (!selectedCompany) return;
    try {
      const res = await fetch(`/api/v1/admin/keys/${key.id}`, {
        method: "DELETE",
        headers: { "x-company-id": selectedCompany.id },
      });
      if (!res.ok) throw new Error("Falha ao revogar chave.");
      toast.success(`Chave "${key.name}" revogada.`);
      await loadKeys();
    } catch (err) {
      toast.error("Não foi possível revogar a chave. Tente de novo.");
      throw err;
    }
  };

  // ── Segredo exibido uma vez ───────────────────────────────────────────────
  const bothCopied = copied.key && copied.secret;

  const copyOne = async (which: "key" | "secret", text: string) => {
    if (await copyText(text)) {
      setCopied((c) => ({ ...c, [which]: true }));
      toast.success(which === "key" ? "Chave copiada." : "Segredo copiado.");
    }
  };

  const copyAll = async () => {
    if (!newKeyResult) return;
    const env = `GF_API_KEY=${newKeyResult.apiKey}\nGF_API_SECRET=${newKeyResult.secretKey}`;
    if (await copyText(env)) {
      setCopied({ key: true, secret: true });
      toast.success("Credenciais copiadas.");
    }
  };

  // ── Documentação da API (PDF ou Markdown) ─────────────────────────────────
  const downloadDocs = async (kind: "pdf" | "md") => {
    if (!selectedCompany || docsBusy) return;
    setDocsBusy(true);
    try {
      const res = await fetch("/api/internal/api-docs", {
        headers: { "x-company-id": selectedCompany.id },
      });
      if (!res.ok) throw new Error("Falha ao obter a documentação.");
      const md = await res.text();

      let blob: Blob;
      if (kind === "pdf") {
        const { apiDocsPdfService } = await import(
          "@/lib/services/apiDocsPdfService"
        );
        blob = await apiDocsPdfService.generate(md);
      } else {
        blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `api-financeira-documentacao.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Não foi possível baixar a documentação. Tente de novo.");
    } finally {
      setDocsBusy(false);
    }
  };

  const closeSecretDialog = () => {
    setNewKeyResult(null);
    setShowSecretKey(false);
  };

  if (!canManageCompanies) return null;

  const activeKeys = keys.filter((k) => k.active);
  const revokedKeys = keys.filter((k) => !k.active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            Chaves de API
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Acesso somente leitura aos dados da empresa para sistemas externos.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={docsBusy}>
                {docsBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Documentação
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => downloadDocs("pdf")}>
                <FileText className="h-4 w-4" />
                PDF, para leitura
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadDocs("md")}>
                <FileText className="h-4 w-4" />
                Markdown, para agentes de IA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova chave
          </Button>
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <TableSkeleton columns={6} rows={3} />
      ) : loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm">
            Não foi possível carregar as chaves. Elas podem existir; não crie
            uma nova antes de tentar de novo.
          </p>
          <Button variant="outline" size="sm" onClick={loadKeys}>
            Tentar de novo
          </Button>
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={Key}
          title="Nenhuma chave de API criada"
          description="Crie uma chave para um sistema externo ler os dados financeiros da empresa, com acesso limitado ao que você escolher."
          action={{
            label: "Nova chave",
            onClick: () => setShowCreateDialog(true),
          }}
        />
      ) : (
        <div className="space-y-4">
          {activeKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma chave ativa.
            </p>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Chave</TableHead>
                    <TableHead>Acesso</TableHead>
                    <TableHead>Restrições</TableHead>
                    <TableHead>Criada</TableHead>
                    <TableHead>Último uso</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeKeys.map((key) => {
                    const perms = activePermissions(key.permissions);
                    const expired = (daysUntil(key.expiresAt, now) ?? 1) <= 0;
                    return (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {key.name}
                            {expired && (
                              <Badge variant="outline" className="text-xs">
                                Expirada
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs">{key.prefix}…</code>
                        </TableCell>
                        <TableCell className="text-sm">
                          {perms.length === 0
                            ? "Nenhuma"
                            : perms.map((p) => PERMISSION_LABELS[p]).join(", ")}
                        </TableCell>
                        <TableCell>
                          <Restrictions item={key} now={now} />
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{formatDate(key.createdAt)}</div>
                          {key.createdByName && (
                            <div className="text-xs text-muted-foreground">
                              por {key.createdByName}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          <LastUsed item={key} now={now} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRevokeTarget(key)}
                          >
                            <ShieldOff className="h-4 w-4 mr-1" />
                            Revogar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {revokedKeys.length > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={showRevoked}
                onClick={() => setShowRevoked((v) => !v)}
                className="flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform duration-150",
                    showRevoked && "rotate-90",
                  )}
                  aria-hidden
                />
                Revogadas ({revokedKeys.length})
              </button>
              {showRevoked && (
                <div className="mt-2 rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Chave</TableHead>
                        <TableHead>Revogada em</TableHead>
                        <TableHead>Revogada por</TableHead>
                        <TableHead>Último uso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revokedKeys.map((key) => (
                        <TableRow key={key.id}>
                          <TableCell className="font-medium">
                            {key.name}
                          </TableCell>
                          <TableCell>
                            <code className="text-xs">{key.prefix}…</code>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(key.revokedAt ?? key.updatedAt)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {key.revokedByName ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(key.lastUsedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dialog — Criar chave */}
      <ResponsiveModal
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      >
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Nova chave de API</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              A chave dá acesso de leitura aos dados financeiros da empresa.
              Libere só o que a integração precisa.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="key-name">Nome</Label>
              <Input
                id="key-name"
                placeholder="Ex.: Integração ERP, Painel BI"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none mb-2">
                Permissões
              </legend>
              <div className="space-y-1.5">
                {(Object.keys(newKeyPerms) as (keyof ApiKeyPermissions)[]).map(
                  (perm) => (
                    <PermissionToggle
                      key={perm}
                      permKey={perm}
                      checked={newKeyPerms[perm]}
                      onChange={(val) =>
                        setNewKeyPerms((prev) => ({ ...prev, [perm]: val }))
                      }
                    />
                  ),
                )}
              </div>
              {!hasPermission && (
                <p className="text-xs text-muted-foreground">
                  Marque ao menos uma permissão.
                </p>
              )}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="key-validity">Validade</Label>
                <Select
                  value={newKeyValidity}
                  onValueChange={setNewKeyValidity}
                >
                  <SelectTrigger id="key-validity" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALIDITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-ips">IPs permitidos</Label>
                <Input
                  id="key-ips"
                  placeholder="Vazio = qualquer IP"
                  value={newKeyIps}
                  onChange={(e) => setNewKeyIps(e.target.value)}
                  aria-invalid={invalidIps.length > 0}
                  aria-describedby="key-ips-help"
                />
              </div>
            </div>
            <p
              id="key-ips-help"
              className={cn(
                "-mt-3 text-xs",
                invalidIps.length > 0
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {invalidIps.length > 0
                ? `IP inválido: ${invalidIps[0]}. Use IPs exatos, como 203.0.113.10.`
                : "IPs exatos separados por vírgula. Faixas (CIDR) não são aceitas."}
            </p>
          </div>

          <ResponsiveModalFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isCreating || !canCreate}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar chave
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Dialog — Credenciais (exibidas UMA vez; só fecha pelo botão) */}
      <ResponsiveModal
        open={!!newKeyResult}
        onOpenChange={(open) => {
          if (!open && !bothCopied) {
            toast.warning("Copie as credenciais antes de fechar.");
          } else if (!open) {
            closeSecretDialog();
          }
        }}
      >
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Credenciais da chave</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              O segredo aparece só agora. Depois de fechar, só dá para revogar a
              chave e criar outra.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          {newKeyResult && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Chave</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                    {newKeyResult.apiKey}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Copiar chave"
                    onClick={() => copyOne("key", newKeyResult.apiKey)}
                  >
                    {copied.key ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Segredo</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                    {showSecretKey
                      ? newKeyResult.secretKey
                      : "•".repeat(Math.min(newKeyResult.secretKey.length, 48))}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={
                      showSecretKey ? "Ocultar segredo" : "Mostrar segredo"
                    }
                    aria-pressed={showSecretKey}
                    onClick={() => setShowSecretKey((v) => !v)}
                  >
                    {showSecretKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Copiar segredo"
                    onClick={() => copyOne("secret", newKeyResult.secretKey)}
                  >
                    {copied.secret ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={copyAll}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar as duas para o .env
              </Button>

              <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <p>
                  Cada requisição leva os headers{" "}
                  <code className="text-foreground">x-api-key</code>,{" "}
                  <code className="text-foreground">x-timestamp</code> e{" "}
                  <code className="text-foreground">x-signature</code>{" "}
                  (HMAC-SHA256 calculado com o segredo; tolerância de 5 minutos
                  no horário).
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  Formato completo e exemplos na documentação:
                  <button
                    type="button"
                    disabled={docsBusy}
                    onClick={() => downloadDocs("pdf")}
                    className="font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
                  >
                    Baixar PDF
                  </button>
                  <button
                    type="button"
                    disabled={docsBusy}
                    onClick={() => downloadDocs("md")}
                    className="font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
                  >
                    Baixar Markdown
                  </button>
                </p>
              </div>
            </div>
          )}

          <ResponsiveModalFooter>
            <Button onClick={closeSecretDialog} disabled={!bothCopied}>
              {bothCopied
                ? "Já guardei as credenciais"
                : "Copie para continuar"}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* ConfirmDialog — Revogar */}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revogar chave de API"
        description={`A chave "${revokeTarget?.name}" deixa de funcionar na hora e não dá para desfazer. ${
          revokeTarget?.lastUsedAt
            ? `Último uso: ${formatDate(revokeTarget.lastUsedAt)}.`
            : "Ela nunca foi usada."
        }`}
        confirmText="Revogar"
        variant="destructive"
        onConfirm={async () => {
          if (revokeTarget) await handleRevoke(revokeTarget);
        }}
      />
    </div>
  );
}
