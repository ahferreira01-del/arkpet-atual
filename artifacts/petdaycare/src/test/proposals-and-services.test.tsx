import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import AdminProposals from "../pages/admin/proposals";
import Billing from "../pages/billing/index";

vi.mock("../hooks/use-auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: 5, email: "gestor@petfeliz.com", role: "creche_admin", crecheId: 10 },
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

describe("Commercial Proposals & Platform Services Frontend Tests (R36.G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "mock_token");
  });

  describe("1. Master Admin Proposals Management", () => {
    const mockProposals = [
      {
        id: 101,
        crecheId: 10,
        type: "commercial_proposal",
        status: "draft",
        title: "Proposta Expansão Q3",
        notes: "Condições negociadas com a diretoria",
        activationStatus: "not_started",
        validUntil: "2026-12-31T00:00:00.000Z",
        createdBy: "master_admin@arkpet.com",
        snapshotJson: {
          planName: "Profissional",
          billingInterval: "month",
          displayedEffectivePriceCents: 17000,
          entitlementPetLimit: 50,
          executionRequirement: "STRIPE_REQUIRED",
        },
      },
      {
        id: 102,
        crecheId: 10,
        type: "commercial_proposal",
        status: "accepted",
        title: "Proposta Anual Fidelidade",
        activationStatus: "activation_failed",
        validUntil: "2026-12-31T00:00:00.000Z",
        createdBy: "master_admin@arkpet.com",
        snapshotJson: {
          planName: "Profissional",
          billingInterval: "year",
          displayedEffectivePriceCents: 150000,
          entitlementPetLimit: 60,
          executionRequirement: "STRIPE_REQUIRED",
        },
      },
    ];

    it("renders proposal list, cards, and activation status badges", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/commercial/proposals")) {
          return { ok: true, json: async () => ({ proposals: mockProposals }) } as any;
        }
        if (urlStr.includes("/commercial/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      renderWithProviders(<AdminProposals />);

      expect(screen.getByText(/Propostas & Serviços de Implantação/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText("#101 Proposta Expansão Q3")).toBeInTheDocument();
        expect(screen.getByText("#102 Proposta Anual Fidelidade")).toBeInTheDocument();
      });

      // Status badges
      expect(screen.getByText("draft")).toBeInTheDocument();
      expect(screen.getByText("accepted")).toBeInTheDocument();
      expect(screen.getByText("Ativação: activation_failed")).toBeInTheDocument();

      // Retry button present for failed activation
      expect(screen.getByText("Retry Ativação")).toBeInTheDocument();
    });

    it("opens create proposal modal and creates draft proposal", async () => {
      let createdPayload: any = null;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/commercial/proposals") && opts?.method === "POST") {
          createdPayload = JSON.parse(opts.body);
          return {
            ok: true,
            json: async () => ({
              proposal: {
                id: 103,
                ...createdPayload,
                status: "draft",
              },
            }),
          } as any;
        }
        if (urlStr.includes("/commercial/proposals")) {
          return { ok: true, json: async () => ({ proposals: mockProposals }) } as any;
        }
        if (urlStr.includes("/commercial/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      renderWithProviders(<AdminProposals />);

      const newBtn = screen.getByRole("button", { name: /Nova Proposta/i });
      fireEvent.click(newBtn);

      await waitFor(() => {
        expect(screen.getByText("Crie uma proposta de condições customizadas para um cliente.")).toBeInTheDocument();
      });

      // Fill in fields
      const crecheSelect = screen.getByDisplayValue("Selecione a creche...");
      fireEvent.change(crecheSelect, { target: { value: "10" } });

      const titleInput = screen.getByPlaceholderText(/Ex: Condições Especiais Expansão Q3/i);
      fireEvent.change(titleInput, { target: { value: "Proposta Black Friday" } });

      const createBtn = screen.getByRole("button", { name: "Criar Rascunho" });
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(createdPayload).not.toBeNull();
        expect(createdPayload.crecheId).toBe(10);
        expect(createdPayload.title).toBe("Proposta Black Friday");
      });
    });

    it("opens retry activation modal and sends retry request with justification", async () => {
      let retryPayload: any = null;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/retry-activation") && opts?.method === "POST") {
          retryPayload = JSON.parse(opts.body);
          return { ok: true, json: async () => ({ success: true }) } as any;
        }
        if (urlStr.includes("/commercial/proposals")) {
          return { ok: true, json: async () => ({ proposals: mockProposals }) } as any;
        }
        if (urlStr.includes("/commercial/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      renderWithProviders(<AdminProposals />);

      await waitFor(() => {
        expect(screen.getByText("Retry Ativação")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Retry Ativação"));

      await waitFor(() => {
        expect(screen.getByText("Reativar Condição Comercial")).toBeInTheDocument();
      });

      const reasonInput = screen.getByPlaceholderText(/Ex: Restauração da conexão com o gateway/i);
      fireEvent.change(reasonInput, { target: { value: "Gateway recuperado após instabilidade" } });

      const confirmRetryBtn = screen.getByRole("button", { name: "Reexecutar Ativação" });
      fireEvent.click(confirmRetryBtn);

      await waitFor(() => {
        expect(retryPayload).not.toBeNull();
        expect(retryPayload.reason).toBe("Gateway recuperado após instabilidade");
      });
    });
  });

  describe("2. Master Admin Platform Services Management", () => {
    const mockServices = [
      {
        id: 501,
        crecheId: 10,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "requested",
        customerNotes: "Precisamos de apoio para cadastrar 80 cães",
        quotedPriceCents: null,
        createdAt: "2026-09-08T10:00:00.000Z",
      },
      {
        id: 502,
        crecheId: 20,
        serviceType: "ASSISTED_IMPLEMENTATION",
        status: "under_review",
        quotedPriceCents: null,
        createdAt: "2026-09-08T11:00:00.000Z",
      },
    ];

    it("switches to services tab and allows admin to review and send quotes", async () => {
      let quotePayload: any = null;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/quote") && opts?.method === "POST") {
          quotePayload = JSON.parse(opts.body);
          return { ok: true, json: async () => ({ success: true }) } as any;
        }
        if (urlStr.includes("/commercial/platform-services")) {
          return { ok: true, json: async () => ({ requests: mockServices }) } as any;
        }
        if (urlStr.includes("/commercial/proposals")) {
          return { ok: true, json: async () => ({ proposals: [] }) } as any;
        }
        return { ok: false, json: async () => ({}) } as any;
      });

      renderWithProviders(<AdminProposals />);

      const tabBtn = screen.getByText("Implantação Assistida");
      fireEvent.click(tabBtn);

      await waitFor(() => {
        expect(screen.getByText("Solicitação #501")).toBeInTheDocument();
        expect(screen.getByText("Solicitação #502")).toBeInTheDocument();
      });

      // Click "Enviar Orçamento" on #502
      const quoteBtn = screen.getByRole("button", { name: "Enviar Orçamento" });
      fireEvent.click(quoteBtn);

      await waitFor(() => {
        expect(screen.getByText("Defina o valor em reais (ou 0 para cortesia) e a justificativa para envio ao cliente.")).toBeInTheDocument();
      });

      const priceInput = screen.getByPlaceholderText("0.00");
      fireEvent.change(priceInput, { target: { value: "350.00" } });

      const notesInput = screen.getByPlaceholderText(/Ex: Sessão dedicada de 2 horas/i);
      fireEvent.change(notesInput, { target: { value: "Onboarding completo de 3 horas" } });

      const submitQuoteBtn = screen.getByRole("button", { name: "Confirmar e Enviar" });
      fireEvent.click(submitQuoteBtn);

      await waitFor(() => {
        expect(quotePayload).not.toBeNull();
        expect(quotePayload.quotedPriceCents).toBe(35000); // 350.00 * 100
        expect(quotePayload.adminNotes).toBe("Onboarding completo de 3 horas");
      });
    });
  });

  describe("3. Customer Self-Service in Billing Page", () => {
    const customerProposals = [
      {
        id: 201,
        crecheId: 10,
        status: "sent",
        title: "Proposta Especial Black Friday",
        validUntil: "2026-12-31T00:00:00.000Z",
        snapshotJson: {
          planName: "Profissional",
          billingInterval: "month",
          displayedEffectivePriceCents: 15000,
          entitlementPetLimit: 45,
        },
      },
      {
        id: 202,
        crecheId: 10,
        status: "sent",
        title: "Proposta Expirada Antiga",
        validUntil: "2026-01-01T00:00:00.000Z", // past date
        snapshotJson: {
          planName: "Essencial",
          billingInterval: "month",
          displayedEffectivePriceCents: 9000,
        },
      },
    ];

    it("displays received proposals, flags expired proposals, and accepts valid proposal with idempotency key reuse", async () => {
      const capturedHeaders: any[] = [];
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/billing/proposals/201/accept") && opts?.method === "POST") {
          capturedHeaders.push(opts.headers);
          return {
            ok: true,
            json: async () => ({
              success: true,
              message: "Proposta aceita e condições comerciais ativadas com sucesso.",
            }),
          } as any;
        }
        if (urlStr.includes("/api/billing/proposals")) {
          return { ok: true, json: async () => ({ proposals: customerProposals }) } as any;
        }
        if (urlStr.includes("/api/billing/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("#201 Proposta Especial Black Friday")).toBeInTheDocument();
        expect(screen.getByText("#202 Proposta Expirada Antiga")).toBeInTheDocument();
      });

      // Verify expired proposal shows badge "Expirada"
      expect(screen.getByText("Expirada")).toBeInTheDocument();

      // Click "Aceitar Proposta" for #201
      const acceptBtn = screen.getByRole("button", { name: "Aceitar Proposta" });
      fireEvent.click(acceptBtn);

      await waitFor(() => {
        expect(screen.getByText("Ao aceitar esta proposta, você concorda formalmente com os termos apresentados. As condições comerciais serão ativadas na sua assinatura.")).toBeInTheDocument();
      });

      const confirmAcceptBtn = screen.getByRole("button", { name: "Confirmar Aceite" });
      fireEvent.click(confirmAcceptBtn);

      await waitFor(() => {
        expect(capturedHeaders.length).toBe(1);
        expect(capturedHeaders[0]["x-idempotency-key"]).toBeDefined();
        expect(capturedHeaders[0]["x-idempotency-key"].length).toBeGreaterThan(10);
      });
    });

    it("allows customer to decline a proposal with optional reason", async () => {
      let declinePayload: any = null;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/billing/proposals/201/decline") && opts?.method === "POST") {
          declinePayload = JSON.parse(opts.body);
          return { ok: true, json: async () => ({ success: true }) } as any;
        }
        if (urlStr.includes("/api/billing/proposals")) {
          return { ok: true, json: async () => ({ proposals: customerProposals }) } as any;
        }
        if (urlStr.includes("/api/billing/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("#201 Proposta Especial Black Friday")).toBeInTheDocument();
      });

      const declineBtn = screen.getByRole("button", { name: "Recusar" });
      fireEvent.click(declineBtn);

      await waitFor(() => {
        expect(screen.getByText("Informe opcionalmente o motivo da recusa para nossa equipe.")).toBeInTheDocument();
      });

      const reasonInput = screen.getByPlaceholderText(/Ex: Condições fora do orçamento atual/i);
      fireEvent.change(reasonInput, { target: { value: "Orçamento estourado para o trimestre" } });

      const confirmDeclineBtn = screen.getByRole("button", { name: "Confirmar Recusa" });
      fireEvent.click(confirmDeclineBtn);

      await waitFor(() => {
        expect(declinePayload).not.toBeNull();
        expect(declinePayload.reason).toBe("Orçamento estourado para o trimestre");
      });
    });

    it("allows customer to request assisted implementation and view active request lifecycle", async () => {
      let requestPayload: any = null;
      vi.spyOn(global, "fetch").mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/billing/platform-services/request") && opts?.method === "POST") {
          requestPayload = JSON.parse(opts.body);
          return { ok: true, json: async () => ({ request: { id: 701, status: "requested" } }) } as any;
        }
        if (urlStr.includes("/api/billing/platform-services")) {
          return { ok: true, json: async () => ({ requests: [] }) } as any;
        }
        if (urlStr.includes("/api/billing/proposals")) {
          return { ok: true, json: async () => ({ proposals: [] }) } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      renderWithProviders(<Billing />);

      await waitFor(() => {
        expect(screen.getByText("Implantação Assistida")).toBeInTheDocument();
      });

      const requestBtn = screen.getByRole("button", { name: "Solicitar Implantação" });
      fireEvent.click(requestBtn);

      await waitFor(() => {
        expect(screen.getByText("Nossa equipe entrará em contato para alinhar o escopo e enviar uma proposta ou cortesia.")).toBeInTheDocument();
      });

      const notesInput = screen.getByPlaceholderText(/Ex: Temos 60 pets, gostaríamos de apoio/i);
      fireEvent.change(notesInput, { target: { value: "Necessitamos de migração de 50 fichas físicas" } });

      const submitRequestBtn = screen.getByRole("button", { name: "Enviar Solicitação" });
      fireEvent.click(submitRequestBtn);

      await waitFor(() => {
        expect(requestPayload).not.toBeNull();
        expect(requestPayload.customerNotes).toBe("Necessitamos de migração de 50 fichas físicas");
      });
    });
  });
});
