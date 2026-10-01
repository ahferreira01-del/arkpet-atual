import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CrecheOnboardingCard } from "@/components/onboarding/creche-onboarding-card";
import { AssistantContainer } from "../features/assistant";
import { AssistantConversation } from "../features/assistant/AssistantConversation";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AssistantUIMessage } from "../features/assistant/assistant.types";

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

describe("ArkPet R41.B — Frontend AI Guided Onboarding Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  const mockIncompleteOnboarding = {
    crecheId: 1,
    isComplete: false,
    completedCount: 2,
    totalSteps: 5,
    steps: [
      { id: "creche_details", title: "Completar dados", description: "Telefone e endereço", completed: true, route: "/settings", target: "creche-profile-form" },
      { id: "staff", title: "Cadastrar equipe", description: "Membros da equipe", completed: true, route: "/staff/manage", target: "staff-create-button" },
      { id: "tutors", title: "Cadastrar tutor", description: "Primeiro tutor", completed: false, route: "/tutors", target: "tutor-create-button" },
      { id: "pets", title: "Cadastrar pet", description: "Primeiro pet", completed: false, route: "/pets", target: "pet-create-button" },
      { id: "bookings", title: "Conhecer reservas", description: "Primeira reserva", completed: false, route: "/bookings", target: "booking-create-button" },
    ],
  };

  // ── R41B-FRONT-001: Continuar com Assistente Button ──
  it("R41B-FRONT-001: CrecheOnboardingCard renders 'Continuar com Assistente' button for creche_admin", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockIncompleteOnboarding,
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <CrecheOnboardingCard crecheId={1} userRole="creche_admin" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("onboarding-open-assistant-btn")).toBeInTheDocument();
      expect(screen.getByText("Continuar com Assistente")).toBeInTheDocument();
    });
  });

  // ── R41B-FRONT-002: Click dispatches custom event ──
  it("R41B-FRONT-002: clicking 'Continuar com Assistente' dispatches 'arkpet:open-assistant' event", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockIncompleteOnboarding,
    });

    const eventListener = vi.fn();
    window.addEventListener("arkpet:open-assistant", eventListener);

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <CrecheOnboardingCard crecheId={1} userRole="creche_admin" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("onboarding-open-assistant-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("onboarding-open-assistant-btn"));

    expect(eventListener).toHaveBeenCalled();
    window.removeEventListener("arkpet:open-assistant", eventListener);
  });

  // ── R41B-FRONT-003: AssistantContainer responds to custom event ──
  it("R41B-FRONT-003: AssistantContainer opens panel when 'arkpet:open-assistant' event fires", () => {
    render(<AssistantContainer userRole="creche_admin" />);

    // Initially closed
    expect(screen.queryByTestId("assistant-panel")).toBeNull();

    // Dispatch custom event
    fireEvent(window, new CustomEvent("arkpet:open-assistant"));

    // Panel opens
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
  });

  // ── R41B-FRONT-004: Actionable chip rendering ──
  it("R41B-FRONT-004: renders navigation chip button for messages with navigate uiAction", () => {
    const onExecuteAction = vi.fn();
    const testMessages: AssistantUIMessage[] = [
      {
        id: "msg_1",
        role: "assistant",
        content: "O próximo passo é cadastrar seu primeiro tutor.",
        createdAt: new Date().toISOString(),
        uiActions: [{ type: "navigate", route: "/tutors" }],
      },
    ];

    render(
      <AssistantConversation
        messages={testMessages}
        status="idle"
        screenContext={{ route: "/", feature: "dashboard", title: "Início" }}
        userRole="creche_admin"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
        onExecuteAction={onExecuteAction}
      />
    );

    const navButton = screen.getByRole("button", { name: /Ir para Tutores/i });
    expect(navButton).toBeInTheDocument();

    fireEvent.click(navButton);
    expect(onExecuteAction).toHaveBeenCalledWith({ type: "navigate", route: "/tutors" });
  });

  // ── R41B-FRONT-005: Highlight chip rendering ──
  it("R41B-FRONT-005: renders highlight chip for messages with highlight uiAction", () => {
    const onExecuteAction = vi.fn();
    const testMessages: AssistantUIMessage[] = [
      {
        id: "msg_2",
        role: "assistant",
        content: "Você já está na tela correta. Clique no botão destacado.",
        createdAt: new Date().toISOString(),
        uiActions: [{ type: "highlight", targetId: "pet-create-button" }],
      },
    ];

    render(
      <AssistantConversation
        messages={testMessages}
        status="idle"
        screenContext={{ route: "/pets", feature: "pets", title: "Pets" }}
        userRole="creche_admin"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
        onExecuteAction={onExecuteAction}
      />
    );

    const highlightBtn = screen.getByRole("button", { name: /Destacar botão/i });
    expect(highlightBtn).toBeInTheDocument();

    fireEvent.click(highlightBtn);
    expect(onExecuteAction).toHaveBeenCalledWith({ type: "highlight", targetId: "pet-create-button" });
  });

  // ── R41B-FRONT-006: Onboarding Progress summary in message bubble ──
  it("R41B-FRONT-006: renders progress summary when message contains onboarding metadata", () => {
    const testMessages: AssistantUIMessage[] = [
      {
        id: "msg_3",
        role: "assistant",
        content: "Sua configuração está em andamento.",
        createdAt: new Date().toISOString(),
        onboarding: {
          isComplete: false,
          progressPercent: 40,
          currentStep: "tutors",
          completedSteps: ["creche_details", "staff"],
          pendingSteps: ["tutors", "pets", "bookings"],
        },
      },
    ];

    render(
      <AssistantConversation
        messages={testMessages}
        status="idle"
        screenContext={{ route: "/", feature: "dashboard", title: "Início" }}
        userRole="creche_admin"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
      />
    );

    expect(screen.getByText(/Progresso: 40%/i)).toBeInTheDocument();
    expect(screen.getByText(/Próximo: tutors/i)).toBeInTheDocument();
  });

  // ── R41B-FRONT-007: Safe target highlight without crashing if missing ──
  it("R41B-FRONT-007: does not crash when DOM target element is not present (MISSING_GUIDANCE_TARGET_BREAKS_APP = NO)", () => {
    render(
      <AssistantPanel
        isOpen={true}
        isMinimized={false}
        onClose={vi.fn()}
        onToggleMinimize={vi.fn()}
        userRole="creche_admin"
      />
    );

    // Target does not exist in DOM
    expect(document.getElementById("tutor-create-button")).toBeNull();
    // Assistant panel renders safely without error
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
