import type { MediaValidationResult, MediaType } from "../types/feed.types";

// ─────────────────────────────────────────────────────────────────────────────
// Validation rules
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_IMAGE_BYTES = 10_000_000; // 10 MB
const MAX_VIDEO_BYTES = 100_000_000; // 100 MB
const MAX_VIDEO_DURATION_SECONDS = 120;

export function getMediaType(file: File): MediaType | null {
  if (ALLOWED_IMAGE_TYPES.has(file.type)) return "photo";
  if (ALLOWED_VIDEO_TYPES.has(file.type)) return "video";
  return null;
}

async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível verificar a duração do vídeo."));
    };
    video.src = url;
  });
}

export async function validateMediaFile(file: File): Promise<MediaValidationResult> {
  const mediaType = getMediaType(file);

  if (!mediaType) {
    return {
      valid: false,
      error:
        "Tipo de arquivo não permitido. Use JPG, PNG ou WebP para fotos e MP4, MOV ou WebM para vídeos.",
    };
  }

  if (mediaType === "photo") {
    if (file.size > MAX_IMAGE_BYTES) {
      return { valid: false, error: "A foto excede o tamanho máximo de 10 MB." };
    }
  }

  if (mediaType === "video") {
    if (file.size > MAX_VIDEO_BYTES) {
      return { valid: false, error: "O vídeo excede o tamanho máximo de 100 MB." };
    }
    try {
      const duration = await getVideoDuration(file);
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        return {
          valid: false,
          error: `O vídeo excede a duração máxima de ${MAX_VIDEO_DURATION_SECONDS} segundos.`,
        };
      }
    } catch {
      return { valid: false, error: "Não foi possível verificar a duração do vídeo." };
    }
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image compression → WebP Blob (no base64 at any point)
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE_QUALITY = 0.90;
const IMAGE_MAX_DIMENSION = 1920;

/**
 * Compress a photo to WebP, respecting EXIF orientation.
 *
 * iPhone photos are stored as landscape with an EXIF rotation tag — drawing
 * them directly onto a canvas produces a sideways/rotated result.
 * `createImageBitmap({ imageOrientation: "from-image" })` decodes the frame
 * already rotated correctly (Safari ≥ 15.4, Chrome ≥ 64, Firefox ≥ 93).
 * We fall back to the plain <img> path for older browsers where the option
 * is not supported; those users may still see rotation issues but the upload
 * will not break.
 */
export async function compressToWebPBlob(file: File): Promise<Blob> {
  // ── preferred path: EXIF-aware bitmap ────────────────────────────────────
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);

    let { width, height } = bitmap;
    if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
      const ratio = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height);
      width  = Math.round(width  * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement("canvas");
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas não disponível");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao comprimir imagem"))),
        "image/webp",
        IMAGE_QUALITY,
      );
    });
  } catch {
    // ── fallback: plain <img> (no EXIF correction) ──────────────────────────
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
        const ratio = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas não disponível")); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao comprimir imagem"))),
        "image/webp",
        IMAGE_QUALITY,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Falha ao carregar imagem")); };
    img.src = objectUrl;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-step upload: request presigned PUT URL → PUT directly to GCS
//
// This avoids routing the file through the Express server (which would need
// the sidecar signed-URL approach that was failing), and is the canonical
// Replit Object Storage pattern: the server only generates the URL (JSON),
// the browser PUTs the bytes straight to GCS.
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadResult {
  objectPath: string;
}

export async function uploadToStorage(
  blob: Blob,
  contentType: string,
  token: string,
  crecheId: number,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/storage/uploads/direct");
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          resolve({ objectPath: res.objectPath });
        } catch {
          reject(new Error("Resposta inválida do servidor."));
        }
      } else {
        let errorMsg = `Falha ao enviar arquivo (${xhr.status}).`;
        try {
          const errRes = JSON.parse(xhr.responseText);
          if (errRes.error) errorMsg = errRes.error;
        } catch {}
        reject(new Error(errorMsg));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de conexão ao enviar arquivo."));
    xhr.onabort = () => reject(new Error("Upload cancelado."));

    xhr.send(blob);
  });
}
