"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import {
  expenseSubmissionService,
  linkUrl,
} from "@/lib/services/expenseSubmissionService";
import { Entity, ReimbursementLink } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, MessageCircle } from "lucide-react";

const message = (name: string, url: string) =>
  `Olá, ${name.split(" ")[0]}! Por este link você manda a foto das notas das despesas que pagou do seu bolso e acompanha o reembolso: ${url}`;

/** wa.me com o celular do cadastro, se houver; senão o WhatsApp pergunta para quem. */
const whatsappUrl = (employee: Entity | undefined, text: string) => {
  const phone = employee?.phone?.replace(/\D/g, "");
  const to = phone ? (phone.length <= 11 ? `55${phone}` : phone) : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
};

export function SubmissionLinksDialog({
  open,
  onOpenChange,
  employees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Entity[];
}) {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: links = [], refetch } = useQuery({
    queryKey: ["reimbursement-links", selectedCompany?.id],
    queryFn: () => expenseSubmissionService.getLinks(selectedCompany!.id),
    enabled: open && !!selectedCompany,
  });

  const employee = employees.find((e) => e.id === employeeId);
  const current = links.find((l) => l.employeeId === employeeId);

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  };

  const generate = async () => {
    if (!employee || !user || !selectedCompany) return;
    setBusy("generate");
    try {
      const token = await expenseSubmissionService.createLink(
        selectedCompany.id,
        employee,
        user.uid,
        links,
      );
      await refetch();
      await copy(linkUrl(token));
    } catch (error) {
      console.error(error);
      toast.error("Erro ao gerar o link.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (link: ReimbursementLink) => {
    setBusy(link.id);
    try {
      await expenseSubmissionService.revokeLink(link.id);
      await refetch();
      toast.success(`Link de ${link.employeeName} desativado.`);
    } catch (error) {
      console.error(error);
      toast.error("Erro ao desativar o link.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-lg">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Links de envio de notas</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Cada funcionário recebe um link pessoal, sem login. Pelo celular ele
            fotografa a nota e acompanha o reembolso. O que ele envia cai na aba
            A reembolsar para você lançar ou recusar.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-2">
          <Label htmlFor="link-employee">Funcionário</Label>
          <div className="flex gap-2">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="link-employee" className="min-w-0 flex-1">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={generate}
              disabled={!employee || !!busy}
              loading={busy === "generate"}
            >
              {current ? "Gerar novo" : "Gerar link"}
            </Button>
          </div>
          {current && (
            <p className="text-xs text-muted-foreground">
              Gerar um novo desativa o link enviado em{" "}
              {format(current.createdAt, "dd/MM/yyyy")}.
            </p>
          )}
        </div>

        {links.length > 0 && (
          <ul className="mt-2 divide-y rounded-md border">
            {[...links]
              .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
              .map((link) => {
                const url = linkUrl(link.token);
                const emp = employees.find((e) => e.id === link.employeeId);
                return (
                  <li
                    key={link.id}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {link.employeeName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        desde {format(link.createdAt, "dd/MM/yyyy")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Copiar link"
                      aria-label={`Copiar link de ${link.employeeName}`}
                      onClick={() => copy(url)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Mandar pelo WhatsApp"
                      aria-label={`Mandar link para ${link.employeeName} pelo WhatsApp`}
                      asChild
                    >
                      <a
                        href={whatsappUrl(emp, message(link.employeeName, url))}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => revoke(link)}
                      loading={busy === link.id}
                      disabled={!!busy}
                    >
                      Desativar
                    </Button>
                  </li>
                );
              })}
          </ul>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
