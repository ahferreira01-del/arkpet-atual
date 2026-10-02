import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { VoiceInputButton } from "../features/assistant/VoiceInputButton";
import { useSpeechSynthesis, selectPortugueseVoice } from "../features/assistant/useSpeechSynthesis";
import { AssistantPanel } from "../features/assistant/AssistantPanel";

// Mock MediaStream and MediaRecorder
class MockMediaStreamTrack {
  public readyState = "live";
  public stop = vi.fn(() => {
    this.readyState = "ended";
  });
}

class MockMediaStream {
  public tracks: MockMediaStreamTrack[];
  constructor() {
    this.tracks = [new MockMediaStreamTrack()];
  }
  getTracks() {
    return this.tracks;
  }
}

class MockMediaRecorder {
  public static isTypeSupported = vi.fn(() => true);
  public state: "inactive" | "recording" | "paused" = "inactive";
  public stream: MockMediaStream;
  public mimeType: string;
  public ondataavailable: ((event: any) => void) | null = null;
  public onstop: (() => void) | null = null;

  constructor(stream: MockMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType || "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(["fake-audio-chunk"], { type: this.mimeType }) });
    }
    if (this.onstop) {
      this.onstop();
    }
  }
}

describe("ArkPet R41.D — Frontend Voice Assistant Suite (R41D-VOICE / TTS / MOBILE / A11Y)", () => {
  let originalMediaDevices: any;
  let originalMediaRecorder: any;
  let originalSpeechSynthesis: any;
  let mockStream: MockMediaStream;

  beforeEach(() => {
    mockStream = new MockMediaStream();
    originalMediaDevices = navigator.mediaDevices;
    originalMediaRecorder = (window as any).MediaRecorder;
    originalSpeechSynthesis = (window as any).speechSynthesis;

    // Define navigator.mediaDevices
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: vi.fn(async () => mockStream),
      },
    });

    (window as any).MediaRecorder = MockMediaRecorder;

    // Mock speechSynthesis
    class MockSpeechSynthesisUtterance {
      public text: string;
      public lang = "";
      public rate = 1;
      public pitch = 1;
      public voice: any = null;
      public onstart: any = null;
      public onend: any = null;
      public onerror: any = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    (window as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    (globalThis as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

    (window as any).speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => [
        { name: "Luciana", lang: "pt-BR", localService: true },
        { name: "Google português", lang: "pt-PT", localService: true },
      ]),
    };

    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: originalMediaDevices,
    });
    (window as any).MediaRecorder = originalMediaRecorder;
    (window as any).speechSynthesis = originalSpeechSynthesis;
    vi.restoreAllMocks();
  });

  // ── R41D-VOICE-001: Permission granted & explicit user action ──────────────
  it("R41D-VOICE-001: initializes recording only after user action (MIC_PERMISSION_WITHOUT_USER_ACTION = 0)", async () => {
    const handleTranscript = vi.fn();
    render(<VoiceInputButton onTranscript={handleTranscript} />);

    // Prior to user action, getUserMedia is NOT called
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    const button = screen.getByTestId("voice-input-button");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByTestId("voice-recording-timer")).toBeInTheDocument();
  });

  // ── R41D-VOICE-002: Permission denied handling ────────────────────────────
  it("R41D-VOICE-002: handles permission denied gracefully without breaking text mode (MIC_PERMISSION_DENIAL_BREAKS_ASSISTANT = NO)", async () => {
    const permError = new Error("Permission denied");
    permError.name = "NotAllowedError";
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(permError);

    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const button = screen.getByTestId("voice-input-button");

    await act(async () => {
      fireEvent.click(button);
    });

    const errorAlert = screen.getByTestId("voice-input-error");
    expect(errorAlert.textContent).toBe(
      "Não foi possível acessar o microfone. Você pode continuar digitando normalmente."
    );
  });

  // ── R41D-VOICE-003: Record and stop with track cleanup ──────────────────────
  it("R41D-VOICE-003: stops recording and cleans up all audio tracks (MICROPHONE_STREAM_LEAK = 0)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transcript: "Como cadastrar um pet?",
        language: "pt",
      }),
    })) as any;

    const onTranscript = vi.fn();
    render(<VoiceInputButton onTranscript={onTranscript} />);
    const button = screen.getByTestId("voice-input-button");

    // Start recording
    await act(async () => {
      fireEvent.click(button);
    });
    expect(mockStream.tracks[0].stop).not.toHaveBeenCalled();

    // Stop recording
    await act(async () => {
      fireEvent.click(button);
    });

    // Verify all stream tracks were stopped
    expect(mockStream.tracks[0].stop).toHaveBeenCalled();

    await waitFor(() => {
      expect(onTranscript).toHaveBeenCalledWith("Como cadastrar um pet?");
    });
  });

  // ── R41D-VOICE-004: Cancel recording ──────────────────────────────────────
  it("R41D-VOICE-004: cancels recording and discards audio without uploading (CANCELLED_AUDIO_SENT = 0)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const button = screen.getByTestId("voice-input-button");

    // Start recording
    await act(async () => {
      fireEvent.click(button);
    });

    // Click cancel button
    const cancelButton = screen.getByLabelText("Cancelar gravação de áudio");
    await act(async () => {
      fireEvent.click(cancelButton);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockStream.tracks[0].stop).toHaveBeenCalled();
    expect(screen.queryByTestId("voice-recording-timer")).not.toBeInTheDocument();
  });

  // ── R41D-TTS-003: TTS disabled by default ─────────────────────────────────
  it("R41D-TTS-003: speech synthesis is disabled by default (TTS_AUTOPLAY_DEFAULT = NO, VOICE_INPUT_DEPENDS_ON_TTS = NO)", () => {
    let hookResult: any;
    function TestComponent() {
      hookResult = useSpeechSynthesis();
      return null;
    }
    render(<TestComponent />);

    expect(hookResult.ttsEnabled).toBe(false);
    expect(hookResult.isSpeaking).toBe(false);

    // Calling speak when disabled does not call window.speechSynthesis.speak
    act(() => {
      hookResult.speak("Olá, tudo bem?");
    });
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  // ── R41D-TTS-001: TTS pt-BR voice preference & markdown stripping ─────────
  it("R41D-TTS-001: strips markdown formatting before speaking and prefers pt-BR voice", () => {
    let hookResult: any;
    function TestComponent() {
      hookResult = useSpeechSynthesis();
      return null;
    }
    render(<TestComponent />);

    // Enable TTS
    act(() => {
      hookResult.toggleTts();
    });
    expect(hookResult.ttsEnabled).toBe(true);

    // Speak markdown text
    act(() => {
      hookResult.speak("Para cadastrar **um pet**, acesse [Pets](/pets) e veja `prontuário`.");
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalled();
    const utteranceCall = (window.speechSynthesis.speak as any).mock.calls[0][0];
    expect(utteranceCall.text).not.toContain("**");
    expect(utteranceCall.text).not.toContain("[Pets]");
    expect(utteranceCall.text).not.toContain("`");
    expect(utteranceCall.lang).toBe("pt-BR");
    expect(utteranceCall.voice?.lang).toBe("pt-BR");
  });

  // ── R41D-TTS-002: Graceful fallback without speechSynthesis ───────────────
  it("R41D-TTS-002: functions gracefully when browser lacks speechSynthesis (TTS_FAILURE_BREAKS_ASSISTANT = NO)", () => {
    delete (window as any).speechSynthesis;

    let hookResult: any;
    function TestComponent() {
      hookResult = useSpeechSynthesis();
      return null;
    }
    render(<TestComponent />);

    expect(hookResult.isSupported).toBe(false);
    expect(() => hookResult.speak("Teste")).not.toThrow();
  });

  // ── R41D-MOBILE-001: Mobile viewport accessibility ────────────────────────
  it("R41D-MOBILE-001: voice button is rendered with thumb-friendly touch sizing for mobile/PWA (MOBILE_VOICE_UI = PASS)", () => {
    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const button = screen.getByTestId("voice-input-button");

    expect(button).toBeInTheDocument();
    expect(button.className).toContain("h-8");
    expect(button.getAttribute("aria-label")).toBe("Gravar áudio com push-to-talk");
  });

  // ── R41D-A11Y: Accessibility attributes and keyboard interaction ──────────
  it("R41D-A11Y: supports keyboard controls (Enter/Space) and live screen-reader regions (VOICE_ACCESSIBILITY = PASS)", async () => {
    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const button = screen.getByTestId("voice-input-button");

    // Live region exists for screen readers
    const srRegion = screen.getByText("", { selector: "[aria-live='polite']" });
    expect(srRegion).toBeInTheDocument();

    // Press Space or Enter to toggle recording
    await act(async () => {
      fireEvent.keyDown(button, { key: " " });
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();

    // Verify aria-pressed is now true
    expect(button.getAttribute("aria-pressed")).toBe("true");

    // Press Enter to stop
    await act(async () => {
      fireEvent.keyDown(button, { key: "Enter" });
    });
    expect(mockStream.tracks[0].stop).toHaveBeenCalled();
  });

  // ── Panel Integration: TTS Toggle and Cancel on Close ─────────────────────
  it("AssistantPanel includes TTS toggle in header and cancels ongoing speech on close", async () => {
    const handleClose = vi.fn();
    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={handleClose}
        onToggleMinimize={vi.fn()}
      />
    );

    const ttsToggle = screen.getByTestId("assistant-tts-toggle");
    expect(ttsToggle).toBeInTheDocument();
    expect(ttsToggle.getAttribute("aria-pressed")).toBe("false");

    // Toggle on
    fireEvent.click(ttsToggle);
    expect(ttsToggle.getAttribute("aria-pressed")).toBe("true");

    // Close panel
    const closeBtn = screen.getByLabelText("Fechar assistente");
    fireEvent.click(closeBtn);

    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(handleClose).toHaveBeenCalled();
  });

  // ── R41D-TTS-LOCAL-001: Local voice preference ────────────────────────────
  it("R41D-TTS-LOCAL-001: strictly selects local Portuguese voice over remote voice (REMOTE_BROWSER_TTS_VOICE_USED = NO)", () => {
    const mockVoices: any = [
      { name: "Remote Luciana", lang: "pt-BR", localService: false },
      { name: "Local Luciana", lang: "pt-BR", localService: true },
      { name: "English Voice", lang: "en-US", localService: true },
    ];

    const selected = selectPortugueseVoice(mockVoices, true);
    expect(selected).toBeDefined();
    expect(selected?.name).toBe("Local Luciana");
    expect(selected?.localService).toBe(true);
  });

  // ── R41D-TTS-LOCAL-002: Fallback when only remote voices exist ─────────────
  it("R41D-TTS-LOCAL-002: suppresses speech synthesis when only remote voices exist under local-only mode (NO_LOCAL_TTS_VOICE_BREAKS_ASSISTANT = NO)", () => {
    const remoteOnlyVoices: any = [
      { name: "Remote Luciana", lang: "pt-BR", localService: false },
      { name: "Remote Lisbon", lang: "pt-PT", localService: false },
    ];

    const selected = selectPortugueseVoice(remoteOnlyVoices, true);
    expect(selected).toBeNull();

    // Verify useSpeechSynthesis with requireLocalVoice: true does not invoke speak
    (window as any).speechSynthesis.getVoices = vi.fn(() => remoteOnlyVoices);

    let hook: any;
    function TestLocalTts() {
      hook = useSpeechSynthesis({ requireLocalVoice: true });
      return null;
    }
    render(<TestLocalTts />);

    // Enable TTS
    act(() => {
      hook.toggleTts();
    });

    // Attempt speak
    act(() => {
      hook.speak("Mensagem que não deve ser falada remotamente");
    });

    // speechSynthesis.speak should NOT be called with remote voice
    expect((window as any).speechSynthesis.speak).not.toHaveBeenCalled();
  });
});
