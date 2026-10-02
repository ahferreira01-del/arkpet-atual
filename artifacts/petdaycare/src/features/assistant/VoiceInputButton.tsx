import React from "react";
import { Mic, Square, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder, type VoiceTranscriptionResponse } from "./useVoiceRecorder";

interface VoiceInputButtonProps {
  onTranscript: (transcript: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({ onTranscript, disabled = false }: VoiceInputButtonProps) {
  const {
    isRecording,
    isTranscribing,
    recordingDuration,
    error,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder({
    onTranscriptionSuccess: (data: VoiceTranscriptionResponse) => {
      if (data?.transcript) {
        onTranscript(data.transcript);
      }
    },
  });

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const handleToggleRecord = () => {
    if (disabled || isTranscribing) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggleRecord();
    } else if (e.key === "Escape" && isRecording) {
      e.preventDefault();
      cancelRecording();
    }
  };

  if (!isSupported) {
    return null; // Gracefully hidden on unsupported browsers
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="voice-input-container">
      {/* Live recording status announcement for screen readers */}
      <span className="sr-only" aria-live="polite">
        {isRecording
          ? `Gravando áudio: ${recordingDuration} segundos. Pressione Enter para concluir.`
          : isTranscribing
          ? "Processando áudio e gerando transcrição."
          : ""}
      </span>

      {/* Recording timer & cancel action */}
      {isRecording && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium animate-in fade-in">
          {/* Pulsing indicator respecting reduced motion */}
          <span
            className="w-2 h-2 rounded-full bg-destructive motion-safe:animate-ping"
            aria-hidden="true"
          />
          <span data-testid="voice-recording-timer">{formatDuration(recordingDuration)}</span>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancelar gravação de áudio"
            title="Cancelar gravação"
            className="p-0.5 rounded hover:bg-destructive/20 text-destructive ml-0.5 transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Push-To-Talk Button */}
      <Button
        type="button"
        size="sm"
        variant={isRecording ? "destructive" : "outline"}
        disabled={disabled || isTranscribing}
        onClick={handleToggleRecord}
        onKeyDown={handleKeyDown}
        data-testid="voice-input-button"
        aria-label={
          isRecording
            ? "Parar gravação de áudio e transcrever"
            : isTranscribing
            ? "Processando transcrição"
            : "Gravar áudio com push-to-talk"
        }
        aria-pressed={isRecording}
        title={
          isRecording
            ? "Clique para finalizar a gravação"
            : isTranscribing
            ? "Transcrevendo áudio..."
            : "Falar com o assistente (Push-to-Talk)"
        }
        className={`h-8 min-w-[32px] sm:min-w-[36px] px-2 rounded-lg shrink-0 cursor-pointer transition-all ${
          isRecording ? "bg-destructive text-destructive-foreground ring-2 ring-destructive/40" : ""
        }`}
      >
        {isTranscribing ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : isRecording ? (
          <Square className="w-3.5 h-3.5 fill-current" />
        ) : (
          <Mic className="w-4 h-4 text-foreground/80 hover:text-foreground" />
        )}
      </Button>

      {/* Error notification tooltip / message */}
      {error && !isRecording && (
        <span
          role="alert"
          data-testid="voice-input-error"
          className="sr-only"
        >
          {error}
        </span>
      )}
    </div>
  );
}
