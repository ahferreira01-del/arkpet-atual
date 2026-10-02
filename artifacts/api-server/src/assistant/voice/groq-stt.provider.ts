import type {
  SpeechToTextProvider,
  VoiceTranscriptionInput,
  VoiceTranscriptionResult,
} from "./stt-provider.types.js";
import { VoiceError } from "./stt-provider.types.js";
import { ASSISTANT_CONFIG } from "../assistant.config.js";
import { logger } from "../../lib/logger.js";

/**
 * Groq Whisper Speech-To-Text Provider (R41.D)
 *
 * Implements server-side audio transcription via Groq Audio Transcriptions API:
 * POST https://api.groq.com/openai/v1/audio/transcriptions
 *
 * Key remains strictly server-side (GROQ_API_KEY_FRONTEND = 0, GROQ_API_KEY_LOG_LEAK = 0).
 * Errors mapped safely without exposing stack traces, keys or internal URLs.
 */
export class GroqSpeechToTextProvider implements SpeechToTextProvider {
  public readonly providerName = "groq";
  private static readonly GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

  public async transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new VoiceError(
        "VOICE_PROVIDER_AUTH_ERROR",
        "Chave do provedor de transcrição não configurada no servidor.",
        500
      );
    }

    if (!input.audioBuffer || input.audioBuffer.length === 0) {
      throw new VoiceError("VOICE_EMPTY_AUDIO", "Arquivo de áudio vazio ou inválido.", 400);
    }

    const model = input.model || ASSISTANT_CONFIG.voiceSttModel || "whisper-large-v3-turbo";
    const language = input.language || ASSISTANT_CONFIG.voiceSttLanguage || "pt";
    const temperature = typeof input.temperature === "number" ? input.temperature : 0;
    const prompt =
      input.prompt ||
      "ArkPet, Day Use, Hospedagem, check-in, check-out, tutor, creche, pet, medicação, Thor, Rex";

    // Determine extension from MIME type
    const mimeBase = (input.mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
    const extMap: Record<string, string> = {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "mp4",
      "audio/m4a": "m4a",
    };
    const extension = extMap[mimeBase] || "webm";
    const filename = input.filename || `audio_${Date.now()}.${extension}`;

    const startTime = Date.now();

    try {
      // Build standard FormData payload
      const formData = new FormData();
      const blob = new Blob([input.audioBuffer as any], { type: mimeBase });
      formData.append("file", blob, filename);
      formData.append("model", model);
      formData.append("language", language);
      formData.append("temperature", String(temperature));
      formData.append("prompt", prompt);
      formData.append("response_format", "verbose_json");

      const response = await fetch(GroqSpeechToTextProvider.GROQ_AUDIO_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        let errorStatus = response.status;
        let safeCode: VoiceError["code"] = "VOICE_TRANSCRIPTION_FAILED";
        let safeMessage = "Falha ao processar a transcrição de voz.";

        if (errorStatus === 400) {
          safeCode = "VOICE_INVALID_AUDIO";
          safeMessage = "Arquivo de áudio inválido ou formato corrompido.";
        } else if (errorStatus === 401 || errorStatus === 403) {
          safeCode = "VOICE_PROVIDER_AUTH_ERROR";
          safeMessage = "Falha de autorização com o provedor de transcrição.";
        } else if (errorStatus === 429) {
          safeCode = "VOICE_PROVIDER_RATE_LIMIT";
          safeMessage = "Limite de requisições de áudio excedido no provedor. Aguarde um momento.";
        } else if (errorStatus >= 500) {
          safeCode = "VOICE_PROVIDER_UNAVAILABLE";
          safeMessage = "O serviço de transcrição está temporariamente indisponível.";
        }

        // Operational error logging without exposing secrets or user transcripts
        logger.warn("assistant_groq_stt_error", {
          statusCode: errorStatus,
          errorCode: safeCode,
          durationMs,
          audioBytes: input.audioBuffer.length,
          mimeType: mimeBase,
          model,
        });

        throw new VoiceError(safeCode, safeMessage, errorStatus >= 500 ? 503 : errorStatus);
      }

      const data = (await response.json()) as any;
      const transcript = typeof data?.text === "string" ? data.text.trim() : "";
      const detectedLanguage = typeof data?.language === "string" ? data.language : language;
      const audioDuration = typeof data?.duration === "number" ? Math.round(data.duration * 1000) : durationMs;

      return {
        transcript,
        language: detectedLanguage,
        durationMs: audioDuration,
        provider: "groq",
        model,
      };
    } catch (err: any) {
      if (err instanceof VoiceError) {
        throw err;
      }

      // Safe fallback for unexpected network failures (RAW_STT_PROVIDER_ERROR_TO_CLIENT = 0)
      logger.error("assistant_groq_stt_network_error", err, {
        durationMs: Date.now() - startTime,
        audioBytes: input.audioBuffer.length,
        mimeType: mimeBase,
      });

      throw new VoiceError(
        "VOICE_PROVIDER_UNAVAILABLE",
        "Falha de comunicação com o serviço de transcrição.",
        503
      );
    }
  }
}
