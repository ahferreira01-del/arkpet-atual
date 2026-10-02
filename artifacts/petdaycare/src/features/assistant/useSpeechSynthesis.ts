import { useState, useCallback, useEffect, useRef } from "react";

const TTS_STORAGE_KEY = "arkpet_assistant_tts_enabled";

function stripMarkdown(text: string): string {
  if (!text) return "";
  return text
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove code blocks ```...``` and inline `...`
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    // Remove headings #
    .replace(/^#+\s+/gm, "")
    // Remove bold and italic **text** or *text*
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    // Remove bullet points
    .replace(/^\s*[-*+]\s+/gm, "")
    // Remove multiple spaces/newlines
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function useSpeechSynthesis() {
  const isSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      // Default strictly OFF (TTS_AUTOPLAY_DEFAULT = NO)
      return localStorage.getItem(TTS_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsEnabledRef = useRef(ttsEnabled);
  ttsEnabledRef.current = ttsEnabled;

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      ttsEnabledRef.current = next;
      try {
        localStorage.setItem(TTS_STORAGE_KEY, String(next));
      } catch {}
      if (!next && isSupported) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      return next;
    });
  }, [isSupported]);

  const cancelSpeech = useCallback(() => {
    if (isSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    setIsSpeaking(false);
    currentUtteranceRef.current = null;
  }, [isSupported]);

  const speak = useCallback(
    (rawText: string) => {
      // If user disabled TTS or browser unsupported, do nothing (TTS_AUTOPLAY_DEFAULT = NO)
      if (!ttsEnabledRef.current || !isSupported || !rawText) return;

      try {
        window.speechSynthesis.cancel();

        const cleanText = stripMarkdown(rawText);
        // Truncate to safe length (max 400 chars) to prevent speech synthesizer hang
        const safeText = cleanText.slice(0, 400);
        if (!safeText.trim()) return;

        const utterance = new SpeechSynthesisUtterance(safeText);
        utterance.lang = "pt-BR";
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Try to pick pt-BR or pt voice
        const voices = window.speechSynthesis.getVoices();
        const ptBrVoice = voices.find(
          (v) => v.lang.toLowerCase() === "pt-br" || v.lang.toLowerCase().startsWith("pt")
        );
        if (ptBrVoice) {
          utterance.voice = ptBrVoice;
        }

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        currentUtteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      } catch {
        // Fallback: TTS failure does not break assistant (TTS_FAILURE_BREAKS_ASSISTANT = NO)
        setIsSpeaking(false);
      }
    },
    [ttsEnabled, isSupported]
  );

  // Clean up ongoing speech on unmount
  useEffect(() => {
    return () => {
      if (isSupported) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    };
  }, [isSupported]);

  return {
    isSupported,
    ttsEnabled,
    isSpeaking,
    toggleTts,
    speak,
    cancelSpeech,
  };
}
