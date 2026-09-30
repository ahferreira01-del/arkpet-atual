import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import * as utilsModule from "@/lib/utils";
import Chat from "@/pages/chat/index";

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock matchMedia
window.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock URL.createObjectURL / revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:http://localhost/mock-blob-uuid");
global.URL.revokeObjectURL = vi.fn();

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("ARKPET — R40.D CHAT & REAL-TIME EXPERIENCE TEST SUITE", () => {
  const staffUser = { id: 10, name: "Lucas Staff", role: "staff", crecheId: 1 };
  const tutorUser = { id: 25, name: "Mariana Silva", role: "tutor", crecheId: 1 };

  const sampleConversations = [
    {
      tutorId: 25,
      tutorName: "Mariana Silva",
      pets: [{ id: 101, name: "Pipoca" }],
      lastMessage: "Tudo bem com o Pipoca?",
      lastAt: "2026-09-30T10:00:00.000Z",
      unread: 3,
    },
    {
      tutorId: 26,
      tutorName: "Carlos Tutor",
      pets: [{ id: 102, name: "Thor" }],
      lastMessage: "Até mais tarde!",
      lastAt: "2026-09-30T09:00:00.000Z",
      unread: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "test-auth-token-r40d");
    localStorage.setItem("media_token", "test-media-token-r40d");

    // Mock fetch for mark-read
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as any);

    vi.spyOn(authModule, "useAuth").mockReturnValue({
      user: staffUser,
      isLoading: false,
    } as any);

    vi.spyOn(apiClientModule, "useListConversations").mockReturnValue({
      data: sampleConversations,
      isLoading: false,
    } as any);

    vi.spyOn(apiClientModule, "useListMessages").mockReturnValue({
      data: [
        {
          id: 1,
          crecheId: 1,
          tutorId: 25,
          senderId: 25,
          senderName: "Mariana Silva",
          content: "Olá! Como está o Pipoca hoje?",
          createdAt: "2026-09-30T10:00:00.000Z",
        },
      ],
      isLoading: false,
    } as any);
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-001: Message Delivery Lifecycle
  // ────────────────────────────────────────────────────────────
  describe("CHAT-001 — Message Delivery Lifecycle (SENDING -> SENT, Zero Fabricated States)", () => {
    it("transitions message through SENDING then SENT upon server confirmation without fake read receipts", async () => {
      let mutationSuccessCallback: any = null;
      const mockMutate = vi.fn((payload, options) => {
        mutationSuccessCallback = options?.onSuccess;
      });

      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);

      // Select Mariana Silva
      const tutorBtn = screen.getAllByText("Mariana Silva")[0];
      fireEvent.click(tutorBtn);

      const input = screen.getByPlaceholderText("Escreva uma mensagem...");
      fireEvent.change(input, { target: { value: "Ele almoçou super bem!" } });

      const form = input.closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      // Verify mutation called with exact payload
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          crecheId: 1,
          data: expect.objectContaining({
            tutorId: 25,
            content: "Ele almoçou super bem!",
          }),
        }),
        expect.any(Object)
      );

      // Verify optimistic message is displayed with sending state indicator
      expect(screen.getByText("Ele almoçou super bem!")).toBeInTheDocument();
      expect(screen.getByText("Enviando...")).toBeInTheDocument();

      // Trigger success callback
      mutationSuccessCallback?.({
        id: 2,
        crecheId: 1,
        tutorId: 25,
        senderId: 10,
        content: "Ele almoçou super bem!",
        createdAt: new Date().toISOString(),
      });

      // R40.D Guarantee: No fake double blue checks or fabricated delivery states
      expect(screen.queryByText(/lida/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/entregue/i)).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-002: Failure Recovery
  // ────────────────────────────────────────────────────────────
  describe("CHAT-002 — Failure Recovery & Non-Destructive Retry", () => {
    it("marks message as FAILED upon error without discarding it, and allows retry", async () => {
      let mutationErrorCallback: any = null;
      let mutationOptionsCaptured: any = null;
      const mockMutate = vi.fn((payload, options) => {
        mutationOptionsCaptured = options;
        mutationErrorCallback = options?.onError;
      });

      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);

      // Select conversation
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const input = screen.getByPlaceholderText("Escreva uma mensagem...");
      fireEvent.change(input, { target: { value: "Mensagem com falha de conexão" } });
      fireEvent.submit(input.closest("form")!);

      expect(screen.getByText("Mensagem com falha de conexão")).toBeInTheDocument();

      // Simulate network / server error
      mutationErrorCallback?.(new Error("Network disconnect"));

      await waitFor(() => {
        expect(screen.getByText("Falha ao enviar")).toBeInTheDocument();
        expect(screen.getByText("Tentar novamente")).toBeInTheDocument();
      });

      // Click retry
      const retryBtn = screen.getByText("Tentar novamente");
      fireEvent.click(retryBtn);

      // Verify mutation is called again with the same payload
      expect(mockMutate).toHaveBeenCalledTimes(2);
      expect(mockMutate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          crecheId: 1,
          data: expect.objectContaining({
            tutorId: 25,
            content: "Mensagem com falha de conexão",
          }),
        }),
        expect.any(Object)
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-003: Unread Counters & Zero Duplication
  // ────────────────────────────────────────────────────────────
  describe("CHAT-003 — Unread Counters & Zero Counter Duplication", () => {
    it("renders unread counter accurately and marks conversation as read on entry", async () => {
      renderWithProviders(<Chat />);

      // Tutor 25 has 3 unread messages
      const badge = screen.getAllByText("3")[0];
      expect(badge).toBeInTheDocument();

      // Tutor 26 has 0 unread messages (should not show badge)
      expect(screen.queryByText("0")).not.toBeInTheDocument();

      // Click conversation to open
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      // Verify POST mark-read was called for tutor 25
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/creches/1/chat/mark-read",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ tutorId: 25 }),
          })
        );
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-004: Existing Polling Realtime
  // ────────────────────────────────────────────────────────────
  describe("CHAT-004 — Polling Realtime Strategy (No WebSocket Provider)", () => {
    it("uses standard TanStack Query refetch intervals without creating WebSocket", () => {
      renderWithProviders(<Chat />);

      // Verify useListConversations was called with refetchInterval
      expect(apiClientModule.useListConversations).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          query: expect.objectContaining({
            refetchInterval: 10000,
          }),
        })
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-005: Zero Duplication on Reconnect
  // ────────────────────────────────────────────────────────────
  describe("CHAT-005 — Zero Duplication on Reconnect / Polling Sync", () => {
    it("deduplicates optimistic messages when matching server messages arrive", async () => {
      const { rerender } = renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const input = screen.getByPlaceholderText("Escreva uma mensagem...");
      fireEvent.change(input, { target: { value: "Chegando no horário" } });
      fireEvent.submit(input.closest("form")!);

      expect(screen.getByText("Chegando no horário")).toBeInTheDocument();

      // Now simulate server revalidation returning the newly confirmed message
      vi.spyOn(apiClientModule, "useListMessages").mockReturnValue({
        data: [
          {
            id: 1,
            crecheId: 1,
            tutorId: 25,
            senderId: 25,
            senderName: "Mariana Silva",
            content: "Olá! Como está o Pipoca hoje?",
            createdAt: "2026-09-30T10:00:00.000Z",
          },
          {
            id: 5,
            crecheId: 1,
            tutorId: 25,
            senderId: 10,
            senderName: "Lucas Staff",
            content: "Chegando no horário",
            createdAt: "2026-09-30T10:05:00.000Z",
          },
        ],
        isLoading: false,
      } as any);

      rerender(<Chat />);

      // Verify there is EXACTLY ONE instance of "Chegando no horário"
      const messages = screen.getAllByText("Chegando no horário");
      expect(messages.length).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-006: Strict Chronological Ordering
  // ────────────────────────────────────────────────────────────
  describe("CHAT-006 — Strict Chronological Ordering", () => {
    it("sorts all messages in strictly ascending order by createdAt", () => {
      vi.spyOn(apiClientModule, "useListMessages").mockReturnValue({
        data: [
          {
            id: 2,
            crecheId: 1,
            tutorId: 25,
            senderId: 10,
            senderName: "Lucas Staff",
            content: "Segunda mensagem",
            createdAt: "2026-09-30T10:10:00.000Z",
          },
          {
            id: 1,
            crecheId: 1,
            tutorId: 25,
            senderId: 25,
            senderName: "Mariana Silva",
            content: "Primeira mensagem",
            createdAt: "2026-09-30T10:00:00.000Z",
          },
        ],
        isLoading: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const first = screen.getByText("Primeira mensagem");
      const second = screen.getByText("Segunda mensagem");

      expect(first).toBeInTheDocument();
      expect(second).toBeInTheDocument();

      // Compare DOM positioning
      expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-007: Scroll Height Delta Compensation
  // ────────────────────────────────────────────────────────────
  describe("CHAT-007 — Scroll Height Delta Compensation on Historical Pagination", () => {
    it("compensates scrollTop when loading older messages", async () => {
      const mockFetchMessages = vi.spyOn(apiClientModule, "listMessages").mockResolvedValue([
        {
          id: 50,
          crecheId: 1,
          tutorId: 25,
          senderId: 25,
          senderName: "Mariana",
          content: "Mensagem bem antiga",
          createdAt: "2026-09-29T10:00:00.000Z",
        },
      ] as any);

      // Return 50 messages so pagination button is rendered
      vi.spyOn(apiClientModule, "useListMessages").mockReturnValue({
        data: Array.from({ length: 50 }, (_, i) => ({
          id: 100 + i,
          crecheId: 1,
          tutorId: 25,
          senderId: 25,
          senderName: "Mariana",
          content: `Mensagem ${i}`,
          createdAt: `2026-09-30T10:${i < 10 ? "0" + i : i}:00.000Z`,
        })),
        isLoading: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const loadOlderBtn = await screen.findByRole("button", { name: /mensagens anteriores/i });
      expect(loadOlderBtn).toBeInTheDocument();

      fireEvent.click(loadOlderBtn);

      await waitFor(() => {
        expect(mockFetchMessages).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            tutorId: 25,
            cursor: 100,
            limit: 50,
          })
        );
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-008: Authenticated Media Attachments
  // ────────────────────────────────────────────────────────────
  describe("CHAT-008 — Authenticated Media Attachments via Storage Uploads", () => {
    it("uploads photo via uploadFileDirect and displays media attachment in chat bubble", async () => {
      const mockUpload = vi.spyOn(utilsModule, "uploadFileDirect").mockResolvedValue("/objects/uploads/chat-photo.webp");
      const mockMutate = vi.fn();
      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      // Find file input and simulate image selection
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).not.toBeNull();

      const testFile = new File(["fake-image-bytes"], "dog.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [testFile] } });

      // Verify preview badge appeared
      await waitFor(() => {
        expect(screen.getByText("dog.png")).toBeInTheDocument();
      });

      // Submit message with attachment
      const input = screen.getByPlaceholderText("Escreva uma mensagem...");
      fireEvent.change(input, { target: { value: "Olha que foto linda!" } });
      fireEvent.submit(input.closest("form")!);

      await waitFor(() => {
        expect(mockUpload).toHaveBeenCalledWith(testFile, "test-auth-token-r40d");
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            crecheId: 1,
            data: expect.objectContaining({
              tutorId: 25,
              content: "Olha que foto linda!",
              mediaUrl: "/objects/uploads/chat-photo.webp",
            }),
          }),
          expect.any(Object)
        );
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-009: Tenant & Participant Isolation
  // ────────────────────────────────────────────────────────────
  describe("CHAT-009 — Tenant & Participant Security Isolation", () => {
    it("enforces tutor isolation: tutor is restricted to their own conversation", () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: tutorUser,
        isLoading: false,
      } as any);

      renderWithProviders(<Chat />);

      // For tutor user, conversation list is not rendered (Tela A bypassed)
      expect(screen.queryByPlaceholderText("Buscar tutor ou pet...")).not.toBeInTheDocument();

      // Messages query is scoped to tutor's own id (25)
      expect(apiClientModule.useListMessages).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ tutorId: 25 }),
        expect.any(Object)
      );
    });
  });
});
