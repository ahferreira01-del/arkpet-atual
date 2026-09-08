import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import AdminCampaigns from "../pages/admin/campaigns";

vi.mock("@workspace/api-client-react", () => ({
  useListCreches: vi.fn(() => ({
    data: [
      { id: 10, name: "Creche Pata Feliz" },
      { id: 20, name: "Creche Amigo Fiel" },
    ],
    isLoading: false,
  })),
}));

describe("Master Admin Campaigns Management UI Tests (R36.F)", () => {
  const mockCampaigns = [
    {
      id: 1,
      name: "Campanha Q3 2026 - 20% OFF",
      description: "Desconto temporário de 20% por 3 ciclos",
      status: "active",
      eligibleFrom: null,
      eligibleUntil: null,
      priority: 100,
      assignmentMode: "manual_single",
      createdBy: "master_admin",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      benefit: {
        id: 10,
        campaignId: 1,
        benefitType: "PERCENTAGE_DISCOUNT",
        benefitValue: 2000,
        billingCycles: 3,
      },
      stats: {
        assignedCount: 2,
        activeCount: 1,
        completedCount: 1,
      },
    },
    {
      id: 2,
      name: "Campanha Fixa R$ 50 OFF",
      description: "Desconto fixo de 50 reais",
      status: "draft",
      eligibleFrom: null,
      eligibleUntil: null,
      priority: 50,
      assignmentMode: "manual_single",
      createdBy: "master_admin",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      benefit: {
        id: 11,
        campaignId: 2,
        benefitType: "FIXED_DISCOUNT",
        benefitValue: 5000,
        billingCycles: 6,
      },
      stats: {
        assignedCount: 0,
        activeCount: 0,
        completedCount: 0,
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "mock_master_admin_token");
  });

  it("1. renders campaign list, metrics summary, and campaign cards", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    expect(screen.getByText(/Campanhas & Benefícios Temporais/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
      expect(screen.getByText("Campanha Fixa R$ 50 OFF")).toBeInTheDocument();
    });

    // Verify benefit badges and texts
    expect(screen.getByText("20% de Desconto (2000 bps)")).toBeInTheDocument();
    expect(screen.getByText(/3 ciclo\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/6 ciclo\(s\)/)).toBeInTheDocument();
  });

  it("2. switches to create tab and renders campaign creation form", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Click "Nova Campanha" tab button
    const createTab = screen.getByRole("button", { name: /Nova Campanha/i });
    fireEvent.click(createTab);

    // Verify form fields
    expect(screen.getByText("Cadastrar Nova Campanha Comercial")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ex: Incentivo de Expansão Q3")).toBeInTheDocument();
    expect(screen.getByText("Configuração do Benefício Recorrente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Criar Campanha/i })).toBeInTheDocument();
  });

  it("3. opens assignment modal, executes dry-run preview on selection, and shows financial impact", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/preview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            campaign: mockCampaigns[0],
            benefit: mockCampaigns[0].benefit,
            items: [
              {
                crecheId: 10,
                crecheName: "Creche Pata Feliz",
                targetPlanName: "Plano Intermediário",
                billingInterval: "month",
                catalogPriceCents: 31990,
                currentEffectivePriceCents: 31990,
                promotionalPriceCents: 25592,
                restorationCommittedPriceCents: 31990,
                absoluteSavingsCents: 6398,
                percentageSavingsBps: 2000,
                billingCycles: 3,
                eligible: true,
                hasActiveCampaignConflict: false,
                hasExistingStripeSchedule: false,
              },
            ],
          }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Click "Atribuir Creche" on the active campaign
    const assignButtons = screen.getAllByRole("button", { name: /Atribuir Creche/i });
    fireEvent.click(assignButtons[0]);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/Atribuir Campanha: Campanha Q3 2026 - 20% OFF/i)).toBeInTheDocument();
    });

    // Select target creche
    const selectElement = screen.getByDisplayValue("Selecione uma creche...");
    fireEvent.change(selectElement, { target: { value: "10" } });

    // Verify fetch was called with preview
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/preview"),
        expect.anything()
      );
    });

    // Expect preview results to show savings and safety confirmation
    await waitFor(() => {
      expect(screen.getByText(/Creche Elegível com Sucesso/i)).toBeInTheDocument();
      expect(screen.getByText(/Novo Preço Promocional/i)).toBeInTheDocument();
      expect(screen.getByText(/Compromissos Contratuais & Temporais/i)).toBeInTheDocument();
    });
  });

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("4. CREATE_COMMERCIAL_CAMPAIGN UI mutation transmits valid UUID X-Idempotency-Key", async () => {
    let capturedRequest: { url: string; headers: any; body: any } | null = null;

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "POST" && urlStr.endsWith("/api/commercial/campaigns")) {
        capturedRequest = {
          url: urlStr,
          headers: options.headers,
          body: JSON.parse(options.body),
        };
        return {
          ok: true,
          status: 201,
          json: async () => ({ campaign: { id: 99, name: "Nova Campanha Teste" } }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Switch to create tab
    fireEvent.click(screen.getByRole("button", { name: /Nova Campanha/i }));

    // Fill required form fields
    fireEvent.change(screen.getByPlaceholderText("Ex: Incentivo de Expansão Q3"), {
      target: { value: "Campanha Black Friday 2026" },
    });
    fireEvent.change(screen.getByPlaceholderText("20"), {
      target: { value: "15" },
    });

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: /Criar Campanha/i }));

    await waitFor(() => {
      expect(capturedRequest).not.null;
    });

    expect(capturedRequest!.headers["X-Idempotency-Key"]).toBeDefined();
    expect(capturedRequest!.headers["X-Idempotency-Key"]).toMatch(UUID_REGEX);
    expect(capturedRequest!.body.name).toBe("Campanha Black Friday 2026");
    expect(capturedRequest!.body.benefitType).toBe("PERCENTAGE_DISCOUNT");
    expect(capturedRequest!.body.benefitValue).toBe(1500);
    expect(capturedRequest!.body.billingCycles).toBe(3);
  });

  it("5. UPDATE_COMMERCIAL_CAMPAIGN UI mutation transmits valid UUID X-Idempotency-Key", async () => {
    let capturedRequest: { url: string; headers: any; body: any } | null = null;

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "PATCH" && urlStr.includes("/api/commercial/campaigns/1")) {
        capturedRequest = {
          url: urlStr,
          headers: options.headers,
          body: JSON.parse(options.body),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaign: { id: 1, name: "Nome Atualizado" } }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Click "Editar" on the first campaign
    const editButtons = screen.getAllByRole("button", { name: /Editar/i });
    fireEvent.click(editButtons[0]);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/Editar Campanha: Campanha Q3 2026 - 20% OFF/i)).toBeInTheDocument();
    });

    // Modify name
    const nameInput = screen.getByDisplayValue("Campanha Q3 2026 - 20% OFF");
    fireEvent.change(nameInput, { target: { value: "Campanha Q3 2026 - Atualizada" } });

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: /Salvar Alterações/i }));

    await waitFor(() => {
      expect(capturedRequest).not.null;
    });

    expect(capturedRequest!.headers["X-Idempotency-Key"]).toBeDefined();
    expect(capturedRequest!.headers["X-Idempotency-Key"]).toMatch(UUID_REGEX);
    expect(capturedRequest!.body.name).toBe("Campanha Q3 2026 - Atualizada");
  });

  it("6. CHANGE_COMMERCIAL_CAMPAIGN_STATUS UI mutation transmits valid UUID X-Idempotency-Key", async () => {
    let capturedRequest: { url: string; headers: any; body: any } | null = null;

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "PATCH" && urlStr.includes("/api/commercial/campaigns/1")) {
        capturedRequest = {
          url: urlStr,
          headers: options.headers,
          body: JSON.parse(options.body),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaign: { id: 1, status: "paused" } }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Active campaign has "Pausar" button
    const pauseButton = screen.getByRole("button", { name: /Pausar/i });
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(capturedRequest).not.null;
    });

    expect(capturedRequest!.headers["X-Idempotency-Key"]).toBeDefined();
    expect(capturedRequest!.headers["X-Idempotency-Key"]).toMatch(UUID_REGEX);
    expect(capturedRequest!.body).toEqual({ status: "paused" });
  });

  it("7. ASSIGN_COMMERCIAL_CAMPAIGN UI mutation transmits valid UUID X-Idempotency-Key", async () => {
    let capturedRequest: { url: string; headers: any; body: any } | null = null;

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "POST" && urlStr.includes("/assign/10")) {
        capturedRequest = {
          url: urlStr,
          headers: options.headers,
          body: JSON.parse(options.body),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            assignedBenefit: { id: 101, status: "scheduled" },
          }),
        } as any;
      }
      if (urlStr.includes("/preview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            campaign: mockCampaigns[0],
            benefit: mockCampaigns[0].benefit,
            items: [
              {
                crecheId: 10,
                crecheName: "Creche Pata Feliz",
                targetPlanName: "Plano Intermediário",
                billingInterval: "month",
                catalogPriceCents: 31990,
                currentEffectivePriceCents: 31990,
                promotionalPriceCents: 25592,
                restorationCommittedPriceCents: 31990,
                absoluteSavingsCents: 6398,
                percentageSavingsBps: 2000,
                billingCycles: 3,
                eligible: true,
                hasActiveCampaignConflict: false,
                hasExistingStripeSchedule: false,
              },
            ],
          }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Click "Atribuir Creche"
    const assignButtons = screen.getAllByRole("button", { name: /Atribuir Creche/i });
    fireEvent.click(assignButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Atribuir Campanha: Campanha Q3 2026 - 20% OFF/i)).toBeInTheDocument();
    });

    // Select creche
    fireEvent.change(screen.getByDisplayValue("Selecione uma creche..."), { target: { value: "10" } });

    // Wait for preview to complete
    await waitFor(() => {
      expect(screen.getByText(/Creche Elegível com Sucesso/i)).toBeInTheDocument();
    });

    // Enter reason
    const reasonInput = screen.getByPlaceholderText(/Ex: Acordo comercial de renovação/i);
    fireEvent.change(reasonInput, { target: { value: "Adesão antecipada confirmada pelo diretor comercial" } });

    // Confirm assignment
    const confirmButton = screen.getByRole("button", { name: /Confirmar Atribuição Segura/i });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(capturedRequest).not.null;
    });

    expect(capturedRequest!.headers["X-Idempotency-Key"]).toBeDefined();
    expect(capturedRequest!.headers["X-Idempotency-Key"]).toMatch(UUID_REGEX);
    expect(capturedRequest!.body.reason).toBe("Adesão antecipada confirmada pelo diretor comercial");
  });

  it("8. CREATE campaign UI idempotency: retry on network failure reuses same UUID key A; subsequent new campaign gets fresh key B", async () => {
    const capturedKeys: string[] = [];
    let shouldFailFirstCreate = true;

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "POST" && urlStr.endsWith("/api/commercial/campaigns")) {
        const key = options.headers?.["X-Idempotency-Key"];
        if (key) capturedKeys.push(key);

        if (shouldFailFirstCreate) {
          shouldFailFirstCreate = false;
          return {
            ok: false,
            status: 504,
            json: async () => ({ message: "Gateway Timeout simulado" }),
          } as any;
        }

        return {
          ok: true,
          status: 201,
          json: async () => ({
            campaign: { id: 101, name: JSON.parse(options.body).name },
          }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Switch to Nova Campanha tab
    fireEvent.click(screen.getByRole("button", { name: /Nova Campanha/i }));

    // Fill form for first campaign
    const nameInput = screen.getByPlaceholderText("Ex: Incentivo de Expansão Q3");
    fireEvent.change(nameInput, { target: { value: "Campanha Tentativa 1" } });

    // Submit attempt 1 -> fails with 504
    const submitBtn = screen.getByRole("button", { name: /Criar Campanha/i });
    fireEvent.click(submitBtn);

    // Wait for error feedback to appear
    await waitFor(() => {
      expect(screen.getByText("Gateway Timeout simulado")).toBeInTheDocument();
    });
    expect(capturedKeys.length).toBe(1);
    const keyA = capturedKeys[0];
    expect(keyA).toMatch(UUID_REGEX);

    // Verify submit button is re-enabled for retry
    expect(submitBtn).not.toBeDisabled();

    // Submit attempt 2 (retry of exact same form without changes) -> succeeds
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(capturedKeys.length).toBe(2);
    });

    // Both attempts must use the EXACT SAME idempotency key A
    expect(capturedKeys[1]).toBe(keyA);

    // Now switch to Nova Campanha tab to create a brand new campaign
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Nova Campanha/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Nova Campanha/i }));

    const newNameInput = screen.getByPlaceholderText("Ex: Incentivo de Expansão Q3");
    fireEvent.change(newNameInput, { target: { value: "Campanha Independente 2" } });

    const newSubmitBtn = screen.getByRole("button", { name: /Criar Campanha/i });
    fireEvent.click(newSubmitBtn);

    await waitFor(() => {
      expect(capturedKeys.length).toBe(3);
    });

    const keyB = capturedKeys[2];
    expect(keyB).toMatch(UUID_REGEX);
    expect(keyB).not.toBe(keyA);
  });

  it("9. ASSIGN campaign UI idempotency: retry on network failure reuses same UUID key A; subsequent assignment gets fresh key B", async () => {
    const capturedAssignKeys: string[] = [];
    let shouldFailFirstAssign = true;

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "POST" && urlStr.includes("/assign/")) {
        const key = options.headers?.["X-Idempotency-Key"];
        if (key) capturedAssignKeys.push(key);

        if (shouldFailFirstAssign) {
          shouldFailFirstAssign = false;
          return {
            ok: false,
            status: 504,
            json: async () => ({ message: "Falha de rede simulada no assign" }),
          } as any;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            assignedBenefit: { id: 201, status: "scheduled" },
          }),
        } as any;
      }
      if (urlStr.includes("/preview")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            campaign: mockCampaigns[0],
            benefit: mockCampaigns[0].benefit,
            items: [
              {
                crecheId: 10,
                crecheName: "Creche Pata Feliz",
                targetPlanName: "Plano Intermediário",
                billingInterval: "month",
                catalogPriceCents: 31990,
                currentEffectivePriceCents: 31990,
                promotionalPriceCents: 25592,
                restorationCommittedPriceCents: 31990,
                eligible: true,
              },
              {
                crecheId: 20,
                crecheName: "Creche Amigo Fiel",
                targetPlanName: "Plano Intermediário",
                billingInterval: "month",
                catalogPriceCents: 31990,
                currentEffectivePriceCents: 31990,
                promotionalPriceCents: 25592,
                restorationCommittedPriceCents: 31990,
                eligible: true,
              },
            ],
          }),
        } as any;
      }
      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: mockCampaigns }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Open assign modal
    const assignButtons = screen.getAllByRole("button", { name: /Atribuir Creche/i });
    fireEvent.click(assignButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Atribuir Campanha: Campanha Q3 2026 - 20% OFF/i)).toBeInTheDocument();
    });

    // Select creche 10
    fireEvent.change(screen.getByDisplayValue("Selecione uma creche..."), { target: { value: "10" } });

    await waitFor(() => {
      expect(screen.getByText(/Creche Elegível com Sucesso/i)).toBeInTheDocument();
    });

    // Enter reason
    const reasonInput = screen.getByPlaceholderText(/Ex: Acordo comercial de renovação/i);
    fireEvent.change(reasonInput, { target: { value: "Justificativa comercial da tentativa" } });

    // Confirm attempt 1 -> fails with 504
    const confirmBtn = screen.getByRole("button", { name: /Confirmar Atribuição Segura/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText("Falha de rede simulada no assign")).toBeInTheDocument();
    });

    expect(capturedAssignKeys.length).toBe(1);
    const keyA = capturedAssignKeys[0];
    expect(keyA).toMatch(UUID_REGEX);

    // Confirm attempt 2 (retry of exact same assignment) -> succeeds
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(capturedAssignKeys.length).toBe(2);
    });

    // Key must be reused
    expect(capturedAssignKeys[1]).toBe(keyA);

    // Modal closes on success
    await waitFor(() => {
      expect(screen.queryByText(/Atribuir Campanha: Campanha Q3 2026 - 20% OFF/i)).not.toBeInTheDocument();
    });

    // Open assign modal again for a second assignment (Creche 20)
    const freshAssignButtons = screen.getAllByRole("button", { name: /Atribuir Creche/i });
    fireEvent.click(freshAssignButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Atribuir Campanha: Campanha Q3 2026 - 20% OFF/i)).toBeInTheDocument();
    });

    // Select creche 20
    fireEvent.change(screen.getByDisplayValue("Selecione uma creche..."), { target: { value: "20" } });

    await waitFor(() => {
      expect(screen.getByText(/Creche Elegível com Sucesso/i)).toBeInTheDocument();
    });

    const secondReasonInput = screen.getByPlaceholderText(/Ex: Acordo comercial de renovação/i);
    fireEvent.change(secondReasonInput, { target: { value: "Nova justificativa para creche 20" } });

    const secondConfirmBtn = screen.getByRole("button", { name: /Confirmar Atribuição Segura/i });
    fireEvent.click(secondConfirmBtn);

    await waitFor(() => {
      expect(capturedAssignKeys.length).toBe(3);
    });

    const keyB = capturedAssignKeys[2];
    expect(keyB).toMatch(UUID_REGEX);
    expect(keyB).not.toBe(keyA);
  });

  it("10. Status mutation retry reuses UUID on network error, subsequent transition gets fresh UUID, and double-submit is contained (R36.F1)", async () => {
    vi.stubGlobal("alert", vi.fn());
    let currentStatus = "active";
    const capturedStatusKeys: string[] = [];
    let callCount = 0;
    let resolveFirstCall: (() => void) | null = null;
    const firstCallHoldPromise = new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    });

    vi.spyOn(global, "fetch").mockImplementation(async (url: any, options: any) => {
      const urlStr = String(url);
      if (options?.method === "PATCH" && urlStr.includes("/api/commercial/campaigns/1")) {
        callCount++;
        const key = options.headers?.["X-Idempotency-Key"];
        if (key) capturedStatusKeys.push(key);

        if (callCount === 1) {
          // Wait to hold request in-flight to verify double-submit containment
          await firstCallHoldPromise;
          return {
            ok: false,
            status: 504,
            json: async () => ({ error: "GATEWAY_TIMEOUT", message: "Timeout simulado no status" }),
          } as any;
        }

        // Subsequent call succeeds -> transition status
        currentStatus = JSON.parse(options.body).status;
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaign: { id: 1, status: currentStatus } }),
        } as any;
      }

      if (urlStr.includes("/commercial/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            campaigns: [
              {
                ...mockCampaigns[0],
                status: currentStatus,
              },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    renderWithProviders(<AdminCampaigns />);

    await waitFor(() => {
      expect(screen.getByText("Campanha Q3 2026 - 20% OFF")).toBeInTheDocument();
    });

    // Initial status is 'active', so 'Pausar' button is displayed
    const pauseBtn = screen.getByRole("button", { name: /Pausar/i });
    expect(pauseBtn).not.toBeDisabled();

    // 1. First click: initiates in-flight mutation
    fireEvent.click(pauseBtn);

    // Double-submit containment: button is disabled while in flight
    await waitFor(() => {
      expect(pauseBtn).toBeDisabled();
    });

    // Attempting a second click while in-flight MUST NOT dispatch a second request
    fireEvent.click(pauseBtn);
    expect(callCount).toBe(1);

    // Release in-flight hold -> returns simulated 504
    resolveFirstCall!();

    await waitFor(() => {
      expect(pauseBtn).not.toBeDisabled();
    });

    expect(capturedStatusKeys.length).toBe(1);
    const keyA = capturedStatusKeys[0];
    expect(keyA).toMatch(UUID_REGEX);

    // 2. Retry of the EXACT SAME status mutation (active -> paused)
    fireEvent.click(pauseBtn);

    await waitFor(() => {
      expect(capturedStatusKeys.length).toBe(2);
    });

    // Logical Idempotency: exact same key must be reused across retry
    expect(capturedStatusKeys[1]).toBe(keyA);

    // 3. Terminal success: campaign is now paused, rendering 'Ativar' button
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ativar/i })).toBeInTheDocument();
    });

    // 4. Subsequent status transition (paused -> active) must generate a fresh key B
    const activateBtn = screen.getByRole("button", { name: /Ativar/i });
    fireEvent.click(activateBtn);

    await waitFor(() => {
      expect(capturedStatusKeys.length).toBe(3);
    });

    const keyB = capturedStatusKeys[2];
    expect(keyB).toMatch(UUID_REGEX);
    expect(keyB).not.toBe(keyA);
  });
});
