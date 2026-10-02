import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useAssistantContext } from "../features/assistant/useAssistantContext";
import { AssistantPanel } from "../features/assistant/AssistantPanel";

// Mock wouter location hook
let mockCurrentLocation = "/";
vi.mock("wouter", () => ({
  useLocation: () => [mockCurrentLocation, (to: string) => { mockCurrentLocation = to; }],
}));

describe("ArkPet R41.C — Frontend Contextual Product Guide Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mockCurrentLocation = "/";
  });

  // ── 1. useAssistantContext Route & Entity Resolution ───────────────────────
  describe("useAssistantContext Hook", () => {
    it("resolves dashboard screen context on root '/'", () => {
      mockCurrentLocation = "/";
      const { result } = renderHook(() => useAssistantContext());

      expect(result.current.route).toBe("/");
      expect(result.current.feature).toBe("dashboard");
      expect(result.current.title).toBe("Painel Principal");
      expect(result.current.entity).toBeUndefined();
    });

    it("resolves pets directory screen context on '/pets'", () => {
      mockCurrentLocation = "/pets";
      const { result } = renderHook(() => useAssistantContext());

      expect(result.current.route).toBe("/pets");
      expect(result.current.feature).toBe("pets_directory");
      expect(result.current.title).toBe("Diretório de Pets");
      expect(result.current.entity).toBeUndefined();
    });

    it("resolves pet detail screen context and extracts pet entity on '/pets/101'", () => {
      mockCurrentLocation = "/pets/101";
      const { result } = renderHook(() => useAssistantContext());

      expect(result.current.route).toBe("/pets/101");
      expect(result.current.feature).toBe("pet_detail");
      expect(result.current.title).toBe("Ficha do Pet");
      expect(result.current.entity).toEqual({
        type: "pet",
        id: 101,
      });
    });

    it("resolves booking detail and extracts booking entity on '/bookings/42'", () => {
      mockCurrentLocation = "/bookings/42";
      const { result } = renderHook(() => useAssistantContext());

      expect(result.current.route).toBe("/bookings/42");
      expect(result.current.feature).toBe("booking_detail");
      expect(result.current.title).toBe("Detalhes da Reserva");
      expect(result.current.entity).toEqual({
        type: "booking",
        id: 42,
      });
    });

    it("resolves tutor detail and extracts tutor entity on '/tutors/50'", () => {
      mockCurrentLocation = "/tutors/50";
      const { result } = renderHook(() => useAssistantContext());

      expect(result.current.route).toBe("/tutors/50");
      expect(result.current.feature).toBe("tutor_detail");
      expect(result.current.title).toBe("Ficha do Tutor");
      expect(result.current.entity).toEqual({
        type: "tutor",
        id: 50,
      });
    });
  });

  // ── 2. AssistantPanel Context UI & API Transmission ────────────────────────
  describe("AssistantPanel Contextual Integration", () => {
    it("renders screen title chip in header when opened on dashboard", () => {
      mockCurrentLocation = "/";
      render(
        <AssistantPanel
          isOpen={true}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          userRole="creche_admin"
        />
      );

      const titleEl = screen.getByTestId("assistant-context-title");
      expect(titleEl).toBeInTheDocument();
      expect(titleEl.textContent).toBe("Painel Principal");
      expect(screen.queryByTestId("assistant-context-entity")).toBeNull();
    });

    it("renders entity indicator badge when opened on pet detail screen '/pets/101'", () => {
      mockCurrentLocation = "/pets/101";
      render(
        <AssistantPanel
          isOpen={true}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          userRole="creche_admin"
        />
      );

      const titleEl = screen.getByTestId("assistant-context-title");
      expect(titleEl).toBeInTheDocument();
      expect(titleEl.textContent).toBe("Ficha do Pet");

      const entityBadge = screen.getByTestId("assistant-context-entity");
      expect(entityBadge).toBeInTheDocument();
      expect(entityBadge.textContent).toBe("#101");
    });

    it("sends route and entity in request payload to /api/assistant/message", async () => {
      mockCurrentLocation = "/pets/101";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            id: "msg_resp_1",
            content: "Você está visualizando o pet Thor.",
            createdAt: new Date().toISOString(),
          },
          session: { id: "sess-ctx-1" },
        }),
      });
      global.fetch = mockFetch;

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
      fireEvent.change(input, { target: { value: "Ele tem alguma reserva?" } });

      const sendButton = screen.getByRole("button", { name: /enviar mensagem/i });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe("/api/assistant/message");

      const sentBody = JSON.parse(callArgs[1].body);
      expect(sentBody.message).toBe("Ele tem alguma reserva?");
      expect(sentBody.screen).toEqual({
        route: "/pets/101",
        feature: "pet_detail",
        entity: {
          type: "pet",
          id: 101,
        },
      });
    });

    it("handles transition between screens updating context header", () => {
      mockCurrentLocation = "/pets";
      const { unmount } = render(
        <AssistantPanel
          isOpen={true}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          userRole="creche_admin"
        />
      );

      expect(screen.getByTestId("assistant-context-title").textContent).toBe("Diretório de Pets");
      expect(screen.queryByTestId("assistant-context-entity")).toBeNull();
      unmount();

      // Navigate to /pets/102
      mockCurrentLocation = "/pets/102";
      render(
        <AssistantPanel
          isOpen={true}
          isMinimized={false}
          onClose={vi.fn()}
          onToggleMinimize={vi.fn()}
          userRole="creche_admin"
        />
      );

      expect(screen.getByTestId("assistant-context-title").textContent).toBe("Ficha do Pet");
      expect(screen.getByTestId("assistant-context-entity").textContent).toBe("#102");
    });
  });
});
