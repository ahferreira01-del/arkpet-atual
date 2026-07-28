import { Request, Response, NextFunction } from "express";

interface UploadRule {
  maxBytes: number;
  label: string;
}

const ALLOWED: Map<string, UploadRule> = new Map([
  ["image/jpeg",      { maxBytes: 10_000_000, label: "foto" }],
  ["image/jpg",       { maxBytes: 10_000_000, label: "foto" }],
  ["image/png",       { maxBytes: 10_000_000, label: "foto" }],
  ["image/webp",      { maxBytes: 10_000_000, label: "foto" }],
  ["video/mp4",       { maxBytes: 100_000_000, label: "vídeo" }],
  ["video/quicktime", { maxBytes: 100_000_000, label: "vídeo" }],
  ["video/webm",      { maxBytes: 100_000_000, label: "vídeo" }],
]);

export function validateUpload(req: Request, res: Response, next: NextFunction): void {
  // Extract base MIME type (ignore "; charset=utf-8" etc.)
  const rawContentType = req.headers["content-type"] ?? "";
  const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

  const rule = ALLOWED.get(mimeType);
  if (!rule) {
    res.status(415).json({
      error:
        "Tipo de arquivo não permitido. Formatos aceitos: JPG, PNG, WebP (fotos) e MP4, MOV, WebM (vídeos).",
    });
    return;
  }

  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  if (!Number.isNaN(contentLength) && contentLength > rule.maxBytes) {
    const limitMB = rule.maxBytes / 1_000_000;
    res.status(413).json({
      error: `A ${rule.label} excede o tamanho máximo de ${limitMB} MB.`,
    });
    return;
  }

  next();
}
