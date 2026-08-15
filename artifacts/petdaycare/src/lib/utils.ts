import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function compressImage(file: File, maxWidth = 1080, quality = 0.82): Promise<string> {
  // createImageBitmap automatically applies EXIF orientation on iOS/Safari,
  // so photos taken with iPhone cameras render the right way up.
  // Falls back to the classic FileReader path on browsers that don't support it.
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(bitmap.width  * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/webp", quality);
  }

  // Legacy fallback (older browsers)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", quality));
      };
      img.onerror = reject;
      img.src = ev.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Resolve a pet/booking photo URL.
 * - data: URIs (legacy base64) → returned as-is
 * - /objects/ paths (Object Storage) → /api/storage/objects/... + ?mt= token
 *   so <img> tags can load private objects without an Authorization header
 * - null/undefined → null
 */
export function resolvePhotoUrl(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("data:")) return photoUrl;
  if (photoUrl.startsWith("/objects/")) {
    const withoutPrefix = photoUrl.replace(/^\/objects\//, "");
    const mt = localStorage.getItem("media_token") ?? "";
    return `/api/storage/objects/${withoutPrefix}${mt ? `?mt=${encodeURIComponent(mt)}` : ""}`;
  }
  return photoUrl;
}

/**
 * Compress an image File to a WebP Blob (not base64).
 * Uses createImageBitmap for EXIF-aware rotation (iOS/Safari), falls back to
 * FileReader + <img> on older browsers.
 */
async function compressImageToBlob(file: File, maxWidth = 1080, quality = 0.82): Promise<Blob> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      const ratio = Math.min(1, maxWidth / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(bitmap.width  * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao comprimir imagem"))),
          "image/webp",
          quality,
        );
      });
    } catch {
      // F4: createImageBitmap failed for this format (e.g. HEIC on some browsers).
      // Fall through to the FileReader path below, which handles HEIC on iOS Safari.
    }
  }

  // Legacy fallback: FileReader + <img> handles formats that createImageBitmap
  // cannot decode (e.g. HEIC on iOS Safari, older browsers).
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao comprimir imagem"))),
          "image/webp",
          quality,
        );
      };
      img.onerror = reject;
      img.src = ev.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file to Replit Object Storage via the server-side /direct endpoint.
 *
 * - Images (image/*): compressed client-side to WebP, then uploaded as blob
 * - Other files (video, PDF, …): sent as raw bytes
 *
 * Always returns an objectPath ("/objects/uploads/…") suitable for DB storage.
 * Legacy base64 data: URIs are no longer produced by this function.
 */
export async function uploadFileDirect(file: File, token: string): Promise<string> {
  let body: Blob;
  let contentType: string;

  if (file.type.startsWith("image/")) {
    body = await compressImageToBlob(file);
    contentType = "image/webp";
  } else {
    body = file;
    // F4: infer MIME from file extension when file.type is empty (some browsers/
    // platforms omit it for video files). Unknown extensions keep the fallback so
    // the server can reject them explicitly (415) rather than silently accepting
    // an unreadable stream.
    let rawType = file.type;
    if (!rawType) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const mimeByExt: Record<string, string> = {
        mp4: "video/mp4",
        mov: "video/quicktime",
        webm: "video/webm",
      };
      rawType = mimeByExt[ext] ?? "application/octet-stream";
    }
    contentType = rawType;
  }

  const uploadRes = await fetch("/api/storage/uploads/direct", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${token}`,
    },
    body,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error((err as any).error || "Falha ao enviar o arquivo. Tente novamente.");
  }
  const { objectPath } = await uploadRes.json();
  return objectPath as string;
}

/**
 * Format a centavo (integer cents) amount as a Brazilian Real currency string.
 * Convention: all financial values in this system are stored as integer centavos
 * (e.g. 5000 = R$ 50,00). This function divides by 100 before formatting.
 */
export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}
