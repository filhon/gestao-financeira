/** Arquivos do fechamento no Storage. Só no servidor. */
import { createHash } from "node:crypto";
import { adminStorage } from "@/lib/firebase/admin";
import {
  CLOSING_FILES,
  type ClosingFile,
  type StoredFile,
} from "@/lib/cashClosing";

const SIGNED_URL_MS = 10 * 60 * 1000;

const bucket = () =>
  adminStorage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);

/** Tamanho e hash do que está guardado, lidos do próprio arquivo. */
export async function storedFile(path: string): Promise<StoredFile | null> {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of file.createReadStream()) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return size > 0 ? { path, size, sha256: hash.digest("hex") } : null;
}

/** Endereço que vale minutos: o arquivo nunca fica público. */
export async function signedClosingUrl(
  path: string,
  period: string,
  version: number,
  file: ClosingFile,
) {
  const base = file === "package" ? "fechamento" : "sintese";
  const ext = file === "package" ? "zip" : "pdf";
  const [url] = await bucket()
    .file(path)
    .getSignedUrl({
      // v4: na v2 o nome gravado no arquivo vence o pedido aqui.
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_MS,
      responseDisposition: `attachment; filename="${base}_${period}_v${version}.${ext}"`,
      responseType: CLOSING_FILES[file].contentType,
    });
  return url;
}
