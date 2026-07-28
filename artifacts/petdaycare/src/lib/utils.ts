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
 * - /objects/ paths (Object Storage) → prefixed with /api/storage
 * - null/undefined → null
 */
export function resolvePhotoUrl(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("data:")) return photoUrl;
  if (photoUrl.startsWith("/objects/")) return `/api/storage${photoUrl}`;
  return photoUrl;
}

/**
 * Upload a file:
 * - Images (image/*): compressed to base64 WebP on the client — zero server round-trip,
 *   works everywhere regardless of GCS/sidecar availability.
 * - Other files (video, PDF, …): sent as raw bytes to the server-side direct-upload endpoint.
 *
 * Returns a string that can be stored in the DB as a photo/media URL:
 * - images  → "data:image/webp;base64,…"
 * - others  → "/objects/uploads/<uuid>"
 */
export async function uploadFileDirect(file: File, token: string): Promise<string> {
  if (file.type.startsWith("image/")) {
    return compressImage(file);
  }

  // Non-image files (video, PDF, …) — server-side upload
  const res = await fetch("/api/storage/uploads/direct", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      Authorization: `Bearer ${token}`,
    },
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Falha ao enviar arquivo. Tente novamente.");
  }
  const { objectPath } = await res.json();
  return objectPath as string;
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}
