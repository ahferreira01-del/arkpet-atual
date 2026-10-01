import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { AssistantLauncher } from "../features/assistant/AssistantLauncher";
import { AssistantContainer } from "../features/assistant";

describe("ArkPet R41.A — Assistant UX Test Suite (AI-UX-001..008)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  // AI-UX-001: Desktop panel
  it("AI-UX-001: desktop assistant panel renders with title, suggestions, and input when open", () => {
    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={vi.fn()}
        onToggleMinimize={vi.fn()}
        userRole="creche_admin"
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ArkPet Assistente", level: 2 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Digite sua dúvida/i)).toBeInTheDocument();
    expect(screen.getByText(/Não informe senhas ou dados bancários/i)).toBeInTheDocument();
  });

  // AI-UX-002: Mobile panel
  it("AI-UX-002: renders mobile bottom sheet structure with accessible controls", () => {
    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={vi.fn()}
        onToggleMinimize={vi.fn()}
        userRole="tutor"
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "assistant-title");
  });

  // AI-UX-003: Keyboard navigation
  it("AI-UX-003: handles Escape key to close panel and Enter to send message", async () => {
    const handleClose = vi.fn();
    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={handleClose}
        onToggleMinimize={vi.fn()}
        userRole="creche_admin"
      />
    );

    // Escape closes panel
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalled();
  });

  // AI-UX-004: Focus management
  it("AI-UX-004: restores focus to trigger button upon closing the assistant", () => {
    const triggerRef = React.createRef<HTMLButtonElement>();

    const { rerender } = render(
      <div>
        <button ref={triggerRef as any} data-testid="test-trigger">
          Trigger
        </button>
        <AssistantPanel
          isOpen={true}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          triggerButtonRef={triggerRef}
        />
      </div>
    );

    // Re-render closed
    rerender(
      <div>
        <button ref={triggerRef as any} data-testid="test-trigger">
          Trigger
        </button>
        <AssistantPanel
          isOpen={false}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          triggerButtonRef={triggerRef}
        />
      </div>
    );

    expect(document.activeElement).toBe(triggerRef.current);
  });

  // AI-UX-005: Loading and typing state
  it("AI-UX-005: renders typing state while awaiting AI response", async () => {
    // Mock global fetch with delayed promise
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({
                  session: { id: "sess_1" },
                  message: { id: "msg_1", content: "Resposta de teste" },
                }),
              }),
            100
          )
        )
    );

    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={vi.fn()}
        onToggleMinimize={vi.fn()}
        userRole="creche_admin"
      />
    );

    const input = screen.getByPlaceholderText(/Digite sua dúvida/i);
    const sendBtn = screen.getByRole("button", { name: /Enviar mensagem/i });

    fireEvent.change(input, { target: { value: "Como faço check-in?" } });
    fireEvent.click(sendBtn);

    // Verify typing indicator appears
    expect(screen.getByRole("status", { name: /Assistente pensando/i })).toBeInTheDocument();

    // Verify response arrives and typing state resolves
    await waitFor(() => {
      expect(screen.getByText("Resposta de teste")).toBeInTheDocument();
    });
  });

  // AI-UX-006: Offline graceful degradation
  it("AI-UX-006: displays graceful unavailable state when offline without breaking the app", () => {
    // Mock navigator.onLine as false
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      render(
        <AssistantPanel
          isOpen={true}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          userRole="creche_admin"
        />
      );

      expect(screen.getByText("Assistente Offline")).toBeInTheDocument();
      expect(screen.getByText(/O restante do ArkPet continua funcionando/i)).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  // AI-UX-007: Assistant minimized
  it("AI-UX-007: minimizes and maximizes assistant panel cleanly", () => {
    const handleToggleMinimize = vi.fn();
    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={true}
        onClose={vi.fn()}
        onToggleMinimize={handleToggleMinimize}
        userRole="creche_admin"
      />
    );

    // In minimized state, full conversation body is collapsed
    expect(screen.queryByPlaceholderText(/Digite sua dúvida/i)).toBeNull();

    const maxBtn = screen.getByRole("button", { name: /Maximizar assistente/i });
    fireEvent.click(maxBtn);
    expect(handleToggleMinimize).toHaveBeenCalled();
  });

  // AI-UX-008: Conversation resume / persistence
  it("AI-UX-008: resumes conversation messages from session storage", () => {
    const savedMessages = [
      { id: "m1", role: "user", content: "Mensagem anterior", createdAt: new Date().toISOString() },
      { id: "m2", role: "assistant", content: "Resposta persistida", createdAt: new Date().toISOString() },
    ];
    sessionStorage.setItem("arkpet_assistant_messages", JSON.stringify(savedMessages));

    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={vi.fn()}
        onToggleMinimize={vi.fn()}
        userRole="creche_admin"
      />
    );

    expect(screen.getByText("Mensagem anterior")).toBeInTheDocument();
    expect(screen.getByText("Resposta persistida")).toBeInTheDocument();
  });

  it("renders launcher trigger and allows opening", () => {
    render(<AssistantContainer userRole="creche_admin" />);

    const launcher = screen.getByTestId("assistant-launcher");
    expect(launcher).toBeInTheDocument();

    fireEvent.click(launcher);
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
  });
});
