import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { Suspense } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { ErrorState } from "@/components/ui/error-state";
import { UpdatePrompt } from "@/components/update-prompt";
import fs from "fs";
import path from "path";

// Helper to create a fresh QueryClient for test isolation
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        staleTime: 10_000,
      },
    },
  });
}

describe("R40.B — PERFORMANCE & PWA HARDENING TEST SUITE", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  // ────────────────────────────────────────────────────────────
  // PERF-001: Lazy Route Loading
  // ────────────────────────────────────────────────────────────
  describe("PERF-001 — Lazy Route Loading & Suspense Fallback", () => {
    it("renders PageSkeleton during asynchronous component loading without layout collapse", async () => {
      let resolvePromise: (value: any) => void;
      const deferredPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const LazyComponent = React.lazy(
        () => deferredPromise as Promise<{ default: React.ComponentType }>
      );

      render(
        <Suspense fallback={<PageSkeleton />}>
          <LazyComponent />
        </Suspense>
      );

      // Skeleton must be immediately visible with accessible status
      const skeleton = screen.getByRole("status", { name: /carregando página/i });
      expect(skeleton).toBeInTheDocument();

      // Resolve the lazy component
      await act(async () => {
        resolvePromise!({
          default: () => <div data-testid="loaded-route">Conteúdo Carregado</div>,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("loaded-route")).toBeInTheDocument();
      });
      expect(screen.queryByRole("status", { name: /carregando página/i })).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────
  // PERF-002: Query Deduplication
  // ────────────────────────────────────────────────────────────
  describe("PERF-002 — TanStack Query Deduplication", () => {
    it("deduplicates concurrent fetches for identical query keys with positive staleTime", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ count: 5 });

      function TestBadgeConsumer({ id }: { id: string }) {
        const { data, isLoading } = useQuery({
          queryKey: ["badge-test-shared"],
          queryFn: fetchSpy,
          staleTime: 15_000,
        });
        return (
          <div data-testid={`badge-${id}`}>
            {isLoading ? "loading" : String(data?.count)}
          </div>
        );
      }

      // Render two independent consumers concurrently (simulating Sidebar + BottomNav)
      render(
        <QueryClientProvider client={queryClient}>
          <TestBadgeConsumer id="sidebar" />
          <TestBadgeConsumer id="bottom-nav" />
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("badge-sidebar")).toHaveTextContent("5");
        expect(screen.getByTestId("badge-bottom-nav")).toHaveTextContent("5");
      });

      // Exactly ONE fetch should have been executed despite two concurrent mounting consumers
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // PERF-003: Offline State
  // ────────────────────────────────────────────────────────────
  describe("PERF-003 — Offline UX & State Feedback", () => {
    it("renders OfflineBanner when browser transitions to offline state", () => {
      // Mock navigator.onLine = false
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      render(
        <QueryClientProvider client={queryClient}>
          <OfflineBanner />
        </QueryClientProvider>
      );

      // Trigger offline event
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      const alert = screen.getByRole("alert", { name: /alerta de conexão/i });
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(/sem conexão com a internet/i);
    });

    it("renders ErrorState with offline variant correctly providing reconnect action", () => {
      const retryMock = vi.fn();
      render(
        <ErrorState
          type="offline"
          action={{ label: "Tentar Reconectar", onClick: retryMock }}
        />
      );

      expect(screen.getByText("Sem conexão com a internet")).toBeInTheDocument();
      const retryButton = screen.getByRole("button", { name: "Tentar Reconectar" });
      fireEvent.click(retryButton);
      expect(retryMock).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // PERF-004: Reconnect Recovery
  // ────────────────────────────────────────────────────────────
  describe("PERF-004 — Reconnect & Active Query Revalidation", () => {
    it("triggers revalidation of active queries and displays restored notice on online event", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);

      const refetchSpy = vi.fn().mockResolvedValue({ status: "refreshed" });

      function ActiveScreenConsumer() {
        const { data } = useQuery({
          queryKey: ["active-screen-data"],
          queryFn: refetchSpy,
        });
        return <div>{data?.status ?? "initial"}</div>;
      }

      render(
        <QueryClientProvider client={queryClient}>
          <OfflineBanner />
          <ActiveScreenConsumer />
        </QueryClientProvider>
      );

      // Transition to offline first
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      // Transition back online
      act(() => {
        window.dispatchEvent(new Event("online"));
      });

      // Restored notice must be displayed
      const statusNotice = screen.getByRole("status", { name: /status da conexão/i });
      expect(statusNotice).toBeInTheDocument();
      expect(statusNotice).toHaveTextContent(/conexão restabelecida/i);

      // Active queries must be refetched
      await waitFor(() => {
        expect(refetchSpy).toHaveBeenCalled();
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // PWA-001: SW Registration
  // ────────────────────────────────────────────────────────────
  describe("PWA-001 — Service Worker Registration Scope & Timing", () => {
    it("main.tsx registers service worker scoped to BASE_URL deferred to load event", () => {
      const mainPath = path.resolve(__dirname, "../main.tsx");
      const mainContent = fs.readFileSync(mainPath, "utf-8");

      expect(mainContent).toContain("navigator.serviceWorker");
      expect(mainContent).toContain(".register(swPath)");
      expect(mainContent).toContain('window.addEventListener("load"');
      expect(mainContent).toContain("import.meta.env.BASE_URL");
    });
  });

  // ────────────────────────────────────────────────────────────
  // PWA-002: Update Detection
  // ────────────────────────────────────────────────────────────
  describe("PWA-002 — App Update Detection & Non-Blocking Prompt", () => {
    it("UpdatePrompt displays floating non-blocking banner without full-page modal takeover", async () => {
      const mockSw = { postMessage: vi.fn() } as unknown as ServiceWorker;

      // Mock service worker registration with a waiting worker
      const mockReg = {
        waiting: mockSw,
        installing: null,
        addEventListener: vi.fn(),
      };

      Object.defineProperty(navigator, "serviceWorker", {
        value: {
          ready: Promise.resolve(mockReg as any),
          controller: {} as any,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });

      render(<UpdatePrompt />);

      await waitFor(() => {
        const updateRegion = screen.getByRole("region", { name: /atualização disponível/i });
        expect(updateRegion).toBeInTheDocument();
      });

      expect(screen.getByText("Nova versão disponível")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /atualizar/i })).toBeInTheDocument();

      // Verify "Depois" button allows dismissing prompt without interrupting critical operations
      const depoisButton = screen.getByRole("button", { name: /depois/i });
      expect(depoisButton).toBeInTheDocument();
      fireEvent.click(depoisButton);

      expect(screen.queryByRole("region", { name: /atualização disponível/i })).not.toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────
  // PWA-003: Cache Versioning
  // ────────────────────────────────────────────────────────────
  describe("PWA-003 — Cache Versioning & Purge Policy", () => {
    it("sw.js specifies canonical CACHE_NAME and purges obsolete caches on activate", () => {
      const swPath = path.resolve(__dirname, "../../public/sw.js");
      const swContent = fs.readFileSync(swPath, "utf-8");

      expect(swContent).toMatch(/const CACHE_NAME = "arkpet-v\d+";/);
      expect(swContent).toContain("caches.keys()");
      expect(swContent).toContain(".filter((name) => name !== CACHE_NAME)");
      expect(swContent).toContain("caches.delete(name)");
    });
  });

  // ────────────────────────────────────────────────────────────
  // PWA-004: Push Handlers Preserved
  // ────────────────────────────────────────────────────────────
  describe("PWA-004 — Push Handlers & Navigation Resolution Preserved", () => {
    it("sw.js maintains complete push event handling and route resolution for operational and chat events", () => {
      const swPath = path.resolve(__dirname, "../../public/sw.js");
      const swContent = fs.readFileSync(swPath, "utf-8");

      // Push event listener
      expect(swContent).toContain('self.addEventListener("push"');
      expect(swContent).toContain("showNotification");

      // Fallback notification logic
      expect(swContent).toContain("showNotification with full options failed, retrying minimal fallback");

      // Notification click & routing
      expect(swContent).toContain('self.addEventListener("notificationclick"');
      expect(swContent).toContain("resolveTargetPath");

      // Domain route coverage in SW
      expect(swContent).toContain("/bookings");
      expect(swContent).toContain("/chat");
      expect(swContent).toContain("/staff");
      expect(swContent).toContain("/financial");
      expect(swContent).toContain("/tutor/store");
      expect(swContent).toContain("/tutor/financial");

      // Foreground postMessage bridge
      expect(swContent).toContain('c.postMessage({ kind: "push", payload: data })');
    });
  });
});
