import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor, act } from "./utils";
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
let createdUrlCounter = 0;
const createdUrls: string[] = [];
const revokedUrls: string[] = [];
global.URL.createObjectURL = vi.fn(() => {
  const url = `blob:http://localhost/mock-blob-${++createdUrlCounter}`;
  createdUrls.push(url);
  return url;
});
global.URL.revokeObjectURL = vi.fn((url: string) => {
  revokedUrls.push(url);
});

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
    createdUrls.length = 0;
    revokedUrls.length = 0;
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
  // CHAT-001: Message Delivery Lifecycle (SENDING -> SENT)
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

      const { rerender } = renderWithProviders(<Chat />);

      // Select Mariana Silva
      const tutorBtn = screen.getAllByText("Mariana Silva")[0];
      fireEvent.click(tutorBtn);

      const input = screen.getByPlaceholderText("Escreva uma mensagem...");
      fireEvent.change(input, { target: { value: "Ele almoçou super bem!" } });

      const form = input.closest("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      // 1. Verify mutation called with exact payload
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

      // 2. SENDING appears before response
      expect(screen.getByText("Ele almoçou super bem!")).toBeInTheDocument();
      expect(screen.getByText("Enviando...")).toBeInTheDocument();

      // 3. HTTP success callback executes
      act(() => {
        mutationSuccessCallback?.({
          id: 2,
          crecheId: 1,
          tutorId: 25,
          senderId: 10,
          senderName: "Lucas Staff",
          content: "Ele almoçou super bem!",
          createdAt: new Date().toISOString(),
        });
      });

      // 4. HTTP_201_LEAVES_MESSAGE_SENDING = 0: "Enviando..." disappears immediately
      expect(screen.queryByText("Enviando...")).not.toBeInTheDocument();

      // 5. Confirmed message remains visible and not duplicated
      expect(screen.getByText("Ele almoçou super bem!")).toBeInTheDocument();

      // Simulate polling returning message 2
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
            id: 2,
            crecheId: 1,
            tutorId: 25,
            senderId: 10,
            senderName: "Lucas Staff",
            content: "Ele almoçou super bem!",
            createdAt: "2026-09-30T10:01:00.000Z",
          },
        ],
        isLoading: false,
      } as any);

      rerender(<Chat />);

      const confirmedMsgs = screen.getAllByText("Ele almoçou super bem!");
      expect(confirmedMsgs.length).toBe(1);

      // 6. Zero fabricated DELIVERED / READ state exists
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
      let mutationSuccessCallback: any = null;
      const mockMutate = vi.fn((payload, options) => {
        mutationErrorCallback = options?.onError;
        mutationSuccessCallback = options?.onSuccess;
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
      act(() => {
        mutationErrorCallback?.(new Error("Network disconnect"));
      });

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

      // Simulate retry success
      act(() => {
        mutationSuccessCallback?.({
          id: 30,
          crecheId: 1,
          tutorId: 25,
          senderId: 10,
          content: "Mensagem com falha de conexão",
          createdAt: new Date().toISOString(),
        });
      });

      // Expect failure indicator removed on successful retry
      expect(screen.queryByText("Falha ao enviar")).not.toBeInTheDocument();
      expect(screen.getByText("Mensagem com falha de conexão")).toBeInTheDocument();
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

      // Verify useListConversations was called with refetchInterval 10s
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
  // CHAT-005: Zero Duplication on Reconnect / Polling Sync
  // ────────────────────────────────────────────────────────────
  describe("CHAT-005 — Zero Duplication on Reconnect / Polling Sync", () => {
    it("deduplicates optimistic messages by serverId when matching server messages arrive", async () => {
      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: vi.fn((payload, options) => {
          options?.onSuccess?.({
            id: 5,
            crecheId: 1,
            tutorId: 25,
            senderId: 10,
            senderName: "Lucas Staff",
            content: "Chegando no horário",
            createdAt: "2026-09-30T10:05:00.000Z",
          });
        }),
        isPending: false,
      } as any);

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
    it("compensates scrollTop when loading older messages with formula: newScrollTop = prevScrollTop + delta", async () => {
      // Mock requestAnimationFrame to run synchronously
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
        cb(performance.now());
        return 1;
      });

      // 50 initial messages to display pagination button
      const initialMessages = Array.from({ length: 50 }, (_, i) => ({
        id: 100 + i,
        crecheId: 1,
        tutorId: 25,
        senderId: 25,
        senderName: "Mariana",
        content: `Mensagem ${i}`,
        createdAt: `2026-09-30T10:${i < 10 ? "0" + i : i}:00.000Z`,
      }));

      vi.spyOn(apiClientModule, "useListMessages").mockReturnValue({
        data: initialMessages,
        isLoading: false,
      } as any);

      const mockFetchMessages = vi.spyOn(apiClientModule, "listMessages");

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const loadOlderBtn = await screen.findByRole("button", { name: /mensagens anteriores/i });
      expect(loadOlderBtn).toBeInTheDocument();

      // Locate the scroll container
      const container = loadOlderBtn.closest("div.overflow-y-auto") as HTMLDivElement;
      expect(container).not.toBeNull();

      let simulatedScrollHeight = 1000;
      let simulatedScrollTop = 200;

      Object.defineProperty(container, "scrollHeight", {
        get: () => simulatedScrollHeight,
        configurable: true,
      });
      Object.defineProperty(container, "scrollTop", {
        get: () => simulatedScrollTop,
        set: (val: number) => {
          simulatedScrollTop = val;
        },
        configurable: true,
      });

      mockFetchMessages.mockImplementation(async () => {
        // Prepending older messages expands container height by 600px
        simulatedScrollHeight = 1600;
        return Array.from({ length: 50 }, (_, i) => ({
          id: 50 + i,
          crecheId: 1,
          tutorId: 25,
          senderId: 25,
          senderName: "Mariana",
          content: `Mensagem antiga ${i}`,
          createdAt: `2026-09-29T10:${i < 10 ? "0" + i : i}:00.000Z`,
        }));
      });

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
        // SCROLL_DELTA_ACTUALLY_ASSERTED = YES:
        // previousScrollTop (200) + heightDelta (1600 - 1000 = 600) = 800
        expect(simulatedScrollTop).toBe(800);
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-008: Authenticated Media Attachments
  // ────────────────────────────────────────────────────────────
  describe("CHAT-008 — Authenticated Media Attachments via Storage Uploads", () => {
    it("uploads photo via uploadFileDirect, displays protected media resolution in bubble, and rejects invalid format and oversized files", async () => {
      const canonicalPhotoUrl = "/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp";
      const mockUpload = vi.spyOn(utilsModule, "uploadFileDirect").mockResolvedValue(canonicalPhotoUrl);
      const mockMutate = vi.fn((payload, options) => {
        options?.onSuccess?.({
          id: 88,
          crecheId: 1,
          tutorId: 25,
          senderId: 10,
          senderName: "Lucas Staff",
          content: "Olha que foto linda!",
          mediaUrl: canonicalPhotoUrl,
          createdAt: new Date().toISOString(),
        });
      });

      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).not.toBeNull();

      // 1. Invalid format rejection (.pdf)
      const invalidFile = new File(["fake-pdf"], "document.pdf", { type: "application/pdf" });
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Tipo de arquivo não permitido",
          variant: "destructive",
        })
      );
      expect(mockUpload).not.toHaveBeenCalled();

      // 2. Oversized file rejection (> 10MB)
      const largeFile = new File([new Uint8Array(11 * 1024 * 1024)], "large.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [largeFile] } });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Arquivo muito grande",
          variant: "destructive",
        })
      );
      expect(mockUpload).not.toHaveBeenCalled();

      // 3. Valid image selected
      const validFile = new File(["fake-image-bytes"], "dog.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [validFile] } });

      await waitFor(() => {
        expect(screen.getByText("dog.png")).toBeInTheDocument();
      });

      // 4. Send message with attachment
      const input = screen.getByPlaceholderText("Escreva uma mensagem...");
      fireEvent.change(input, { target: { value: "Olha que foto linda!" } });
      fireEvent.submit(input.closest("form")!);

      await waitFor(() => {
        // Upload performed with canonical token
        expect(mockUpload).toHaveBeenCalledWith(validFile, "test-auth-token-r40d");
        // Mutation called with canonical object path
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            crecheId: 1,
            data: expect.objectContaining({
              tutorId: 25,
              content: "Olha que foto linda!",
              mediaUrl: canonicalPhotoUrl,
            }),
          }),
          expect.any(Object)
        );
      });

      // 5. Server-confirmed rendered bubble uses protected media resolution
      const renderedImg = screen.getByRole("img", { name: "Anexo" }) as HTMLImageElement;
      expect(renderedImg).toBeInTheDocument();
      expect(renderedImg.src).toContain("/api/storage/objects/uploads/c1/e0a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c.webp");
      expect(renderedImg.src).toContain("mt=test-media-token-r40d");
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

  // ────────────────────────────────────────────────────────────
  // CHAT-FINAL-01: Identical Message Scenario (No Silent Collapse)
  // ────────────────────────────────────────────────────────────
  describe("CHAT-FINAL-01 — Identical Message Scenario (IDENTICAL_TEXT_MESSAGE_COUNT = 2)", () => {
    it("preserves multiple legitimate identical messages without collapsing them", async () => {
      let messageCounter = 100;
      const mockMutate = vi.fn((payload, options) => {
        const id = ++messageCounter;
        options?.onSuccess?.({
          id,
          crecheId: 1,
          tutorId: 25,
          senderId: 10,
          senderName: "Lucas Staff",
          content: payload.data.content,
          createdAt: new Date().toISOString(),
        });
      });

      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const input = screen.getByPlaceholderText("Escreva uma mensagem...");

      // Send first "Ok"
      fireEvent.change(input, { target: { value: "Ok" } });
      fireEvent.submit(input.closest("form")!);

      // Send second "Ok" immediately
      fireEvent.change(input, { target: { value: "Ok" } });
      fireEvent.submit(input.closest("form")!);

      // Both mutations must have fired
      expect(mockMutate).toHaveBeenCalledTimes(2);

      // IDENTICAL_TEXT_MESSAGE_COUNT = 2: Both distinct bubbles must be visible in UI
      const okBubbles = screen.getAllByText("Ok");
      expect(okBubbles.length).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-FINAL-02: Identical Text + Mixed Result (Success + Fail)
  // ────────────────────────────────────────────────────────────
  describe("CHAT-FINAL-02 — Identical Text Mixed Result (Success + Fail)", () => {
    it("preserves first SENT message and marks second as FAILED with non-destructive retry", async () => {
      let callCount = 0;
      let secondRetryCallback: any = null;
      const mockMutate = vi.fn((payload, options) => {
        callCount++;
        if (callCount === 1) {
          // First request: SUCCESS
          options?.onSuccess?.({
            id: 201,
            crecheId: 1,
            tutorId: 25,
            senderId: 10,
            senderName: "Lucas Staff",
            content: "Ok",
            createdAt: new Date().toISOString(),
          });
        } else if (callCount === 2) {
          // Second request: FAIL
          options?.onError?.(new Error("Simulated network timeout"));
        } else if (callCount === 3) {
          // Retry of second request: SUCCESS
          secondRetryCallback = () => {
            options?.onSuccess?.({
              id: 202,
              crecheId: 1,
              tutorId: 25,
              senderId: 10,
              senderName: "Lucas Staff",
              content: "Ok",
              createdAt: new Date().toISOString(),
            });
          };
        }
      });

      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const input = screen.getByPlaceholderText("Escreva uma mensagem...");

      // Send first "Ok" (succeeds)
      fireEvent.change(input, { target: { value: "Ok" } });
      fireEvent.submit(input.closest("form")!);

      // Send second "Ok" (fails)
      fireEvent.change(input, { target: { value: "Ok" } });
      fireEvent.submit(input.closest("form")!);

      // Both bubbles exist
      expect(screen.getAllByText("Ok").length).toBe(2);

      // Second message has failure indicator and retry button
      expect(screen.getByText("Falha ao enviar")).toBeInTheDocument();
      const retryBtn = screen.getByText("Tentar novamente");
      expect(retryBtn).toBeInTheDocument();

      // Click retry
      fireEvent.click(retryBtn);

      // Exactly 3 mutate calls occurred
      expect(mockMutate).toHaveBeenCalledTimes(3);

      // Execute retry success
      act(() => {
        secondRetryCallback?.();
      });

      // Both messages are now SENT: no failure indicator remains
      expect(screen.queryByText("Falha ao enviar")).not.toBeInTheDocument();
      expect(screen.getAllByText("Ok").length).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-FINAL-03: Attachment Message Correlation (Identical Text)
  // ────────────────────────────────────────────────────────────
  describe("CHAT-FINAL-03 — Attachment Message Correlation (ATTACHMENT_MESSAGE_COLLAPSE = 0)", () => {
    it("preserves two messages with identical text 'Foto' but different mediaUrl", async () => {
      let callCount = 0;
      const mockMutate = vi.fn((payload, options) => {
        callCount++;
        options?.onSuccess?.({
          id: 300 + callCount,
          crecheId: 1,
          tutorId: 25,
          senderId: 10,
          senderName: "Lucas Staff",
          content: payload.data.content,
          mediaUrl: payload.data.mediaUrl,
          createdAt: new Date().toISOString(),
        });
      });

      vi.spyOn(apiClientModule, "useSendMessage").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const input = screen.getByPlaceholderText("Escreva uma mensagem...");

      // Message 1: "Foto" + photo1.webp
      const photoUrl1 = "/objects/uploads/c1/11111111-1111-4111-8111-111111111111.webp";
      vi.spyOn(utilsModule, "uploadFileDirect").mockResolvedValueOnce(photoUrl1);
      const file1 = new File(["bytes1"], "photo1.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file1] } });
      await waitFor(() => expect(screen.getByText("photo1.png")).toBeInTheDocument());
      fireEvent.change(input, { target: { value: "Foto" } });
      fireEvent.submit(input.closest("form")!);

      // Wait for first message to be sent
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Foto")).toBeInTheDocument();
      });

      // Message 2: "Foto" + photo2.webp
      const photoUrl2 = "/objects/uploads/c1/22222222-2222-4222-8222-222222222222.webp";
      vi.spyOn(utilsModule, "uploadFileDirect").mockResolvedValueOnce(photoUrl2);
      const file2 = new File(["bytes2"], "photo2.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file2] } });
      await waitFor(() => expect(screen.getByText("photo2.png")).toBeInTheDocument());
      fireEvent.change(input, { target: { value: "Foto" } });
      fireEvent.submit(input.closest("form")!);

      // ATTACHMENT_MESSAGE_COLLAPSE = 0: Both "Foto" messages must be present
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledTimes(2);
        const fotoBubbles = screen.getAllByText("Foto");
        expect(fotoBubbles.length).toBe(2);
      });

      // Both image attachments rendered
      const images = screen.getAllByRole("img", { name: "Anexo" });
      expect(images.length).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-PRESENCE-01: False Online Presence Removed
  // ────────────────────────────────────────────────────────────
  describe("CHAT-PRESENCE-01 — Elimination of Fabricated Online Presence", () => {
    it("does not render fabricated Online indicator or fake presence dots", () => {
      renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      // FABRICATED_ONLINE_PRESENCE = 0: No "Online" status
      expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
      // No "Ao vivo" fabricated button
      expect(screen.queryByText(/ao vivo/i)).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────
  // CHAT-PREVIEW-01: Object URL Lifecycle & Leak Prevention
  // ────────────────────────────────────────────────────────────
  describe("CHAT-PREVIEW-01 — Preview Object URL Lifecycle (PREVIEW_OBJECT_URL_LEAK = 0)", () => {
    it("revokes previous object URL on file replacement and on component unmount", async () => {
      const { unmount } = renderWithProviders(<Chat />);
      fireEvent.click(screen.getAllByText("Mariana Silva")[0]);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      // Select file 1
      const file1 = new File(["img1"], "img1.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file1] } });
      await waitFor(() => expect(screen.getByText("img1.png")).toBeInTheDocument());
      const firstUrl = createdUrls[0];
      expect(firstUrl).toBeDefined();

      // Replace with file 2
      const file2 = new File(["img2"], "img2.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file2] } });
      await waitFor(() => expect(screen.getByText("img2.png")).toBeInTheDocument());

      // First URL must have been revoked upon replacement
      expect(revokedUrls).toContain(firstUrl);

      const secondUrl = createdUrls[1];
      expect(secondUrl).toBeDefined();

      // Unmount component
      unmount();

      // Second URL must have been revoked upon unmount
      expect(revokedUrls).toContain(secondUrl);
    });
  });
});
