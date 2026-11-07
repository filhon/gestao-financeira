"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ImagePlus, Loader2, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";
import { activeHref, flatNav, NAV } from "@/components/layout/navItems";
import { connectionAwareError } from "@/lib/errors";
import { feedbackText, responseDueAt } from "@/lib/feedback";
import { currentContext, installErrorCapture } from "@/lib/feedbackContext";
import { suggestFromManual } from "@/lib/playbook";
import { feedbackService } from "@/lib/services/feedbackService";
import { storageService } from "@/lib/services/storageService";
import { useFeedbackPanelStore } from "@/lib/store/useFeedbackPanelStore";
import type { FeedbackType } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const schema = z.object({ description: feedbackText });

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Problema" },
  { value: "question", label: "Dúvida" },
  { value: "improvement", label: "Ideia" },
  { value: "praise", label: "Elogio" },
];

const PROMPT: Record<FeedbackType, { label: string; hint?: string }> = {
  bug: {
    label: "O que aconteceu?",
    hint: "Diga o que você fez, o que esperava e o que apareceu.",
  },
  question: { label: "Qual é a sua dúvida?" },
  improvement: {
    label: "O que você precisa?",
    hint: "Ideias ficam no Roadmap: lá você vê se alguém já pediu e pode votar.",
  },
  praise: { label: "O que funcionou bem?" },
};

const OPTION =
  "cursor-pointer rounded-md border px-3 py-2 text-center text-sm transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-primary/5 peer-checked:font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-ring";

function screenName(pathname: string) {
  const items = flatNav(NAV);
  const href = activeHref(pathname, items);
  if (pathname === "/feedback") return "Meus chamados";
  return items.find((i) => i.href === href)?.title ?? pathname;
}

export function FeedbackPanel() {
  const { user } = useAuth();
  const { selectedCompany } = useCompany();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const open = useFeedbackPanelStore((s) => s.open);
  const setOpen = useFeedbackPanelStore((s) => s.setOpen);
  const presetType = useFeedbackPanelStore((s) => s.presetType);
  const clearPreset = useFeedbackPanelStore((s) => s.clearPreset);

  // O rascunho vive aqui, fora da folha: fechar o painel não apaga o que foi escrito.
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { description: "" },
  });
  const [type, setType] = useState<FeedbackType>("bug");
  const [blocksPayment, setBlocksPayment] = useState(false);
  const [image, setImage] = useState<{ url: string; path: string } | null>(
    null,
  );
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    id: string;
    protocol: string;
    dueAt: string | null;
  } | null>(null);
  // Nova tentativa usa o mesmo id: se só a resposta se perdeu, não duplica.
  const ticketId = useRef(uuidv4());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(installErrorCapture, []);

  useEffect(() => {
    if (!presetType) return;
    setType(presetType);
    clearPreset();
  }, [presetType, clearPreset]);

  const description = form.watch("description");
  const deferred = useDeferredValue(description);
  const suggestions = useMemo(
    () =>
      type === "bug" || type === "question" ? suggestFromManual(deferred) : [],
    [deferred, type],
  );

  const screen = screenName(pathname);
  // Recalculado ao abrir, porque a pessoa pode navegar com o painel aberto.
  const context = useMemo(
    () =>
      open && typeof window !== "undefined" ? currentContext(screen) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, screen, description.length === 0],
  );

  const removeImage = () => {
    if (image) storageService.deleteFile(image.path).catch(() => {});
    setImage(null);
    setImageError(null);
  };

  const uploadImage = async (file: File) => {
    if (!user) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setImageError("Use uma imagem PNG, JPG, GIF ou WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        "A imagem tem mais de 10 MB. Recorte ou reduza e tente de novo.",
      );
      return;
    }
    setImageError(null);
    setUploadPercent(0);
    try {
      if (image) storageService.deleteFile(image.path).catch(() => {});
      const uploaded = await storageService.uploadFile(
        file,
        `feedbacks/${user.uid}`,
        setUploadPercent,
      );
      setImage({ url: uploaded.url, path: uploaded.path });
    } catch (error) {
      console.error("Feedback image upload failed", error);
      setImageError(
        connectionAwareError(
          error,
          "Não foi possível anexar a imagem. Tente de novo.",
        ),
      );
    } finally {
      setUploadPercent(null);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (!file) return;
    e.preventDefault();
    void uploadImage(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void uploadImage(file);
  };

  const startOver = () => {
    form.reset({ description: "" });
    setType("bug");
    setBlocksPayment(false);
    setImage(null);
    setImageError(null);
    setSubmitError(null);
    setSent(null);
    ticketId.current = uuidv4();
  };

  const onSubmit = async ({ description }: z.infer<typeof schema>) => {
    if (!context) return;
    setSubmitError(null);
    try {
      const result = await feedbackService.create({
        id: ticketId.current,
        type: type as "bug" | "question" | "praise",
        description,
        blocksPayment: type === "bug" && blocksPayment,
        companyId: selectedCompany?.id ?? "",
        context: {
          screen: context.screen,
          url: context.url,
          browser: context.browser,
          viewport: context.viewport,
          errors: context.errors,
        },
        ...(image && { screenshotUrl: image.url }),
      });
      setSent(result);
      queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
    } catch (error) {
      setSubmitError(
        connectionAwareError(
          error,
          error instanceof Error ? error.message : "Não foi possível enviar.",
        ),
      );
    }
  };

  const goToRoadmap = () => {
    const text = description.trim().slice(0, 1000);
    startOver();
    setOpen(false);
    router.push(
      `/roadmap?nova=1${text ? `&texto=${encodeURIComponent(text)}` : ""}`,
    );
  };

  if (!user) return null;

  const due = responseDueAt(new Date(), type, type === "bug" && blocksPayment);
  const submitting = form.formState.isSubmitting;
  const uploading = uploadPercent !== null;

  return (
    // Sem modal: o problema continua visível, e dá para rolar e copiar da tela.
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetContent
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => sent && e.preventDefault()}
      >
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle className="text-lg tracking-tight">
            Falar com a equipe
          </SheetTitle>
          <SheetDescription>Sobre a tela {screen}</SheetDescription>
        </SheetHeader>

        {sent ? (
          <div className="space-y-4 px-5 py-6" role="status">
            <div>
              <p className="text-sm text-muted-foreground">
                Chamado registrado
              </p>
              <p className="font-mono text-xl font-semibold tabular-nums">
                {sent.protocol}
              </p>
            </div>
            <p className="text-sm">
              {sent.dueAt
                ? `Resposta prevista até ${format(new Date(sent.dueAt), "dd/MM/yyyy")}. Você é avisado aqui no sistema e por e-mail.`
                : "Recebemos sua mensagem. Obrigado por contar."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link
                  href={`/feedback?chamado=${sent.id}`}
                  onClick={() => {
                    startOver();
                    setOpen(false);
                  }}
                >
                  Ver meus chamados
                </Link>
              </Button>
              <Button variant="outline" onClick={startOver}>
                Abrir outro
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              onPaste={onPaste}
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              className="flex flex-1 flex-col"
            >
              <div className="flex-1 space-y-5 px-5 py-5">
                <fieldset>
                  <legend className="sr-only">
                    Sobre o que você quer falar?
                  </legend>
                  <div className="grid grid-cols-4 gap-1.5">
                    {TYPES.map((t) => (
                      <label key={t.value} className="block">
                        <input
                          type="radio"
                          name="feedback-type"
                          className="peer sr-only"
                          checked={type === t.value}
                          onChange={() => setType(t.value)}
                        />
                        <span className={cn("block", OPTION)}>{t.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{PROMPT[type].label}</FormLabel>
                      {PROMPT[type].hint && (
                        <p className="text-xs text-muted-foreground">
                          {PROMPT[type].hint}
                        </p>
                      )}
                      <FormControl>
                        <Textarea rows={6} autoFocus {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {suggestions.length > 0 && (
                  <div aria-live="polite" className="rounded-md border">
                    <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                      Talvez o manual já responda
                    </p>
                    {suggestions.map((s) => (
                      <details
                        key={s.href}
                        className="border-b px-3 py-2 last:border-b-0"
                      >
                        <summary className="cursor-pointer text-sm font-medium">
                          {s.q}
                        </summary>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {s.a}
                        </p>
                        <Link
                          href={s.href}
                          className="mt-1 inline-block text-xs underline underline-offset-4"
                        >
                          Abrir no manual
                        </Link>
                      </details>
                    ))}
                  </div>
                )}

                {type === "improvement" ? (
                  <Button type="button" onClick={goToRoadmap}>
                    Continuar no Roadmap
                  </Button>
                ) : (
                  <>
                    {type === "bug" && (
                      <fieldset>
                        <legend className="mb-1.5 text-sm font-medium">
                          Isso pode atrasar um pagamento hoje?
                        </legend>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { label: "Não", value: false },
                            { label: "Sim", value: true },
                          ].map((o) => (
                            <label key={o.label} className="block">
                              <input
                                type="radio"
                                name="feedback-blocks-payment"
                                className="peer sr-only"
                                checked={blocksPayment === o.value}
                                onChange={() => setBlocksPayment(o.value)}
                              />
                              <span className={cn("block", OPTION)}>
                                {o.label}
                              </span>
                            </label>
                          ))}
                        </div>
                        {blocksPayment && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            A equipe recebe um alerta de urgência assim que você
                            enviar.
                          </p>
                        )}
                      </fieldset>
                    )}

                    {type !== "praise" && (
                      <div>
                        <input
                          ref={fileInput}
                          type="file"
                          className="sr-only"
                          tabIndex={-1}
                          aria-hidden
                          accept={IMAGE_TYPES.join(",")}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            // Limpa para escolher o mesmo arquivo de novo.
                            e.target.value = "";
                            if (file) void uploadImage(file);
                          }}
                        />
                        {image ? (
                          <div className="relative overflow-hidden rounded-md border">
                            <Image
                              src={image.url}
                              alt="Imagem anexada ao chamado"
                              width={448}
                              height={160}
                              unoptimized
                              className="max-h-40 w-full object-contain"
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="absolute right-1.5 top-1.5 size-7"
                              onClick={removeImage}
                              aria-label="Remover imagem"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => fileInput.current?.click()}
                          >
                            {uploading ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ImagePlus className="size-4" />
                            )}
                            {uploading
                              ? `Enviando ${Math.round(uploadPercent ?? 0)}%`
                              : "Anexar imagem"}
                          </Button>
                        )}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {image
                            ? "Confira se a imagem não mostra dado que não deveria sair da empresa."
                            : "Ou cole com Ctrl+V, ou arraste para cá. PNG, JPG, GIF ou WebP, até 10 MB."}
                        </p>
                        {imageError && (
                          <p
                            role="alert"
                            className="mt-1 text-xs text-destructive"
                          >
                            {imageError}
                          </p>
                        )}
                      </div>
                    )}

                    {context && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          Vai junto: tela, empresa, perfil e navegador. Sem
                          gravação de tela.
                        </summary>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          <dt>Tela</dt>
                          <dd className="break-all text-foreground">
                            {context.screen} ({context.url})
                          </dd>
                          <dt>Empresa</dt>
                          <dd className="text-foreground">
                            {selectedCompany?.name ?? "Nenhuma selecionada"}
                          </dd>
                          <dt>Navegador</dt>
                          <dd className="text-foreground">
                            {context.browser}, janela {context.viewport}
                          </dd>
                          {context.errors.length > 0 && (
                            <>
                              <dt>Último erro</dt>
                              <dd className="wrap-break-word text-foreground">
                                {
                                  context.errors[context.errors.length - 1]
                                    .message
                                }
                              </dd>
                            </>
                          )}
                        </dl>
                      </details>
                    )}
                  </>
                )}
              </div>

              {type !== "improvement" && (
                <div className="sticky bottom-0 space-y-2 border-t bg-background px-5 py-3">
                  {submitError && (
                    <p role="alert" className="text-sm text-destructive">
                      {submitError} Seu texto continua aqui; é só tentar de
                      novo.
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {due
                        ? `Resposta prevista até ${format(due, "dd/MM/yyyy")}`
                        : "A equipe lê todos os elogios"}
                    </p>
                    <Button type="submit" disabled={submitting || uploading}>
                      {submitting && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      {submitError ? "Tentar de novo" : "Enviar"}
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </Form>
        )}
      </SheetContent>
    </Sheet>
  );
}
