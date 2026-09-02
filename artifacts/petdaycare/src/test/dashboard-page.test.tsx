import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor, within } from "./utils";
import Dashboard from "@/pages/dashboard";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import * as financialModule from "@/hooks/use-financial";
import * as pushModule from "@/hooks/use-push";

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/use-push", () => ({
  usePush: vi.fn(() => ({
    isSupported: true,
    permission: "granted",
    isSubscribed: true,
    isLoading: false,
    subscribe: vi.fn(),
  })),
}));

vi.mock("@/features/feed/components/FeedPage", () => ({
  FeedPage: ({ crecheId, userRole }: { crecheId: number; userRole: string }) => (
    <div data-testid="feed-page" data-creche-id={crecheId} data-user-role={userRole}>
      Feed Page Component
    </div>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListPets: vi.fn(() => ({ data: [], isLoading: false })),
  useGetCrecheStats: vi.fn(() => ({ data: {}, isLoading: false })),
  useListBookings: vi.fn(() => ({ data: [], isLoading: false })),
  useListTasks: vi.fn(() => ({ data: [], isLoading: false })),
  useListCrecheStaff: vi.fn(() => ({ data: [], isLoading: false })),
  useListCreches: vi.fn(() => ({ data: [], isLoading: false })),
  useListUsers: vi.fn(() => ({ data: [], isLoading: false })),
  useListWalks: vi.fn(() => ({ data: [], isLoading: false })),
  useUpdateBooking: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCompleteTask: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  getGetCrecheStatsQueryKey: vi.fn((id) => ["stats", id]),
  getListPetsQueryKey: vi.fn((id) => ["pets", id]),
  getListBookingsQueryKey: vi.fn((id) => ["bookings", id]),
  getListTasksQueryKey: vi.fn((id) => ["tasks", id]),
  getListCrecheStaffQueryKey: vi.fn((id) => ["crecheStaff", id]),
}));

vi.mock("@/hooks/use-financial", () => ({
  useUpcomingInvoices: vi.fn(() => ({ data: [], isLoading: false })),
}));

describe("Dashboard Page Characterization Tests (R34.E0.1)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (apiClientModule.useListTasks as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListPets as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListBookings as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useGetCrecheStats as any).mockReturnValue({ data: {}, isLoading: false });
    (apiClientModule.useListCrecheStaff as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListCreches as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListUsers as any).mockReturnValue({ data: [], isLoading: false });
    (financialModule.useUpcomingInvoices as any).mockReturnValue({ data: [], isLoading: false });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/financial/invoices/awaiting-count")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 0 }),
        });
      }
      if (url.includes("/tutor-timeline")) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  // ==========================================================================
  // 1. AUTH & DISPATCH FALLBACKS
  // ==========================================================================

  it("1. renders 'Carregando...' while auth state is loading", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: null,
      isLoading: true,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(screen.queryByText(/Bom dia|Boa tarde|Boa noite/i)).not.toBeInTheDocument();
  });

  it("2. renders null when user is null and not loading", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: null,
      isLoading: false,
    });

    const { container } = renderWithProviders(<Dashboard />);

    expect(container.firstChild).toBeNull();
  });

  it("3. renders 'Nenhuma creche vinculada' when user has no crecheId and is not staff/master_admin/tutor", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin Sem Creche", role: "creche_admin", crecheId: null },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Nenhuma creche vinculada")).toBeInTheDocument();
  });

  it("4. renders CrecheDashboard when user role is unknown but has a valid crecheId (fallback contract)", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Operador Especial", role: "custom_operator", crecheId: 10 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: { total: 5, items: [] },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    // Renders CrecheDashboard header and QR button
    expect(screen.getByText(/Operador!/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check-in QR/i })).toBeInTheDocument();
  });

  // ==========================================================================
  // 2. CRECHE ADMIN ROLE
  // ==========================================================================

  it("5. renders CrecheDashboard for creche_admin with greeting, header, and QR scanner link", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Marina Silva", role: "creche_admin", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText(/Marina!/i)).toBeInTheDocument();
    expect(screen.getByText("Veja o que está acontecendo na sua creche hoje.")).toBeInTheDocument();

    const qrLink = screen.getByRole("button", { name: /Check-in QR/i }).closest("a");
    expect(qrLink).toHaveAttribute("href", "/staff/qr-scanner");
  });

  it("6. renders CrecheDashboard Visão Geral tab with Pets, Reservas, Tarefas, and Equipe StatCards and formulas", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Marina Silva", role: "creche_admin", crecheId: 1 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: {
        total: 10,
        items: [
          { id: 1, name: "Rex", isCheckedIn: true },
          { id: 2, name: "Thor", isCheckedIn: true },
          { id: 3, name: "Mel", isCheckedIn: false },
        ],
      },
      isLoading: false,
    });

    (apiClientModule.useListBookings as any).mockReturnValue({
      data: [
        { id: 101, status: "pending" },
        { id: 102, status: "confirmed" },
      ],
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [
        { id: 1, petId: 1, title: "Alimentar Rex", status: "pending", scheduledFor: "2026-09-02T10:00:00.000Z" },
        { id: 2, petId: 3, title: "Passear Mel (não presente)", status: "pending", scheduledFor: "2026-09-02T11:00:00.000Z" },
      ],
      isLoading: false,
    });

    (apiClientModule.useListCrecheStaff as any).mockReturnValue({
      data: [
        { id: 1, name: "Tia Ana", isActive: true },
        { id: 2, name: "Tio Bruno", isActive: false },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    // Click Visão Geral tab
    const overviewTab = screen.getByRole("button", { name: "Visão Geral" });
    fireEvent.click(overviewTab);

    // Assert StatCards
    const petsLink = screen.getByText("Pets Presentes").closest("a")!;
    expect(within(petsLink).getByText("2")).toBeInTheDocument(); // 2 checked in
    expect(within(petsLink).getByText("de 10 cadastrados")).toBeInTheDocument();
    expect(petsLink).toHaveAttribute("href", "/pets?filter=present");

    const bookingsLink = screen.getByText("Reservas Pendentes").closest("a")!;
    expect(within(bookingsLink).getByText("1")).toBeInTheDocument(); // 1 pending booking
    expect(within(bookingsLink).getByText("aguardando confirmação")).toBeInTheDocument();
    expect(bookingsLink).toHaveAttribute("href", "/bookings?status=pending");

    const tasksLink = screen.getByText("Tarefas Pendentes").closest("a")!;
    expect(within(tasksLink).getByText("1")).toBeInTheDocument(); // 1 active task for checked-in pet Rex
    expect(within(tasksLink).getByText("para hoje")).toBeInTheDocument();
    expect(tasksLink).toHaveAttribute("href", "/staff?filter=present");

    const staffLink = screen.getByText("Equipe Ativa").closest("a")!;
    expect(within(staffLink).getByText("1")).toBeInTheDocument(); // only 1 active staff
    expect(within(staffLink).getByText("membros")).toBeInTheDocument();
    expect(staffLink).toHaveAttribute("href", "/staff/manage");
  });

  it("7. renders CrecheDashboard Timeline tab with FeedPage", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Marina Silva", role: "creche_admin", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    const feed = screen.getByTestId("feed-page");
    expect(feed).toBeInTheDocument();
    expect(feed).toHaveAttribute("data-creche-id", "1");
    expect(feed).toHaveAttribute("data-user-role", "creche_admin");
  });

  // ==========================================================================
  // 3. STAFF ROLE
  // ==========================================================================

  it("8. renders StaffDashboard for staff role with greeting and present pets count badge", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 5, name: "Lucas Cuidador", role: "staff", crecheId: 1 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: [
        { id: 1, name: "Rex", isCheckedIn: true },
        { id: 2, name: "Boby", isCheckedIn: true },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText(/Lucas!/i)).toBeInTheDocument();
    expect(screen.getByText("2 presentes")).toBeInTheDocument();
  });

  it("9. renders StaffDashboard quick action links for Tarefas (/staff), Passeios (/walks), and Pets (/pets)", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 5, name: "Lucas Cuidador", role: "staff", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    const links = screen.getAllByRole("link");
    const tarefasLink = links.find(l => l.getAttribute("href") === "/staff");
    const passeiosLink = links.find(l => l.getAttribute("href") === "/walks");
    const petsLink = links.find(l => l.getAttribute("href") === "/pets");

    expect(tarefasLink).toBeDefined();
    expect(passeiosLink).toBeDefined();
    expect(petsLink).toBeDefined();
  });

  it("10. renders StaffDashboard tasks tab with list of pending tasks and priority badges", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 5, name: "Lucas Cuidador", role: "staff", crecheId: 1 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: [{ id: 10, name: "Pipoca", isCheckedIn: true }],
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [
        {
          id: 1,
          petId: 10,
          petName: "Pipoca",
          title: "Dar medicação Apoquel",
          priority: "high",
          scheduledFor: "2026-09-02T14:30:00.000Z",
          status: "pending",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    const tasksTab = screen.getByRole("button", { name: "Tarefas" });
    fireEvent.click(tasksTab);

    expect(screen.getByText("Próximas Tarefas")).toBeInTheDocument();
    expect(screen.getByText("Dar medicação Apoquel")).toBeInTheDocument();
    expect(screen.getByText("Pipoca")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
  });

  it("11. renders StaffDashboard empty state when no pending tasks exist", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 5, name: "Lucas Cuidador", role: "staff", crecheId: 1 },
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    const tasksTab = screen.getByRole("button", { name: "Tarefas" });
    fireEvent.click(tasksTab);

    expect(screen.getByText("Tudo em dia!")).toBeInTheDocument();
    expect(screen.getByText("Sem tarefas pendentes.")).toBeInTheDocument();
  });

  // ==========================================================================
  // 4. TUTOR ROLE
  // ==========================================================================

  it("12. renders TutorDashboard for tutor role with greeting, registered pets count, and na creche badge", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: [
        { id: 1, name: "Bidu", isCheckedIn: true },
        { id: 2, name: "Mimi", isCheckedIn: false },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText(/Carlos!/i)).toBeInTheDocument();
    expect(screen.getByText("2 pets cadastrados")).toBeInTheDocument();
    expect(screen.getByText("1 na creche")).toBeInTheDocument();
  });

  it("13. renders TutorDashboard quick actions for Meus Pets (/pets), Reservas (/bookings), and Mensagens (/chat)", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    const petsAction = screen.getByText("Meus Pets").closest("a");
    const reservasAction = screen.getByText("Reservas").closest("a");
    const mensagensAction = screen.getByText("Mensagens").closest("a");

    expect(petsAction).toHaveAttribute("href", "/pets");
    expect(reservasAction).toHaveAttribute("href", "/bookings");
    expect(mensagensAction).toHaveAttribute("href", "/chat");
  });

  it("14. renders TutorDashboard overdue invoice financial alert linking to /tutor/financial", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    (financialModule.useUpcomingInvoices as any).mockReturnValue({
      data: [
        {
          id: 1,
          invoiceNumber: "FAT-001",
          totalAmount: 15000,
          status: "overdue",
          dueDate: "2026-08-20",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Faturas Atrasadas")).toBeInTheDocument();
    expect(screen.getByText("Você possui faturas em atraso. Regularize para continuar agendando.")).toBeInTheDocument();

    const regularizeButton = screen.getByRole("button", { name: "Regularizar" });
    expect(regularizeButton.closest("a")).toHaveAttribute("href", "/tutor/financial");
  });

  it("15. renders TutorDashboard upcoming invoice financial alert with calculated due badge", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    // Provide an invoice due in 2 days from today
    (financialModule.useUpcomingInvoices as any).mockReturnValue({
      data: [
        {
          id: 2,
          invoiceNumber: "FAT-002",
          totalAmount: 12000,
          status: "pending",
          dueDate: "2026-09-04",
        },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Fatura Próxima do Vencimento")).toBeInTheDocument();
    const payNowButton = screen.getByRole("button", { name: "Pagar agora" });
    expect(payNowButton.closest("a")).toHaveAttribute("href", "/tutor/financial");
  });

  it("16. renders TutorDashboard timeline event card with pet photo and like button", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/tutor-timeline")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 50,
              petId: 1,
              petName: "Bidu",
              petPhotoUrl: null,
              authorName: "Tia Carol",
              type: "photo",
              content: "Bidu brincando na piscina de bolinhas",
              mediaUrl: null,
              mediaType: "photo",
              createdAt: "2026-09-02T11:00:00.000Z",
              likeCount: 2,
              isLikedByUser: false,
            },
          ],
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Dashboard />);

    const eventContent = await screen.findByText("Bidu brincando na piscina de bolinhas");
    expect(eventContent).toBeInTheDocument();
    expect(screen.getByText("Foto")).toBeInTheDocument();
    expect(screen.getByText(/Tia Carol/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Curtir/i })).toBeInTheDocument();
  });

  it("17. renders TutorDashboard timeline empty state when no events exist", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/tutor-timeline")) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Dashboard />);

    const emptyTitle = await screen.findByText("Nenhuma atividade ainda");
    expect(emptyTitle).toBeInTheDocument();
    expect(screen.getByText("Quando a creche registrar algo sobre seus pets, aparecerá aqui.")).toBeInTheDocument();
  });

  it("18. renders TutorDashboard timeline error state with retry button when query fails", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/tutor-timeline")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "Failed" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Dashboard />);

    const errorTitle = await screen.findByText("Não foi possível carregar as atividades");
    expect(errorTitle).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  // ==========================================================================
  // 5. MASTER ADMIN ROLE
  // ==========================================================================

  it("19. renders MasterAdminDashboard for master_admin role with Rede Operacional badge and global KPIs", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 99, name: "Master Admin", role: "master_admin", crecheId: null },
      isLoading: false,
    });

    (apiClientModule.useListCreches as any).mockReturnValue({
      data: [
        { id: 1, name: "Creche Alpha", status: "active", maxCapacity: 20, currentOccupancy: 15 },
        { id: 2, name: "Creche Beta", status: "inactive", maxCapacity: 10, currentOccupancy: 0 },
      ],
      isLoading: false,
    });

    (apiClientModule.useListUsers as any).mockReturnValue({
      data: [
        { id: 1, role: "tutor" },
        { id: 2, role: "tutor" },
        { id: 3, role: "staff" },
        { id: 4, role: "creche_admin" },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText(/Master!/i)).toBeInTheDocument();
    expect(screen.getByText("Rede Operacional")).toBeInTheDocument();

    // KPI Cards
    const crechesCard = screen.getByText("Creches Ativas").closest(".bg-card")!;
    expect(within(crechesCard as HTMLElement).getByText("1")).toBeInTheDocument(); // 1 active
    expect(within(crechesCard as HTMLElement).getByText("1 inativas")).toBeInTheDocument();

    const occupancyCard = screen.getByText("Ocupação Média").closest(".bg-card")!;
    expect(within(occupancyCard as HTMLElement).getByText("75%")).toBeInTheDocument(); // 15 / 20 = 75%

    const usersCard = screen.getByText("Usuários Totais").closest(".bg-card")!;
    expect(within(usersCard as HTMLElement).getByText("4")).toBeInTheDocument(); // 4 total users
    expect(within(usersCard as HTMLElement).getByText("2 tutores · 2 equipe")).toBeInTheDocument();

    const petsCard = screen.getByText("Pets na Rede").closest(".bg-card")!;
    expect(within(petsCard as HTMLElement).getByText("15")).toBeInTheDocument();
  });

  it("20. renders MasterAdminDashboard Creches da Rede list with occupancy progress bar and panel button", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 99, name: "Master Admin", role: "master_admin", crecheId: null },
      isLoading: false,
    });

    (apiClientModule.useListCreches as any).mockReturnValue({
      data: [
        { id: 1, name: "Creche Alpha", address: "Rua dos Pets, 100", status: "active", maxCapacity: 20, currentOccupancy: 10 },
      ],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Creches da Rede")).toBeInTheDocument();
    expect(screen.getByText("Creche Alpha")).toBeInTheDocument();
    expect(screen.getByText("Rua dos Pets, 100")).toBeInTheDocument();
    expect(screen.getByText("10/20 pets · 50%")).toBeInTheDocument();

    const panelBtn = screen.getByRole("button", { name: /Painel Completo/i });
    expect(panelBtn.closest("a")).toHaveAttribute("href", "/admin");
  });

  it("21. renders MasterAdminDashboard empty state when no creches are registered", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 99, name: "Master Admin", role: "master_admin", crecheId: null },
      isLoading: false,
    });

    (apiClientModule.useListCreches as any).mockReturnValue({
      data: [],
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Nenhuma creche")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma creche cadastrada ainda.")).toBeInTheDocument();
  });

  it("22. renders MasterAdminDashboard system health services and quick action links", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 99, name: "Master Admin", role: "master_admin", crecheId: null },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.getByText("Saúde do Sistema")).toBeInTheDocument();
    expect(screen.getByText("API & Backend")).toBeInTheDocument();
    expect(screen.getByText("Banco de Dados")).toBeInTheDocument();
    expect(screen.getByText("Notificações Push")).toBeInTheDocument();
    expect(screen.getByText("Segurança & Auth")).toBeInTheDocument();

    expect(screen.getByText("Gerenciar Creches")).toBeInTheDocument();
    expect(screen.getByText("Todos os Usuários")).toBeInTheDocument();
    expect(screen.getByText("Resumo da Rede")).toBeInTheDocument();
  });

  // ==========================================================================
  // 6. ROLE & QUERY ISOLATION
  // ==========================================================================

  it("23. ensures role isolation: Tutor does not render Master Admin or Creche Admin exclusive blocks", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Carlos Tutor", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.queryByText("Rede Operacional")).not.toBeInTheDocument();
    expect(screen.queryByText("Creches da Rede")).not.toBeInTheDocument();
    expect(screen.queryByText("Saúde do Sistema")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check-in QR/i })).not.toBeInTheDocument();
  });

  it("24. ensures role isolation: Staff does not render Tutor financial alerts or Master Admin network summary", () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 5, name: "Lucas Staff", role: "staff", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Dashboard />);

    expect(screen.queryByText("Faturas Atrasadas")).not.toBeInTheDocument();
    expect(screen.queryByText("Fatura Próxima do Vencimento")).not.toBeInTheDocument();
    expect(screen.queryByText("Resumo da Rede")).not.toBeInTheDocument();
    expect(screen.queryByText("Rede Operacional")).not.toBeInTheDocument();
  });
});
