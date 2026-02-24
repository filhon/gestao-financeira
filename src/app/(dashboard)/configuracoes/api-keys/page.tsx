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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts?: { _seconds: number } | { seconds: number }) {
  if (!ts) return "—";
  const secs = "_seconds" in ts ? ts._seconds : ts.seconds;
  return new Date(secs * 1000).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Chave
        </Button>
      </div>

      {/* Info card */}
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
            {keys.filter((k) => k.active).length} chave(s) ativa(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhuma chave de API criada ainda.
            </div>
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
                {keys.map((key) => (
                  <TableRow
                    key={key.id}
                    className={!key.active ? "opacity-50" : ""}
                  >
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {key.prefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(
                          Object.entries(key.permissions) as [
                            keyof ApiKeyPermissions,
                            boolean,
                          ][]
                        )
                          .filter(([, v]) => v)
                          .map(([k]) => (
                            <Badge
                              key={k}
                              variant="secondary"
                              className="text-xs"
                            >
                              {PERMISSION_LABELS[k]}
                            </Badge>
                          ))}
                      </div>
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
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Chave de API</DialogTitle>
            <DialogDescription>
              Defina um nome e selecione as permissões para a nova chave.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
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
                    <div key={perm} className="flex items-center space-x-2">
                      <Checkbox
                        id={`perm-${perm}`}
                        checked={newKeyPerms[perm]}
                        onCheckedChange={(checked) =>
                          setNewKeyPerms((prev) => ({
                            ...prev,
                            [perm]: !!checked,
                          }))
                        }
                      />
                      <label
                        htmlFor={`perm-${perm}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {PERMISSION_LABELS[perm]}
                      </label>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Exibir chave criada (UMA VEZ) */}
      <Dialog
        open={!!newKeyResult}
        onOpenChange={(open) => {
          if (!open) {
            setNewKeyResult(null);
            setShowSecretKey(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Key className="h-5 w-5" />
              Chave criada com sucesso!
            </DialogTitle>
            <DialogDescription className="text-destructive font-medium">
              Copie e guarde as credenciais abaixo agora. Elas não poderão ser
              recuperadas após fechar esta janela.
            </DialogDescription>
          </DialogHeader>

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

          <DialogFooter>
            <Button
              onClick={() => {
                setNewKeyResult(null);
                setShowSecretKey(false);
              }}
            >
              Confirmar — já guardei as credenciais
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
