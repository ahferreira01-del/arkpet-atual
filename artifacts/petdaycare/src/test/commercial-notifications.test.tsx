import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import AdminProposals from "../pages/admin/proposals";
import Billing from "../pages/billing/index";

let mockCurrentUser: { id: number; email: string; role: string; crecheId?: number } = {
  id: 5,
  email: "gestor@petfeliz.com",
  role: "creche_admin",
  crecheId: 10,
};

vi.mock("../hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({
    user: mockCurrentUser,
    isLoading: false,
  })),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListCreches: vi.fn(() => ({
    data: [
      { id: 10, name: "Creche Pata Feliz" },
      { id: 20, name: "Creche Amigo Fiel" },
    ],
    isLoading: false,
  })),
  useGetBillingPlans: vi.fn(() => ({
    data: [
      { id: 1, name: "Essencial", priceBrl: 100, prices: [{ interval: "month", discountPct: 0 }] },
      { id: 2, name: "Profissional", priceBrl: 200, prices: [{ interval: "month", discountPct: 0 }] },
    ],
    isLoading: false,
  })),
  useGetBillingSubscription: vi.fn(() => ({
    data: {
      id: 1,
      crecheId: 10,
      planId: 1,
      status: "active",
      plan: { name: "Essencial", petLimit: 30 },
      currentPeriodEnd: "2026-12-31T00:00:00Z",
    },
    isLoading: false,
  })),
  useCreateBillingCheckout: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useCreateBillingPortal: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

describe("Commercial Notifications Frontend Tests (R36.H)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "mock_token");
    mockCurrentUser = { id: 5, email: "gestor@petfeliz.com", role: "creche_admin", crecheId: 10 };
  });

  describe("1. Creche Admin — Customer Notifications Center", () => {
    const mockNotifications = [
      {
        id: 1,
        title: "Nova Proposta Comercial Recebida",
        body: "Sua creche recebeu uma nova proposta comercial no valor de R$ 180,00 (mensal).",
        category: "COMMERCIAL",
        deepLink: "/assinatura",
        readAt: null,
        createdAt: "2026-09-08T10:00:00.000Z",
      },
      {
        id: 2,
        title: "Campanha Promocional Concluída",
        body: "O ciclo de benefícios da campanha foi concluído com sucesso.",
        category: "PROMOTION",
        deepLink: null,
        readAt: "2026-09-08T11:00:00.000Z",
        createdAt: "2026-09-08T09:00:00.000Z",
      },
    ];

    it("renders commercial notifications card with unread count and badge", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/commercial-notifications")) {
          return {
            ok: true,
            json: async () => ({ notifications: mockNotifications, unreadCount: 1 }),
          } as any;
        }
        if (urlStr.includes("/proposals")) {
          return { ok: true, json: async () => ({ proposals: [] }) } as any;
        }
        if (urlStr.includes("/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("Atualizações Comerciais")).toBeInTheDocument();
      });

      expect(screen.getByText("1 nova")).toBeInTheDocument();
      expect(screen.getByText("Nova Proposta Comercial Recebida")).toBeInTheDocument();
      expect(screen.getByText("Campanha Promocional Concluída")).toBeInTheDocument();
    });

    it("marks single notification as read on button click", async () => {
      let markedId: string | null = null;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/commercial-notifications/1/read") && opts?.method === "POST") {
          markedId = "1";
          return { ok: true, json: async () => ({ success: true }) } as any;
        }
        if (urlStr.includes("/commercial-notifications")) {
          return {
            ok: true,
            json: async () => ({ notifications: mockNotifications, unreadCount: 1 }),
          } as any;
        }
        return { ok: true, json: async () => ({ proposals: [], requests: [] }) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("Nova Proposta Comercial Recebida")).toBeInTheDocument();
      });

      const markReadBtn = screen.getByRole("button", { name: "Marcar como lida" });
      fireEvent.click(markReadBtn);

      await waitFor(() => {
        expect(markedId).toBe("1");
      });
    });

    it("marks all notifications as read on 'Marcar todas como lidas' button click", async () => {
      let markAllCalled = false;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/commercial-notifications/read-all") && opts?.method === "POST") {
          markAllCalled = true;
          return { ok: true, json: async () => ({ success: true, count: 1 }) } as any;
        }
        if (urlStr.includes("/commercial-notifications")) {
          return {
            ok: true,
            json: async () => ({ notifications: mockNotifications, unreadCount: 1 }),
          } as any;
        }
        return { ok: true, json: async () => ({ proposals: [], requests: [] }) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("Marcar todas como lidas")).toBeInTheDocument();
      });

      const markAllBtn = screen.getByRole("button", { name: "Marcar todas como lidas" });
      fireEvent.click(markAllBtn);

      await waitFor(() => {
        expect(markAllCalled).toBe(true);
      });
    });

    it("renders 'Visualizar' button for safe deep link and does not render for null deep link", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/commercial-notifications")) {
          return {
            ok: true,
            json: async () => ({ notifications: mockNotifications, unreadCount: 1 }),
          } as any;
        }
        return { ok: true, json: async () => ({ proposals: [], requests: [] }) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("Atualizações Comerciais")).toBeInTheDocument();
      });

      // Exactly one "Visualizar" button rendered (for notification #1 with /assinatura, but not #2 with null)
      const visualizerButtons = screen.getAllByRole("button", { name: "Visualizar" });
      expect(visualizerButtons).toHaveLength(1);
    });
  });

  describe("2. Master Admin — Operational Alerts Tab", () => {
    const mockOperational = [
      {
        id: 10,
        title: "Proposta Comercial Aceita pelo Cliente",
        body: "A creche #10 aceitou a proposta comercial #101.",
        category: "COMMERCIAL",
        crecheId: 10,
        deepLink: "/admin/proposals",
        readAt: null,
        createdAt: "2026-09-08T12:00:00.000Z",
      },
    ];

    it("displays operational alerts in dedicated Notificações tab with unread count", async () => {
      mockCurrentUser = { id: 1, email: "admin@arkpet.com", role: "master_admin" };

      vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/operational-notifications")) {
          return {
            ok: true,
            json: async () => ({ notifications: mockOperational, unreadCount: 1 }),
          } as any;
        }
        if (urlStr.includes("/commercial/proposals")) {
          return { ok: true, json: async () => ({ proposals: [] }) } as any;
        }
        if (urlStr.includes("/commercial/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      renderWithProviders(<AdminProposals />);

      await waitFor(() => {
        expect(screen.getByText("Notificações (1)")).toBeInTheDocument();
      });

      // Switch to notifications tab
      fireEvent.click(screen.getByText("Notificações (1)"));

      await waitFor(() => {
        expect(screen.getByText("Proposta Comercial Aceita pelo Cliente")).toBeInTheDocument();
        expect(screen.getByText("Creche #10")).toBeInTheDocument();
      });
    });

    it("marks operational alert as read on button click", async () => {
      mockCurrentUser = { id: 1, email: "admin@arkpet.com", role: "master_admin" };
      let markedAlertId: string | null = null;

      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/operational-notifications/10/read") && opts?.method === "POST") {
          markedAlertId = "10";
          return { ok: true, json: async () => ({ success: true }) } as any;
        }
        if (urlStr.includes("/operational-notifications")) {
          return {
            ok: true,
            json: async () => ({ notifications: mockOperational, unreadCount: 1 }),
          } as any;
        }
        return { ok: true, json: async () => ({ proposals: [], requests: [] }) } as any;
      });

      renderWithProviders(<AdminProposals />);

      await waitFor(() => {
        expect(screen.getByText("Notificações (1)")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Notificações (1)"));

      await waitFor(() => {
        expect(screen.getByText("Proposta Comercial Aceita pelo Cliente")).toBeInTheDocument();
      });

      const markBtn = screen.getByRole("button", { name: "Marcar como lida" });
      fireEvent.click(markBtn);

      await waitFor(() => {
        expect(markedAlertId).toBe("10");
      });
    });
  });

  describe("3. Role Isolation — No UI Exposure for Tutor / Staff", () => {
    it("does not render commercial notifications card or make notifications query for tutor", async () => {
      mockCurrentUser = { id: 20, email: "tutor@exemplo.com", role: "tutor", crecheId: 10 };
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
        return { ok: true, json: async () => ({}) } as any;
      });

      renderWithProviders(<Billing />);

      // Wait a moment to ensure no render occurs
      await waitFor(() => {
        expect(screen.queryByText("Atualizações Comerciais")).not.toBeInTheDocument();
      });

      // Verify no commercial notifications endpoint was called
      const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
      const calledCommercialNotifications = calls.some((url) => url.includes("/commercial-notifications"));
      expect(calledCommercialNotifications).toBe(false);
    });

    it("does not render commercial notifications card or make notifications query for staff", async () => {
      mockCurrentUser = { id: 30, email: "staff@petfeliz.com", role: "staff", crecheId: 10 };
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async () => {
        return { ok: true, json: async () => ({}) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.queryByText("Atualizações Comerciais")).not.toBeInTheDocument();
      });

      const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
      const calledCommercialNotifications = calls.some((url) => url.includes("/commercial-notifications"));
      expect(calledCommercialNotifications).toBe(false);
    });
  });
});
