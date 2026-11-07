"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Camera, FileText, Loader2, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import {
  flagMessage,
  type ReceiptFlag,
} from "@/lib/reimbursement/receiptChecks";

interface Submission {
  id: string;
  status: "pending" | "launched" | "refused";
  stage?: string;
  detail?: string;
  description: string;
  amount: number | null;
  date: string | null;
  supplierName: string | null;
  note: string;
  flags: ReceiptFlag[];
  attachment: { url?: string; type?: string };
  createdAt: string | null;
}

type PendingUpload = {
  key: string;
  file: File;
  /** Bytes enviados; ao chegar a 100, o servidor está lendo a nota. */
  percent: number;
  error?: string;
};

const API = "/api/internal/expense-submission";

/** `fetch` não informa o envio: só o XHR diz quantos bytes já saíram. */
function postWithProgress(
  body: FormData,
  onProgress: (percent: number) => void,
) {
  return new Promise<{ ok: boolean; data: Submission & { error?: string } }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", API);
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = () =>
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          data: xhr.response ?? {},
        });
      xhr.onerror = () =>
        reject(new Error("Sem conexão. Confira a internet e tente de novo."));
      xhr.send(body);
    },
  );
}

/** Foto de celular passa fácil de 5 MB: reduz para ~2000 px antes de subir. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85),
  );
}

const STAGE_STYLE: Record<string, string> = {
  Recebida: "bg-muted text-muted-foreground",
  Lançada: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  "Em relatório":
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  Paga: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  Recusada: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

const dayLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      })
    : "sem data";

export default function EnviarDespesaPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "ready" | "invalid">(
    "loading",
  );
  const [companyName, setCompanyName] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [items, setItems] = useState<Submission[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API}?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        setCompanyName(data.companyName);
        setEmployeeName(data.employeeName);
        setItems(data.submissions);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const patchUpload = (key: string, patch: Partial<PendingUpload>) =>
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /** Uma foto com erro fica na lista com a própria nova tentativa; as outras seguem. */
  const sendOne = async (key: string, file: File) => {
    patchUpload(key, { error: undefined, percent: 0 });
    try {
      const body = new FormData();
      body.append("token", token);
      const blob = await shrink(file);
      body.append(
        "file",
        blob,
        blob === file ? file.name : file.name.replace(/\.\w+$/, "") + ".jpg",
      );
      const { ok, data } = await postWithProgress(body, (percent) =>
        patchUpload(key, { percent }),
      );
      if (!ok) throw new Error(data.error);
      setItems((list) => [{ ...data, stage: "Recebida" }, ...list]);
      // Leitura com problema: já abre para o funcionário conferir.
      if (data.flags.length) setOpenId(data.id);
      setUploads((u) => u.filter((x) => x.key !== key));
    } catch (error) {
      patchUpload(key, {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Falhou. Tente de novo.",
      });
    }
  };

  const send = async (files: FileList | null) => {
    const added = Array.from(files ?? []).map((file) => ({
      key: `${file.name}-${Math.random()}`,
      file,
      percent: 0,
    }));
    setUploads((u) => [...u, ...added]);
    for (const { key, file } of added) await sendOne(key, file);
  };

  if (state === "loading")
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );

  if (state === "invalid")
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-lg font-semibold">Link inválido</p>
          <p className="text-sm text-muted-foreground">
            Este link foi trocado ou desativado. Peça um novo ao financeiro.
          </p>
        </div>
      </main>
    );

  const firstName = employeeName.split(" ")[0];
  const open = items.filter((i) => i.status === "pending");
  const pendingTotal = open.reduce((s, i) => s + (i.amount ?? 0), 0);

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto max-w-md px-4 pt-6 pb-16">
        <p className="text-xs text-muted-foreground">{companyName}</p>
        <h1 className="mt-0.5 text-xl font-semibold">Olá, {firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mande a nota de cada despesa que você pagou do seu bolso. A foto
          inteira, sem cortar o QR code.
        </p>

        <div className="mt-5 grid gap-2">
          <Button
            size="lg"
            className="h-14 text-base"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="mr-2 h-5 w-5" />
            Fotografar nota
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Enviar foto ou PDF
          </Button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void send(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              void send(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {uploads.length > 0 && (
          <ul className="mt-4 space-y-2" aria-live="polite">
            {uploads.map((u) => (
              <li
                key={u.key}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm",
                  u.error && "border-red-300 dark:border-red-900",
                )}
              >
                {u.error ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {u.error
                    ? `${u.file.name}: ${u.error}`
                    : u.percent < 100
                      ? `${u.file.name}: enviando ${Math.round(u.percent)}%`
                      : `${u.file.name}: lendo a nota…`}
                </span>
                {u.error && (
                  <>
                    <button
                      className="text-xs font-medium underline"
                      onClick={() => void sendOne(u.key, u.file)}
                    >
                      Tentar de novo
                    </button>
                    <button
                      className="text-xs text-muted-foreground underline"
                      onClick={() =>
                        setUploads((list) =>
                          list.filter((x) => x.key !== u.key),
                        )
                      }
                    >
                      Fechar
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Suas notas</h2>
          {open.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {open.length} aguardando · {formatCurrency(pendingTotal)}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nenhuma nota enviada ainda.
          </p>
        ) : (
          <ul className="mt-3 divide-y rounded-md border">
            {items.map((item) => (
              <SubmissionRow
                key={item.id}
                item={item}
                token={token}
                open={openId === item.id}
                onToggle={() =>
                  setOpenId((id) => (id === item.id ? null : item.id))
                }
                onChange={(next) =>
                  setItems((list) =>
                    next
                      ? list.map((x) =>
                          x.id === next.id ? { ...x, ...next } : x,
                        )
                      : list.filter((x) => x.id !== item.id),
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function SubmissionRow({
  item,
  token,
  open,
  onToggle,
  onChange,
}: {
  item: Submission;
  token: string;
  open: boolean;
  onToggle: () => void;
  onChange: (next: Submission | null) => void;
}) {
  const editable = item.status === "pending";
  const [form, setForm] = useState({
    description: item.description,
    amount: item.amount != null ? String(item.amount).replace(".", ",") : "",
    date: item.date ? item.date.slice(0, 10) : "",
    note: item.note,
  });
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState("");
  const isImage = item.attachment.type?.startsWith("image/");

  const call = async (method: "PATCH" | "DELETE", body: object) => {
    setBusy(method === "PATCH" ? "save" : "delete");
    setError("");
    try {
      const res = await fetch(API, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, id: item.id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChange(method === "DELETE" ? null : { ...item, ...data });
      if (method === "PATCH") onToggle();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Falhou.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={!editable}
        className="flex w-full items-center gap-3 px-3 py-3 text-left disabled:cursor-default"
        aria-expanded={editable ? open : undefined}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
          {isImage && item.attachment.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.attachment.url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {item.description}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {dayLabel(item.date)} ·{" "}
            {item.amount != null ? formatCurrency(item.amount) : "sem valor"}
          </span>
          {item.detail && item.status !== "pending" && (
            <span className="block truncate text-xs text-muted-foreground">
              {item.detail}
            </span>
          )}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-2 py-0.5 text-xs font-medium",
            STAGE_STYLE[item.stage ?? "Recebida"],
          )}
        >
          {item.stage ?? "Recebida"}
        </span>
      </button>

      {editable && item.flags.length > 0 && !open && (
        <p className="-mt-1 px-3 pb-3 pl-18 text-xs text-amber-700 dark:text-amber-400">
          {item.flags.map(flagMessage).join(" ")} Toque para conferir.
        </p>
      )}

      {editable && open && (
        <div className="space-y-3 border-t bg-muted/30 px-3 py-3">
          {item.flags.length > 0 && (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {item.flags.map(flagMessage).join(" ")}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor={`d-${item.id}`}>O que foi</Label>
            <Input
              id={`d-${item.id}`}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor={`a-${item.id}`}>Valor (R$)</Label>
              <Input
                id={`a-${item.id}`}
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`t-${item.id}`}>Data</Label>
              <Input
                id={`t-${item.id}`}
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`n-${item.id}`}>
              Para que foi{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Textarea
              id={`n-${item.id}`}
              rows={2}
              placeholder="Ex.: almoço com cliente, visita à obra de Recife."
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <Button
              className="flex-1"
              loading={busy === "save"}
              disabled={!!busy}
              onClick={() =>
                call("PATCH", {
                  ...form,
                  amount: form.amount.replace(/\./g, "").replace(",", "."),
                })
              }
            >
              Salvar
            </Button>
            <Button
              variant="ghost"
              className="text-red-600"
              loading={busy === "delete"}
              disabled={!!busy}
              onClick={() => call("DELETE", {})}
            >
              Remover
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
