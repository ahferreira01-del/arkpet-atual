import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommercialSupportModal } from "../pages/admin/commercial-support-modal";

describe("Master Admin Commercial Support & Overrides UI Tests (R36.D Correction 10)", () => {
  const mockCreche = {
    id: 1,
    name: "Creche Pet Paradise",
    email: "contato@petparadise.com",
    status: "active",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "mock_token_master_admin");
  });

  it("1. opens commercial support console and renders basic creche information", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: {
          id: 10,
          status: "active",
          hasStripeCustomer: true,
          hasStripeSubscription: true,
        },
        plan: {
          id: 1,
          name: "Plano Intermediário",
          priceCents: 31990,
          petLimit: 30,
        },
        activeCondition: null,
        pricing: {
          catalogPriceCents: 31990,
          finalEffectivePriceCents: 31990,
        },
        limits: {
          activePetCount: 15,
          effectivePetLimit: 30,
          catalogPetLimit: 30,
          isCustomLimit: false,
        },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    expect(screen.getByRole("dialog", { name: "Suporte Comercial & Faturamento" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Creche Pet Paradise")).toBeInTheDocument();
      expect(screen.getByText("Plano Intermediário")).toBeInTheDocument();
      expect(screen.getAllByText(/319,90\/mês/).length).toBeGreaterThan(0);
    });
  });

  it("2. renders NOT_PROVISIONED state with explicit administrative banner", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "NOT_PROVISIONED",
        subscription: null,
        plan: null,
        activeCondition: null,
        pricing: null,
        limits: {
          activePetCount: 5,
          effectivePetLimit: null,
          catalogPetLimit: null,
          isCustomLimit: false,
        },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Assinatura não provisionada")).toBeInTheDocument();
      expect(screen.getByText(/Esta unidade foi cadastrada sem uma assinatura vinculada/i)).toBeInTheDocument();
    });
  });

  it("3. renders Stripe connection indicators without implying commercial parity (Correction 9)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: {
          id: 10,
          status: "active",
          hasStripeCustomer: true,
          hasStripeSubscription: false,
        },
        plan: { id: 1, name: "Plano Base", priceCents: 19990, petLimit: 20 },
        pricing: { finalEffectivePriceCents: 19990 },
        limits: { activePetCount: 2, effectivePetLimit: 20 },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Gateway Stripe (Leitura)")).toBeInTheDocument();
      expect(screen.getByText("Vinculado")).toBeInTheDocument();
      expect(screen.getByText("Não vinculado")).toBeInTheDocument();
      // Must NOT show "Stripe synchronized"
      expect(screen.queryByText(/Stripe synchronized/i)).toBeNull();
      expect(screen.queryByText(/Sincronizado com o Stripe/i)).toBeNull();
    });
  });

  it("4. renders draft condition separately from active price (Correction 8)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Pro", priceCents: 31990, petLimit: 30 },
        pricing: {
          catalogPriceCents: 31990,
          finalEffectivePriceCents: 31990, // active price is still 31990
        },
        limits: { activePetCount: 10, effectivePetLimit: 30 },
        draftCondition: {
          condition: { id: 99, status: "draft", pricingOverrideType: "fixed_amount" },
          proposedPricing: { finalEffectivePriceCents: 24990 },
          statusNotice: "Ainda não aplicado / aguardando etapa Stripe",
        },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      // Current active price
      expect(screen.getAllByText(/319,90\/mês/).length).toBeGreaterThan(0);
      // Draft proposal rendered separately with notice
      expect(screen.getByText("Proposta em Rascunho")).toBeInTheDocument();
      expect(screen.getByText(/249,90\/mês/)).toBeInTheDocument();
      expect(screen.getByText("Ainda não aplicado / aguardando etapa Stripe")).toBeInTheDocument();
    });
  });

  it("5. petLimit-only edit renders 'Aplicar Alteração' button and submits to pet-limit-override", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
        pricing: { finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 10, effectivePetLimit: 20 },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Personalizar Condição Comercial")).toBeInTheDocument();
    });

    // Open customize panel
    fireEvent.click(screen.getByText("Personalizar Condição Comercial"));

    expect(screen.getByText("Aplicar Alteração")).toBeInTheDocument();

    // Fill in new pet limit and reason
    const limitInput = screen.getByPlaceholderText("Ex: 50");
    fireEvent.change(limitInput, { target: { value: "35" } });

    const reasonInput = screen.getByPlaceholderText(/Descreva o motivo comercial/i);
    fireEvent.change(reasonInput, { target: { value: "Aumento acordado de capacidade" } });

    // Mock mutation response
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        condition: { id: 101, entitlementPetLimit: 35 },
      }),
    } as any);

    // Mock refresh fetch
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
        pricing: { finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 10, effectivePetLimit: 35 },
      }),
    } as any);

    fireEvent.click(screen.getByText("Aplicar Alteração"));

    await waitFor(() => {
      // Verify pet-limit-override endpoint was called with X-Idempotency-Key
      const mutationCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("pet-limit-override"),
      );
      expect(mutationCall).toBeDefined();
      expect(mutationCall?.[1]?.headers).toHaveProperty("X-Idempotency-Key");
      expect(screen.getByText("Limite de pets personalizado aplicado com sucesso!")).toBeInTheDocument();
    });
  });

  it("6. pricing edit renders 'Salvar Rascunho Comercial' with Stripe-not-yet-applied notice", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
        pricing: { finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 5, effectivePetLimit: 20 },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Personalizar Condição Comercial")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Personalizar Condição Comercial"));

    // Select percentage discount
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "percentage" } });

    // Enter 15%
    const valueInput = screen.getByPlaceholderText("15");
    fireEvent.change(valueInput, { target: { value: "15" } });

    // Enter reason
    const reasonInput = screen.getByPlaceholderText(/Descreva o motivo comercial/i);
    fireEvent.change(reasonInput, { target: { value: "Desconto especial de fidelidade" } });

    // Verify button switches to "Salvar Rascunho Comercial" and notice is displayed
    expect(screen.getByText("Salvar Rascunho Comercial")).toBeInTheDocument();
    expect(
      screen.getByText("A alteração de cobrança será aplicada após a etapa de sincronização com o Stripe."),
    ).toBeInTheDocument();

    // Mock draft mutation response
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: "Rascunho comercial salvo com sucesso.",
      }),
    } as any);

    // Mock refresh
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
        pricing: { finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 5, effectivePetLimit: 20 },
      }),
    } as any);

    fireEvent.click(screen.getByText("Salvar Rascunho Comercial"));

    await waitFor(() => {
      const draftCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("draft-condition"),
      );
      expect(draftCall).toBeDefined();
      expect(draftCall?.[1]?.headers).toHaveProperty("X-Idempotency-Key");
      expect(screen.getByText("Rascunho comercial salvo com sucesso.")).toBeInTheDocument();
    });
  });

  it("7. displays warning and requires confirmation checkbox when lowering limit below active pets (Correction 13)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 30 },
        pricing: { finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 25, effectivePetLimit: 30 },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Personalizar Condição Comercial")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Personalizar Condição Comercial"));

    // Enter limit of 15 when active pets is 25
    const limitInput = screen.getByPlaceholderText("Ex: 50");
    fireEvent.change(limitInput, { target: { value: "15" } });

    // Warning banner should appear
    expect(screen.getByText("Atenção: Redução de Limite de Pets")).toBeInTheDocument();
    expect(screen.getByText(/O novo limite \(15\) é inferior ao total de pets ativos \(25\)/i)).toBeInTheDocument();

    const applyBtn = screen.getByText("Aplicar Alteração");
    expect(applyBtn).toBeDisabled();

    // Check confirmation
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    expect(applyBtn).not.toBeDisabled();
  });

  it("8. displays server error feedback when mutation fails without showing false success toast", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
        pricing: { finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 5, effectivePetLimit: 20 },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Personalizar Condição Comercial")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Personalizar Condição Comercial"));

    const reasonInput = screen.getByPlaceholderText(/Descreva o motivo comercial/i);
    fireEvent.change(reasonInput, { target: { value: "Teste erro" } });

    // Mock failure response 422
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        message: "Falha de validação no banco de dados.",
      }),
    } as any);

    fireEvent.click(screen.getByText("Aplicar Alteração"));

    await waitFor(() => {
      expect(screen.getByText("Falha de validação no banco de dados.")).toBeInTheDocument();
      // False success message must NOT be present
      expect(screen.queryByText(/Operação Concluída/i)).toBeNull();
    });
  });

  it("9. pricing preview queries backend preview-price and renders authoritative backend calculation without independent frontend arithmetic (Section 9)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        creche: mockCreche,
        subscriptionState: "PROVISIONED",
        subscription: { id: 10, status: "active" },
        plan: { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
        pricing: { catalogPriceCents: 31990, finalEffectivePriceCents: 31990 },
        limits: { activePetCount: 5, effectivePetLimit: 20 },
      }),
    } as any);

    render(<CommercialSupportModal isOpen={true} onClose={vi.fn()} creche={mockCreche} />);

    await waitFor(() => {
      expect(screen.getByText("Personalizar Condição Comercial")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Personalizar Condição Comercial"));

    // Select percentage discount
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "percentage" } });

    // Mock the preview-price response from backend pricingEngine
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        catalogPriceCents: 31990,
        currentEffectivePriceCents: 31990,
        proposedEffectivePriceCents: 27192,
        absoluteDifferenceCents: 4798,
        discountPercentage: 15,
        appliedOverrideType: "percentage",
        currentPetLimit: 20,
        proposedPetLimit: 20,
        activePetCount: 5,
      }),
    } as any);

    // Enter 15%
    const valueInput = screen.getByPlaceholderText("15");
    fireEvent.change(valueInput, { target: { value: "15" } });

    await waitFor(() => {
      // Must call backend /preview-price with basis points (1500)
      const previewCall = fetchSpy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("preview-price"),
      );
      expect(previewCall).toBeDefined();
      const body = JSON.parse(previewCall?.[1]?.body as string);
      expect(body.pricingOverrideType).toBe("percentage");
      expect(body.pricingOverrideValue).toBe(1500);

      // Simulation card renders backend calculation
      expect(screen.getByText("Simulação de Preço")).toBeInTheDocument();
      expect(screen.getByText(/271,92\/mês/)).toBeInTheDocument();
      expect(screen.getByText("-15%")).toBeInTheDocument();
    });
  });
});
