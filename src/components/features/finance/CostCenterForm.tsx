"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CostCenterFormData,
  costCenterSchema,
} from "@/lib/validations/costCenter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CostCenter, UserProfile, UserRole } from "@/lib/types";
import { useCompany } from "@/components/providers/CompanyProvider";
import { userService } from "@/lib/services/userService";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CostCenterFormProps {
  defaultValues?: CostCenterFormData;
  onSubmit: (data: CostCenterFormData) => Promise<void>;
  isLoading: boolean;
  onCancel: () => void;
  availableCostCenters: CostCenter[];
  editingId?: string | null;
}

/** Valor do Select para "ninguém": o Radix não aceita string vazia. */
const NONE = "__none__";

// Mesmos papéis que o servidor aceita em cada transição (STATUS_ROLES).
const APPROVER_ROLES: UserRole[] = ["admin", "financial_manager", "approver"];
const RELEASER_ROLES: UserRole[] = ["admin", "financial_manager", "releaser"];

/**
 * Responsável escolhido entre os usuários com o papel certo, não digitado.
 * Grava o e-mail, que é a chave que a fila, o perfil e o e-mail de aprovação
 * já usam. Um e-mail antigo que não bate com ninguém continua visível, para o
 * gestor ver o que está lá e trocar.
 */
function ResponsibleSelect({
  value,
  onChange,
  candidates,
  label,
}: {
  value?: string;
  onChange: (email: string) => void;
  candidates: UserProfile[];
  label: string;
}) {
  const orphan =
    value && !candidates.some((u) => u.email === value) ? value : null;
  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <FormControl>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        <SelectItem value={NONE}>Ninguém definido</SelectItem>
        {orphan && (
          <SelectItem value={orphan}>{orphan} (sem usuário ativo)</SelectItem>
        )}
        {candidates.map((u) => (
          <SelectItem key={u.uid} value={u.email}>
            {u.displayName}{" "}
            <span className="text-xs text-muted-foreground">({u.email})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CostCenterForm({
  defaultValues,
  onSubmit,
  isLoading,
  onCancel,
  availableCostCenters,
  editingId,
}: CostCenterFormProps) {
  const { selectedCompany } = useCompany();
  const [users, setUsers] = useState<UserProfile[]>([]);

  const form = useForm<CostCenterFormData>({
    resolver: zodResolver(costCenterSchema),
    defaultValues: defaultValues || {
      name: "",
      code: "",
      description: "",
      parentId: "none",
      allowedUserIds: [],
      approverEmail: "",
      releaserEmail: "",
    },
  });

  useEffect(() => {
    const loadUsers = async () => {
      if (selectedCompany) {
        try {
          const data = await userService.getAll(selectedCompany.id);
          setUsers(data);
        } catch (error) {
          console.error("Error loading users:", error);
        }
      }
    };
    loadUsers();
  }, [selectedCompany]);

  const roleOf = (u: UserProfile): UserRole | undefined =>
    u.role === "admin"
      ? "admin"
      : selectedCompany
        ? u.companyRoles?.[selectedCompany.id]
        : undefined;
  const withRole = (roles: UserRole[]) =>
    users.filter((u) => {
      const role = roleOf(u);
      return !!role && roles.includes(role);
    });
  // A restrição por centro só vale para o papel `user` (`getAll` filtra por
  // `allowedUserIds` apenas para ele); os demais papéis lançam em qualquer um.
  const restrictedUsers = users.filter((u) => roleOf(u) === "user");

  // Compute all descendant IDs of the CC being edited to prevent circular hierarchy (BUG-02)
  const descendantIds = useMemo(() => {
    if (!editingId) return new Set<string>();
    const result = new Set<string>();
    const queue = [editingId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      availableCostCenters.forEach((cc) => {
        if (cc.parentId === current && !result.has(cc.id)) {
          result.add(cc.id);
          queue.push(cc.id);
        }
      });
    }
    return result;
  }, [editingId, availableCostCenters]);

  // Filter out self and all descendants to prevent circular references.
  // Arquivado não recebe filho novo; o pai atual fica na lista para o select
  // continuar mostrando o valor.
  const potentialParents = availableCostCenters.filter(
    (cc) =>
      cc.id !== editingId &&
      !descendantIds.has(cc.id) &&
      (!cc.archived || cc.id === defaultValues?.parentId),
  );

  // A empresa tem exatamente um centro raiz — é ele que recebe as receitas e
  // distribui o envelope. Um segundo derruba os saldos de todas as telas ao
  // mesmo tempo, então a opção "Nenhum (Raiz)" só aparece quando ainda não há
  // raiz, ou quando é a própria raiz que está sendo editada. O serviço repete a
  // checagem: aqui é conveniência, lá é a garantia.
  const existingRoot = availableCostCenters.find(
    (cc) => !cc.parentId || cc.parentId === "none",
  );
  const canBeRoot = !existingRoot || existingRoot.id === editingId;

  // Build depth map for hierarchical display in parent selector
  const depthMap = useMemo(() => {
    const map = new Map<string, number>();
    const getDepth = (id: string): number => {
      if (map.has(id)) return map.get(id)!;
      const cc = availableCostCenters.find((c) => c.id === id);
      if (!cc || !cc.parentId || cc.parentId === "none") {
        map.set(id, 0);
        return 0;
      }
      const depth = getDepth(cc.parentId) + 1;
      map.set(id, depth);
      return depth;
    };
    availableCostCenters.forEach((cc) => getDepth(cc.id));
    return map;
  }, [availableCostCenters]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-7">
            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Centro de custo pai
                    {canBeRoot ? " (opcional)" : ""}
                  </FormLabel>
                  <Select
                    onValueChange={(value) =>
                      field.onChange(value === "none" ? undefined : value)
                    }
                    defaultValue={field.value || "none"}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {canBeRoot && (
                        <SelectItem value="none">Nenhum (raiz)</SelectItem>
                      )}
                      {potentialParents.map((cc) => {
                        const depth = depthMap.get(cc.id) ?? 0;
                        return (
                          <SelectItem key={cc.id} value={cc.id}>
                            <span className="flex items-center gap-1">
                              {depth > 0 && (
                                <span
                                  className="text-muted-foreground/50"
                                  style={{
                                    paddingLeft: `${(depth - 1) * 12}px`,
                                  }}
                                >
                                  {"↳ "}
                                </span>
                              )}
                              <span>
                                {cc.code} · {cc.name}
                              </span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {!canBeRoot && (
                    <FormDescription>
                      {existingRoot?.name} é o centro raiz da empresa; todo
                      centro novo fica abaixo dele.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-2">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: CC-001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12 md:col-span-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Marketing" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="col-span-12">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Para que serve este centro de custo"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-4 border-t pt-4">
          <h3 className="text-base font-medium">Responsáveis</h3>

          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-6">
              <FormField
                control={form.control}
                name="approverEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aprovador</FormLabel>
                    <ResponsibleSelect
                      label="Aprovador"
                      value={field.value}
                      onChange={field.onChange}
                      candidates={withRole(APPROVER_ROLES)}
                    />
                    <FormDescription>
                      Recebe as despesas deste centro para aprovar.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-12 md:col-span-6">
              <FormField
                control={form.control}
                name="releaserEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Liberador</FormLabel>
                    <ResponsibleSelect
                      label="Liberador"
                      value={field.value}
                      onChange={field.onChange}
                      candidates={withRole(RELEASER_ROLES)}
                    />
                    <FormDescription>
                      Efetua o pagamento das despesas aprovadas.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {restrictedUsers.length > 0 && (
            <FormField
              control={form.control}
              name="allowedUserIds"
              render={() => (
                <FormItem>
                  <div>
                    <FormLabel>Usuários que lançam aqui</FormLabel>
                    <FormDescription>
                      Vale só para o papel Usuário; os demais papéis lançam em
                      qualquer centro.
                    </FormDescription>
                  </div>
                  <ScrollArea className="max-h-[200px] w-full rounded-md border px-4 py-2">
                    {restrictedUsers.map((user) => (
                      <FormField
                        key={user.uid}
                        control={form.control}
                        name="allowedUserIds"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 py-2">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(user.uid)}
                                onCheckedChange={(checked) =>
                                  checked
                                    ? field.onChange([
                                        ...(field.value || []),
                                        user.uid,
                                      ])
                                    : field.onChange(
                                        field.value?.filter(
                                          (value) => value !== user.uid,
                                        ),
                                      )
                                }
                              />
                            </FormControl>
                            <FormLabel className="font-normal">
                              {user.displayName}{" "}
                              <span className="text-xs text-muted-foreground">
                                ({user.email})
                              </span>
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </ScrollArea>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button type="submit" loading={isLoading}>
            Salvar
          </Button>
        </div>
      </form>
    </Form>
  );
}
