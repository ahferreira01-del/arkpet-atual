/**
 * ARKPET ASSISTANT — SPEECH-TO-TEXT PROVIDER CONTRACTS (R41.D)
 *
 * Provider-neutral abstraction for transient voice transcription.
 * Zero audio persistence, zero database writes, zero storage bucket writes.
 */

export interface VoiceTranscriptionInput {
  audioBuffer: Buffer;
  mimeType: string;
  filename?: string;
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
}

export interface VoiceTranscriptionResult {
  transcript: string;
  language: string;
  durationMs?: number;
  provider: string;
  model: string;
}

export interface SpeechToTextProvider {
  readonly providerName: string;
  transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
}

export type VoiceErrorCode =
  | "VOICE_DISABLED"
  | "VOICE_INVALID_AUDIO"
  | "VOICE_TOO_LARGE"
  | "VOICE_TOO_LONG"
  | "VOICE_TRANSCRIPTION_FAILED"
  | "VOICE_PROVIDER_AUTH_ERROR"
  | "VOICE_PROVIDER_RATE_LIMIT"
  | "VOICE_PROVIDER_UNAVAILABLE"
  | "VOICE_EMPTY_TRANSCRIPT"
  | "VOICE_EMPTY_AUDIO";

export class VoiceError extends Error {
  public readonly code: VoiceErrorCode;
  public readonly statusCode: number;

  constructor(code: VoiceErrorCode, message: string, statusCode: number = 400) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
