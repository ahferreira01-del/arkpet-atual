import { Router, raw, type Response } from "express";
import { authenticate, type AuthRequest } from "../../middlewares/authenticate.js";
import { ASSISTANT_CONFIG } from "../assistant.config.js";
import { SttProviderFactory } from "./stt-provider.factory.js";
import { VoiceError } from "./stt-provider.types.js";
import { logger } from "../../lib/logger.js";

const voiceRouter = Router();

// Rate limiting state per user ID for voice requests (in-memory)
const voiceRateLimitMap = new Map<number, { count: number; windowStart: number }>();

function voiceRateLimiter(req: AuthRequest, res: Response, next: () => void) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado", code: "UNAUTHORIZED" });
    return;
  }

  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = voiceRateLimitMap.get(userId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }

  voiceRateLimitMap.set(userId, entry);

  // Maximum 30 voice transcriptions per minute per user
  if (entry.count > 30) {
    res.status(429).json({
      error: "Muitas requisições de áudio. Por favor, aguarde um momento.",
      code: "VOICE_PROVIDER_RATE_LIMIT",
    });
    return;
  }

  next();
}

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(delimiter, start);
  while (idx !== -1) {
    if (idx > start) {
      parts.push(buf.subarray(start, idx));
    }
    start = idx + delimiter.length;
    idx = buf.indexOf(delimiter, start);
  }
  if (start < buf.length) {
    parts.push(buf.subarray(start));
  }
  return parts;
}

function extractAudioFromRequest(req: AuthRequest): {
  audioBuffer: Buffer;
  mimeType: string;
  filename?: string;
} {
  const headerContentType = (req.headers["content-type"] || "").toLowerCase();
  const rawBody = req.body as Buffer;

  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new VoiceError("VOICE_EMPTY_AUDIO", "Arquivo de áudio vazio ou inválido.", 400);
  }

  if (headerContentType.includes("multipart/form-data")) {
    const boundaryMatch = headerContentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      throw new VoiceError("VOICE_INVALID_AUDIO", "Formato multipart inválido.", 400);
    }
    const boundary = boundaryMatch[1].trim().replace(/^["']|["']$/g, "");
    const boundaryBuffer = Buffer.from(`--${boundary}`);

    const parts = splitBuffer(rawBody, boundaryBuffer);
    for (const part of parts) {
      const headerEndIndex = part.indexOf("\r\n\r\n");
      if (headerEndIndex === -1) continue;

      const headerText = part.subarray(0, headerEndIndex).toString("utf-8");
      let bodyBuffer = part.subarray(headerEndIndex + 4);

      if (bodyBuffer.length >= 2 && bodyBuffer[bodyBuffer.length - 2] === 13 && bodyBuffer[bodyBuffer.length - 1] === 10) {
        bodyBuffer = bodyBuffer.subarray(0, bodyBuffer.length - 2);
      }

      if (headerText.includes('name="file"') || headerText.includes('name="audio"')) {
        const mimeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);
        const fileMime = mimeMatch ? mimeMatch[1].trim().toLowerCase() : "audio/webm";
        const fnMatch = headerText.match(/filename="([^"]+)"/i);
        const filename = fnMatch ? fnMatch[1] : undefined;
        return { audioBuffer: bodyBuffer, mimeType: fileMime, filename };
      }
    }

    throw new VoiceError("VOICE_INVALID_AUDIO", "Campo de arquivo de áudio não encontrado no formulário multipart.", 400);
  }

  const baseMime = headerContentType.split(";")[0].trim().toLowerCase();
  return {
    audioBuffer: rawBody,
    mimeType: baseMime || "audio/webm",
  };
}

function normalizeAndValidateMime(rawMime: string): string {
  const base = rawMime.split(";")[0].trim().toLowerCase();
  const aliasMap: Record<string, string> = {
    "audio/x-wav": "audio/wav",
    "audio/mp3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
  };
  const normalized = aliasMap[base] || base;

  const isAllowed = (ASSISTANT_CONFIG.allowedAudioMimeTypes as readonly string[]).includes(normalized);
  if (!isAllowed) {
    throw new VoiceError(
      "VOICE_INVALID_AUDIO",
      `Formato de áudio "${normalized}" não suportado. Formatos aceitos: webm, ogg, wav, mp3, mp4.`,
      400
    );
  }

  return normalized;
}

// All voice routes require authentication
voiceRouter.use(authenticate);

/**
 * POST /api/assistant/voice/transcribe
 *
 * Ephemeral Speech-to-Text transcription endpoint.
 * Zero audio persistence, zero database records, zero object storage bucket writes.
 */
voiceRouter.post(
  "/transcribe",
  voiceRateLimiter,
  raw({ type: "*/*", limit: "15mb" }),
  async (req: AuthRequest, res: Response) => {
    const requestId =
      (req as any).id ||
      (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined) ||
      `req-voice-${Date.now()}`;

    // 1. Kill Switch verification
    if (ASSISTANT_CONFIG.isKillSwitchActive) {
      res.status(503).json({
        error: "O assistente e o recurso de voz estão temporariamente desativados.",
        code: "VOICE_DISABLED",
        requestId,
      });
      return;
    }

    // 2. Voice Feature Flag verification
    if (!ASSISTANT_CONFIG.isVoiceEnabled) {
      res.status(403).json({
        error: "O recurso de voz está desativado no momento.",
        code: "VOICE_DISABLED",
        requestId,
      });
      return;
    }

    try {
      // 3. Extract and validate audio buffer
      const { audioBuffer, mimeType: extractedMime, filename } = extractAudioFromRequest(req);

      // 4. Validate audio size limit (VOICE_MAX_UPLOAD_BYTES = 10 MB)
      if (audioBuffer.length > ASSISTANT_CONFIG.voiceMaxUploadBytes) {
        throw new VoiceError(
          "VOICE_TOO_LARGE",
          "O arquivo de áudio excede o limite máximo permitido de 10 MB.",
          413
        );
      }

      // 5. Validate empty audio
      if (audioBuffer.length === 0) {
        throw new VoiceError("VOICE_EMPTY_AUDIO", "Arquivo de áudio vazio ou inválido.", 400);
      }

      // 6. Validate and normalize MIME type
      const mimeType = normalizeAndValidateMime(extractedMime);

      // 7. Invoke Speech-To-Text Provider
      const provider = SttProviderFactory.getProvider();
      const startTime = Date.now();
      const result = await provider.transcribe({
        audioBuffer,
        mimeType,
        filename,
        model: ASSISTANT_CONFIG.voiceSttModel,
        language: ASSISTANT_CONFIG.voiceSttLanguage,
      });

      const totalLatencyMs = Date.now() - startTime;

      // 8. Check for empty transcript (silence / unintelligible audio)
      if (!result.transcript || result.transcript.trim().length === 0) {
        res.status(400).json({
          error: "Não consegui identificar fala nesse áudio.",
          code: "VOICE_EMPTY_TRANSCRIPT",
          requestId,
        });
        return;
      }

      // 9. Operational telemetry (RAW_VOICE_TRANSCRIPT_TELEMETRY_LOGGING = 0)
      logger.info("assistant_voice_transcribed", {
        requestId,
        userId: req.user?.id,
        role: req.user?.role,
        crecheId: req.user?.crecheId ?? undefined,
        audioBytes: audioBuffer.length,
        mimeType,
        provider: result.provider,
        model: result.model,
        latencyMs: totalLatencyMs,
        status: "success",
      });

      // 10. Success response
      res.json({
        transcript: result.transcript,
        language: result.language,
        durationMs: result.durationMs ?? totalLatencyMs,
        provider: result.provider,
        model: result.model,
        requestId,
      });
    } catch (err: any) {
      const statusCode = err instanceof VoiceError ? err.statusCode : err?.status || 500;
      const errorCode = err instanceof VoiceError ? err.code : "VOICE_TRANSCRIPTION_FAILED";
      const errorMessage =
        err instanceof VoiceError
          ? err.message
          : "Falha ao processar a transcrição de voz. Tente novamente ou use texto.";

      logger.warn("assistant_voice_transcribe_error", {
        requestId,
        userId: req.user?.id,
        role: req.user?.role,
        errorCode,
        statusCode,
      });

      res.status(statusCode).json({
        error: errorMessage,
        code: errorCode,
        requestId,
      });
    }
  }
);

export default voiceRouter;
