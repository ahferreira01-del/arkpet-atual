import { useState, useRef, useCallback, useEffect } from "react";

export interface VoiceTranscriptionResponse {
  transcript: string;
  language: string;
  durationMs?: number;
  provider: string;
  model: string;
  requestId?: string;
}

export interface UseVoiceRecorderOptions {
  maxDurationSeconds?: number;
  onTranscriptionSuccess?: (data: VoiceTranscriptionResponse) => void;
  onError?: (error: string) => void;
}

export function useVoiceRecorder({
  maxDurationSeconds = 60,
  onTranscriptionSuccess,
  onError,
}: UseVoiceRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCancelledRef = useRef(false);

  const isSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator?.mediaDevices?.getUserMedia) &&
    typeof window !== "undefined" &&
    Boolean(window?.MediaRecorder);

  // Helper: cleanly stop all stream tracks (MICROPHONE_STREAM_LEAK = 0)
  const stopAllTracks = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Safe ignore
        }
      });
      mediaStreamRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount or assistant close (MICROPHONE_STREAM_LEAK = 0)
  useEffect(() => {
    return () => {
      clearTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      stopAllTracks();
    };
  }, [clearTimer, stopAllTracks]);

  // Cancel recording without uploading (CANCELLED_AUDIO_SENT = 0)
  const cancelRecording = useCallback(() => {
    isCancelledRef.current = true;
    clearTimer();
    setIsRecording(false);
    setIsTranscribing(false);
    setRecordingDuration(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    stopAllTracks();
    chunksRef.current = [];
  }, [clearTimer, stopAllTracks]);

  // Stop recording and process transcription
  const stopRecording = useCallback(async () => {
    clearTimer();
    setIsRecording(false);

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      stopAllTracks();
      return;
    }

    // Set up transcription on recorder stop event
    const recorder = mediaRecorderRef.current;
    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        stopAllTracks();

        if (isCancelledRef.current) {
          isCancelledRef.current = false;
          chunksRef.current = [];
          resolve();
          return;
        }

        const mimeType = recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (audioBlob.size === 0) {
          setError("Nenhum áudio foi capturado.");
          resolve();
          return;
        }

        setIsTranscribing(true);
        setError(null);

        try {
          const token = localStorage.getItem("auth_token");
          const response = await fetch("/api/assistant/voice/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": mimeType,
              Authorization: `Bearer ${token}`,
            },
            body: audioBlob,
          });

          const data = await response.json();

          if (!response.ok) {
            const errorMsg = data.error || "Não foi possível transcrever o áudio.";
            setError(errorMsg);
            onError?.(errorMsg);
            return;
          }

          onTranscriptionSuccess?.(data);
        } catch (err: any) {
          const networkMsg = "Falha de conexão ao enviar áudio. Verifique sua internet.";
          setError(networkMsg);
          onError?.(networkMsg);
        } finally {
          setIsTranscribing(false);
          setRecordingDuration(0);
          resolve();
        }
      };

      try {
        recorder.stop();
      } catch {
        stopAllTracks();
        resolve();
      }
    });
  }, [clearTimer, stopAllTracks, onError, onTranscriptionSuccess]);

  // Start recording on explicit user action (MIC_PERMISSION_WITHOUT_USER_ACTION = 0)
  const startRecording = useCallback(async () => {
    if (!isSupported) {
      const msg = "Entrada por voz não é suportada neste navegador. Continue usando o chat por texto.";
      setError(msg);
      onError?.(msg);
      return;
    }

    setError(null);
    chunksRef.current = [];
    isCancelledRef.current = false;

    try {
      // Request mic permission strictly after user gesture
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Select supported MIME type
      let mimeType = "audio/webm";
      if (typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
          mimeType = "audio/ogg";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start(250); // Collect slice every 250ms
      setIsRecording(true);
      setRecordingDuration(0);

      // Start elapsed timer and auto-stop at max duration (VOICE_MAX_DURATION_SECONDS = 60)
      const startTime = Date.now();
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingDuration(elapsed);

        if (elapsed >= maxDurationSeconds) {
          stopRecording();
        }
      }, 500);
    } catch (err: any) {
      stopAllTracks();
      setIsRecording(false);

      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        const permMsg = "Não foi possível acessar o microfone. Você pode continuar digitando normalmente.";
        setError(permMsg);
        onError?.(permMsg);
      } else {
        const genericMsg = "Não foi possível iniciar a gravação de áudio.";
        setError(genericMsg);
        onError?.(genericMsg);
      }
    }
  }, [isSupported, maxDurationSeconds, stopAllTracks, stopRecording, onError]);

  return {
    isRecording,
    isTranscribing,
    recordingDuration,
    error,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
