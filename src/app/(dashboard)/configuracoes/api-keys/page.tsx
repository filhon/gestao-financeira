"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useCompany } from "@/components/providers/CompanyProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  Plus,
  Copy,
  Eye,
  EyeOff,
  Key,
  Loader2,
  ShieldOff,
  AlertTriangle,
  Activity,
  CheckCircle2,
  Clock,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ApiKeyPermissions {
  balance: boolean;
  transactions: boolean;
  budgets: boolean;
  costCenters: boolean;
  financialSummary: boolean;
}

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  permissions: ApiKeyPermissions;
  allowedIPs: string[];
  rateLimitPerMinute: number;
  active: boolean;
  createdAt?: { _seconds: number } | { seconds: number };
  lastUsedAt?: { _seconds: number } | { seconds: number };
  expiresAt?: { _seconds: number } | { seconds: number };
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
  costCenters: "Centros de Custo",
  financialSummary: "Resumo Financeiro",
};

const PERMISSION_DESCRIPTIONS: Record<keyof ApiKeyPermissions, string> = {
  balance: "Leitura de saldos de contas",
  transactions: "Leitura de transações financeiras",
  budgets: "Acesso a orçamentos e limites",
  costCenters: "Visualização de centros de custo",
  financialSummary: "Relatórios e resumos consolidados",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSeconds(
  ts?: { _seconds: number } | { seconds: number },
): number | null {
  if (!ts) return null;
  return "_seconds" in ts ? ts._seconds : ts.seconds;
}

function formatDate(ts?: { _seconds: number } | { seconds: number }) {
  const secs = toSeconds(ts);
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function isExpiringSoon(
  ts?: { _seconds: number } | { seconds: number },
): boolean {
  const secs = toSeconds(ts);
  if (!secs) return false;
  const daysLeft = (secs * 1000 - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft > 0 && daysLeft <= 7;
}

function defaultPermissions(): ApiKeyPermissions {
  return {
    balance: true,
    transactions: true,
    budgets: true,
    costCenters: true,
    financialSummary: true,
  };
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  iconClassName,
  iconBgClassName,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  iconClassName: string;
  iconBgClassName: string;
  delay: number;
}) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          iconBgClassName,
        )}
      >
        <Icon className={cn("h-4 w-4", iconClassName)} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}

function PermissionBadges({
  permissions,
  maxVisible = 2,
}: {
  permissions: ApiKeyPermissions;
  maxVisible?: number;
}) {
  const active = (
    Object.entries(permissions) as [keyof ApiKeyPermissions, boolean][]
  )
    .filter(([, v]) => v)
    .map(([k]) => k);

  const visible = active.slice(0, maxVisible);
  const remaining = active.length - maxVisible;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((k) => (
        <Badge key={k} variant="secondary" className="text-xs">
          {PERMISSION_LABELS[k]}
        </Badge>
      ))}
      {remaining > 0 && (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          +{remaining}
        </Badge>
      )}
      {active.length === 0 && (
        <span className="text-xs text-muted-foreground">Nenhuma</span>
      )}
    </div>
  );
}

function PermissionToggleCard({
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
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors duration-150",
        checked
          ? "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"
          : "border-border bg-muted/30 hover:bg-muted/60",
      )}
    >
      <Checkbox
        id={`perm-${permKey}`}
        checked={checked}
        onCheckedChange={(val) => onChange(!!val)}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <p className="text-sm font-medium leading-none">
          {PERMISSION_LABELS[permKey]}
        </p>
        <p className="text-xs text-muted-foreground">
          {PERMISSION_DESCRIPTIONS[permKey]}
        </p>
      </div>
    </label>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ApiKeysPage() {
  const router = useRouter();
  const { selectedCompany } = useCompany();
  const { canManageCompanies } = usePermissions();

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);

  // Form
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPerms, setNewKeyPerms] =
    useState<ApiKeyPermissions>(defaultPermissions());
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
    try {
      const res = await fetch("/api/v1/admin/keys", {
        headers: { "x-company-id": selectedCompany.id },
      });
      if (!res.ok) throw new Error("Falha ao carregar chaves.");
      const json = await res.json();
      setKeys(json.data ?? []);
    } catch {
      toast.error("Erro ao carregar chaves de API.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  // ── Criar chave ───────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!selectedCompany) return;
    if (newKeyName.trim().length < 3) {
      toast.error("Nome deve ter pelo menos 3 caracteres.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/v1/admin/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-company-id": selectedCompany.id,
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
          permissions: newKeyPerms,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Erro ao criar chave.");
      }

      const json = await res.json();
      setNewKeyResult(json.data);
      setShowCreateDialog(false);
      setNewKeyName("");
      setNewKeyPerms(defaultPermissions());
      await loadKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar chave.");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Revogar chave ─────────────────────────────────────────────────────────
  const handleRevoke = async (key: ApiKeyItem) => {
    if (!selectedCompany) return;
    try {
      const res = await fetch(`/api/v1/admin/keys/${key.id}`, {
        method: "DELETE",
        headers: { "x-company-id": selectedCompany.id },
      });
      if (!res.ok) throw new Error("Falha ao revogar chave.");
      toast.success(`Chave "${key.name}" revogada com sucesso.`);
      await loadKeys();
    } catch {
      toast.error("Erro ao revogar chave.");
    }
  };

  // ── Copiar para clipboard ─────────────────────────────────────────────────
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  if (!canManageCompanies) return null;

  const activeKeys = keys.filter((k) => k.active);
  const lastUsedKey = keys.reduce<ApiKeyItem | null>((acc, k) => {
    if (!k.lastUsedAt) return acc;
    if (!acc?.lastUsedAt) return k;
    const aS = toSeconds(k.lastUsedAt) ?? 0;
    const bS = toSeconds(acc.lastUsedAt) ?? 0;
    return aS > bS ? k : acc;
  }, null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start md:items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <Link href="/configuracoes">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Chaves de API</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Gerencie as chaves de acesso à API externa do sistema.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Nova Chave
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={Key}
          label="Total de chaves"
          value={isLoading ? "—" : keys.length}
          iconClassName="text-rose-600 dark:text-rose-400"
          iconBgClassName="bg-rose-50 dark:bg-rose-950/60"
          delay={0}
        />
        <StatCard
          icon={CheckCircle2}
          label="Chaves ativas"
          value={isLoading ? "—" : activeKeys.length}
          iconClassName="text-emerald-600 dark:text-emerald-400"
          iconBgClassName="bg-emerald-50 dark:bg-emerald-950/60"
          delay={60}
        />
        <StatCard
          icon={Activity}
          label="Último uso"
          value={isLoading ? "—" : formatDate(lastUsedKey?.lastUsedAt)}
          iconClassName="text-blue-600 dark:text-blue-400"
          iconBgClassName="bg-blue-50 dark:bg-blue-950/60"
          delay={120}
        />
      </div>

      {/* Aviso de segurança */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-800 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Aviso de Segurança
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-amber-700 dark:text-amber-500">
          As chaves de API concedem acesso programático aos dados financeiros da
          empresa. Nunca compartilhe suas chaves e revogue imediatamente
          qualquer chave comprometida.
        </CardContent>
      </Card>

      {/* Tabela de chaves */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Chaves Ativas
          </CardTitle>
          <CardDescription>
            {isLoading
              ? "Carregando…"
              : `${activeKeys.length} chave(s) ativa(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton columns={7} rows={3} />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={Key}
              title="Nenhuma chave de API criada"
              description="Crie uma chave para permitir integrações externas com acesso controlado aos dados financeiros."
              action={{
                label: "Nova Chave",
                onClick: () => setShowCreateDialog(true),
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Prefixo</TableHead>
                  <TableHead>Permissões</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key, idx) => (
                  <TableRow
                    key={key.id}
                    className={cn(
                      "animate-in fade-in duration-200",
                      !key.active && "opacity-50",
                    )}
                    style={{
                      animationDelay: `${idx * 40}ms`,
                      animationFillMode: "both",
                    }}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {key.name}
                        {isExpiringSoon(key.expiresAt) && (
                          <Badge
                            variant="outline"
                            className="text-xs border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400 gap-1"
                          >
                            <Clock className="h-3 w-3" />
                            Expira em breve
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {key.prefix}…
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={() => copyToClipboard(key.prefix, "Prefixo")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PermissionBadges
                        permissions={key.permissions}
                        maxVisible={2}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.active ? "default" : "outline"}>
                        {key.active ? "Ativa" : "Revogada"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(key.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(key.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeTarget(key)}
                        >
                          <ShieldOff className="h-4 w-4 mr-1" />
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog — Criar chave */}
      <ResponsiveModal
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      >
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Nova Chave de API</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Defina um nome e selecione as permissões para a nova chave.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="key-name">Nome da chave</Label>
              <Input
                id="key-name"
                placeholder="Ex: Integração ERP, Dashboard BI..."
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Permissões</Label>
              <div className="space-y-2">
                {(Object.keys(newKeyPerms) as (keyof ApiKeyPermissions)[]).map(
                  (perm) => (
                    <PermissionToggleCard
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
            </div>
          </div>

          <ResponsiveModalFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Chave
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Dialog — Exibir chave criada (UMA VEZ) */}
      <ResponsiveModal
        open={!!newKeyResult}
        onOpenChange={(open) => {
          if (!open) {
            setNewKeyResult(null);
            setShowSecretKey(false);
          }
        }}
      >
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Key className="h-5 w-5" />
              Chave criada com sucesso!
            </ResponsiveModalTitle>
            <ResponsiveModalDescription className="text-destructive font-medium">
              Copie e guarde as credenciais abaixo agora. Elas não poderão ser
              recuperadas após fechar esta janela.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          {newKeyResult && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">API Key</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                    {newKeyResult.apiKey}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      copyToClipboard(newKeyResult.apiKey, "API Key")
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Secret Key
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                    {showSecretKey
                      ? newKeyResult.secretKey
                      : "•".repeat(Math.min(newKeyResult.secretKey.length, 48))}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
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
                    onClick={() =>
                      copyToClipboard(newKeyResult.secretKey, "Secret Key")
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          <ResponsiveModalFooter>
            <Button
              onClick={() => {
                setNewKeyResult(null);
                setShowSecretKey(false);
              }}
            >
              Confirmar — já guardei as credenciais
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
        description={`Tem certeza que deseja revogar a chave "${revokeTarget?.name}"? Esta ação não pode ser desfeita e qualquer integração usando esta chave deixará de funcionar imediatamente.`}
        confirmText="Revogar"
        variant="destructive"
        onConfirm={() => {
          if (revokeTarget) handleRevoke(revokeTarget);
          setRevokeTarget(null);
        }}
      />
    </div>
  );
}
