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

const IMAGE_QUALITY = 0.82;
const IMAGE_MAX_DIMENSION = 1920;

export async function compressToWebPBlob(file: File): Promise<Blob> {
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
        (blob) => {
          if (!blob) { reject(new Error("Falha ao comprimir imagem")); return; }
          resolve(blob);
        },
        "image/webp",
        IMAGE_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao carregar imagem"));
    };

    img.src = objectUrl;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload to object storage via the API server (no sidecar / presigned URL)
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadResult {
  objectPath: string;
}

export async function uploadToStorage(
  blob: Blob,
  contentType: string,
  token: string,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  // XHR for progress events; fetch API does not support upload progress yet
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/storage/uploads/direct");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { objectPath: string };
          resolve(data);
        } catch {
          reject(new Error("Resposta inválida do servidor"));
        }
      } else {
        let message = "Falha ao enviar arquivo. Tente novamente.";
        try {
          const err = JSON.parse(xhr.responseText) as { error?: string };
          if (err.error) message = err.error;
        } catch { /* ignore */ }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Erro de conexão ao enviar arquivo."));
    xhr.onabort = () => reject(new Error("Upload cancelado."));

    xhr.send(blob);
  });
}
