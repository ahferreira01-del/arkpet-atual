import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor, within } from "./utils";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { AppLayout } from "@/components/layout/app-layout";
import { MasterAdminDashboard } from "@/pages/dashboard/components/master-admin-dashboard";
import { CrecheDashboard } from "@/pages/dashboard/components/creche-dashboard";
import { StaffDashboard } from "@/pages/dashboard/components/staff-dashboard";
import { TutorDashboard } from "@/pages/dashboard/components/tutor-dashboard";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import * as financialModule from "@/hooks/use-financial";
import * as pushModule from "@/hooks/use-push";

// Global mock for ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

const mockLogout = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
      Feed Page Mock
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
  useGetCreche: vi.fn(() => ({ data: null, isLoading: false })),
  useGetBillingSubscription: vi.fn(() => ({ data: { status: "active" }, isLoading: false, isError: false })),
  getGetCrecheQueryKey: vi.fn((id) => ["getCreche", id]),
  getGetCrecheStatsQueryKey: vi.fn((id) => ["stats", id]),
  getListPetsQueryKey: vi.fn((id) => ["pets", id]),
  getListBookingsQueryKey: vi.fn((id) => ["bookings", id]),
  getListTasksQueryKey: vi.fn((id) => ["tasks", id]),
  getListCrecheStaffQueryKey: vi.fn((id) => ["crecheStaff", id]),
}));

vi.mock("@/hooks/use-financial", () => ({
  useUpcomingInvoices: vi.fn(() => ({ data: [], isLoading: false })),
}));

describe("R39.D App Shell 2.0 & Role Dashboards Test Suite", () => {
  const masterAdminUser: any = { id: 1, name: "Admin Master", email: "master@arkpet.com", role: "master_admin", crecheId: null };
  const crecheAdminUser: any = { id: 2, name: "Camila Gestora", email: "camila@patinhas.com", role: "creche_admin", crecheId: 10 };
  const staffUser: any = { id: 3, name: "Bruno Monitor", email: "bruno@patinhas.com", role: "staff", crecheId: 10 };
  const tutorUser: any = { id: 4, name: "Renata Tutora", email: "renata@gmail.com", role: "tutor", crecheId: 10 };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (authModule.useAuth as any).mockReturnValue({
      user: crecheAdminUser,
      isLoading: false,
      logout: mockLogout,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListPets as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListBookings as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useGetCrecheStats as any).mockReturnValue({ data: {}, isLoading: false });
    (apiClientModule.useListCrecheStaff as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListCreches as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useListUsers as any).mockReturnValue({ data: [], isLoading: false });
    (apiClientModule.useGetCreche as any).mockReturnValue({ data: null, isLoading: false });
    (apiClientModule.useGetBillingSubscription as any).mockReturnValue({ data: { status: "active" }, isLoading: false, isError: false });
    (financialModule.useUpcomingInvoices as any).mockReturnValue({ data: [], isLoading: false });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/financial/invoices/awaiting-count")) {
        return Promise.resolve({ ok: true, json: async () => ({ count: 0 }) });
      }
      if (url.includes("/tutor-timeline")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.includes("/chat/unread")) {
        return Promise.resolve({ ok: true, json: async () => ({ total: 0 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // APP SHELL 2.0 TESTS (TC-SHELL-01 to TC-SHELL-08)
  // ══════════════════════════════════════════════════════════════════════════

  it("TC-SHELL-01: Sidebar renders in expanded mode by default (w-64) and displays role-grouped links", () => {
    renderWithProviders(<Sidebar user={crecheAdminUser} />);

    const sidebar = screen.getByRole("complementary", { name: "Navegação Principal" });
    expect(sidebar).toBeInTheDocument();
    expect(sidebar).toHaveClass("w-64");

    // Check functional group headers
    expect(screen.getByText("Operacional")).toBeInTheDocument();
    expect(screen.getByText("Gestão")).toBeInTheDocument();

    // Check navigation entries from config
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Pets")).toBeInTheDocument();
    expect(screen.getByText("Reservas")).toBeInTheDocument();
    expect(screen.getByText("Financeiro")).toBeInTheDocument();

    // User context block in expanded mode
    expect(screen.getByText("Conectado como")).toBeInTheDocument();
    expect(screen.getByText("Camila Gestora")).toBeInTheDocument();
    expect(screen.getByText("Admin de Creche")).toBeInTheDocument();
  });

  it("TC-SHELL-02: Sidebar toggles to collapsed mode (w-[72px]), updates aria-expanded and persists preference", () => {
    renderWithProviders(<Sidebar user={crecheAdminUser} />);

    const sidebar = screen.getByRole("complementary", { name: "Navegação Principal" });
    const collapseBtn = screen.getByRole("button", { name: "Recolher barra lateral" });
    expect(collapseBtn).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapseBtn);

    // Sidebar should now be collapsed (w-[72px])
    expect(sidebar).toHaveClass("w-[72px]");
    expect(localStorage.getItem("arkpet-sidebar-collapsed")).toBe("true");

    // Button should now be the expand button
    const expandBtn = screen.getByRole("button", { name: "Expandir barra lateral" });
    expect(expandBtn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expandBtn);
    expect(sidebar).toHaveClass("w-64");
    expect(localStorage.getItem("arkpet-sidebar-collapsed")).toBe("false");
  });

  it("TC-SHELL-03: Sidebar in collapsed mode hides textual labels and provides accessible action buttons", () => {
    localStorage.setItem("arkpet-sidebar-collapsed", "true");
    renderWithProviders(<Sidebar user={crecheAdminUser} />);

    const sidebar = screen.getByRole("complementary", { name: "Navegação Principal" });
    expect(sidebar).toHaveClass("w-[72px]");

    // Group labels and connected user info should not be visible in collapsed mode
    expect(screen.queryByText("Conectado como")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair da conta" })).toBeInTheDocument();
  });

  it("TC-SHELL-04: Topbar renders on both desktop and mobile, displaying context title, theme toggle, and user initials", () => {
    renderWithProviders(
      <ThemeProvider>
        <Header user={crecheAdminUser} />
      </ThemeProvider>
    );

    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
    expect(header).not.toHaveClass("hidden");

    // Title / context
    expect(screen.getByText("ArkPet")).toBeInTheDocument();

    // Theme toggle button
    const themeBtn = screen.getByRole("button", { name: /Alternar para tema/i });
    expect(themeBtn).toBeInTheDocument();

    // User account dropdown trigger with initials CG (Camila Gestora)
    expect(screen.getByText("CG")).toBeInTheDocument();
    expect(screen.getByText("Camila")).toBeInTheDocument();
  });

  it("TC-SHELL-05: Topbar user account dropdown displays user name, email, role badge, and triggers logout", async () => {
    renderWithProviders(
      <ThemeProvider>
        <Header user={crecheAdminUser} />
      </ThemeProvider>
    );

    const menuTrigger = screen.getByRole("button", { name: "Menu do usuário" });
    // Radix UI responds to keyboard Enter or pointerDown in jsdom
    fireEvent.keyDown(menuTrigger, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("camila@patinhas.com")).toBeInTheDocument();
    });
    expect(screen.getByText("Admin de Creche")).toBeInTheDocument();

    const logoutItem = screen.getByRole("menuitem", { name: /Sair da conta/i });
    expect(logoutItem).toBeInTheDocument();

    fireEvent.click(logoutItem);
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("TC-SHELL-06: Topbar theme toggle triggers theme change between dark and light modes", () => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("arkpet-theme", "dark");

    renderWithProviders(
      <ThemeProvider defaultTheme="dark">
        <Header user={crecheAdminUser} />
      </ThemeProvider>
    );

    const themeBtn = screen.getByRole("button", { name: /Alternar para tema/i });
    fireEvent.click(themeBtn);

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("arkpet-theme")).toBe("light");

    fireEvent.click(themeBtn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("arkpet-theme")).toBe("dark");
  });

  it("TC-SHELL-07: BottomNav renders mobile navigation items with touch targets >= 44px and opens overflow modal", () => {
    renderWithProviders(<BottomNav user={crecheAdminUser} />);

    const nav = screen.getByRole("navigation", { name: "Navegação Inferior Mobile" });
    expect(nav).toBeInTheDocument();

    // Items for creche_admin: visible items + Menu button
    const menuBtn = screen.getByRole("button", { name: "Abrir menu de opções" });
    expect(menuBtn).toBeInTheDocument();

    // Verify touch target min height (min-h-[48px] on child div)
    const touchItem = nav.querySelector(".min-h-\\[48px\\]");
    expect(touchItem).toBeInTheDocument();

    // Click Menu button to open modal
    fireEvent.click(menuBtn);
    expect(screen.getByText("Menu Principal")).toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });

  it("TC-SHELL-08: AppLayout integrates Sidebar, Topbar, Content Container bounds, and mobile bottom navigation spacer", () => {
    renderWithProviders(
      <ThemeProvider>
        <AppLayout>
          <div data-testid="page-content">PAGE_CONTENT_INSIDE_SHELL</div>
        </AppLayout>
      </ThemeProvider>
    );

    expect(screen.getByRole("complementary", { name: "Navegação Principal" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByTestId("page-content")).toBeInTheDocument();

    const main = screen.getByRole("main");
    expect(main).toHaveClass("overflow-y-auto");
    expect(main).toHaveClass("overflow-x-hidden");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ROLE DASHBOARDS TESTS (TC-DASH-01 to TC-DASH-10)
  // ══════════════════════════════════════════════════════════════════════════

  it("TC-DASH-01: Master Admin Dashboard renders executive greeting, date, and Rede Operacional status badge", () => {
    renderWithProviders(<MasterAdminDashboard />);

    expect(screen.getByText(/Master!/i)).toBeInTheDocument();
    expect(screen.getByText("Visão global de toda a rede ArkPet.")).toBeInTheDocument();
    expect(screen.getByText("Rede Operacional")).toBeInTheDocument();
  });

  it("TC-DASH-02: Master Admin Dashboard computes and displays real KPI metrics with zero invented data", () => {
    (apiClientModule.useListCreches as any).mockReturnValue({
      data: [
        { id: 1, name: "Creche Alpha", status: "active", maxCapacity: 20, currentOccupancy: 16 },
        { id: 2, name: "Creche Beta", status: "inactive", maxCapacity: 10, currentOccupancy: 0 },
      ],
      isLoading: false,
    });

    (apiClientModule.useListUsers as any).mockReturnValue({
      data: [
        { id: 1, role: "tutor" },
        { id: 2, role: "tutor" },
        { id: 3, role: "tutor" },
        { id: 4, role: "staff" },
        { id: 5, role: "creche_admin" },
      ],
      isLoading: false,
    });

    renderWithProviders(<MasterAdminDashboard />);

    // 1 active, 1 inactive
    const crechesCard = screen.getByText("Creches Ativas").closest(".bg-card")!;
    expect(within(crechesCard as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(crechesCard as HTMLElement).getByText("1 inativas")).toBeInTheDocument();

    // Occupancy: 16 / 20 = 80%
    const occupancyCard = screen.getByText("Ocupação Média").closest(".bg-card")!;
    expect(within(occupancyCard as HTMLElement).getByText("80%")).toBeInTheDocument();

    // Total users: 5 total (3 tutors, 2 staff/admin)
    const usersCard = screen.getByText("Usuários Totais").closest(".bg-card")!;
    expect(within(usersCard as HTMLElement).getByText("5")).toBeInTheDocument();
    expect(within(usersCard as HTMLElement).getByText("3 tutores · 2 equipe")).toBeInTheDocument();
  });

  it("TC-DASH-03: Master Admin Dashboard renders Creches da Rede with occupancy progress and quick actions", () => {
    (apiClientModule.useListCreches as any).mockReturnValue({
      data: [
        { id: 1, name: "Creche Premium", address: "Av. Paulista, 1000", status: "active", maxCapacity: 40, currentOccupancy: 20 },
      ],
      isLoading: false,
    });

    renderWithProviders(<MasterAdminDashboard />);

    expect(screen.getByText("Creches da Rede")).toBeInTheDocument();
    expect(screen.getByText("Creche Premium")).toBeInTheDocument();
    expect(screen.getByText("Av. Paulista, 1000")).toBeInTheDocument();
    expect(screen.getByText("20/40 pets · 50%")).toBeInTheDocument();

    // Quick action link to proposals
    expect(screen.getByRole("link", { name: /propostas & serviços/i })).toHaveAttribute("href", "/admin/proposals");
  });

  it("TC-DASH-04: Creche Admin Dashboard renders operational greeting, QR check-in action, and awaiting receipts alert", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: crecheAdminUser,
      isLoading: false,
      logout: mockLogout,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/financial/invoices/awaiting-count")) {
        return Promise.resolve({ ok: true, json: async () => ({ count: 3 }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<CrecheDashboard crecheId={10} user={crecheAdminUser} />);

    expect(screen.getByText(/Camila!/i)).toBeInTheDocument();
    expect(screen.getByText("Veja o que está acontecendo na sua creche hoje.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check-in QR/i })).toBeInTheDocument();

    // Awaiting receipts alert resolves asynchronously via useQuery
    const alertEl = await screen.findByRole("alert");
    expect(alertEl).toBeInTheDocument();
    expect(within(alertEl).getByText("3 comprovantes aguardando validação")).toBeInTheDocument();
  });

  it("TC-DASH-05: Creche Admin Dashboard renders Visão Geral tab with Pets, Reservas, Tarefas, and Equipe cards", () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: {
        total: 8,
        items: [
          { id: 1, name: "Bob", isCheckedIn: true },
          { id: 2, name: "Max", isCheckedIn: false },
        ],
      },
      isLoading: false,
    });

    (apiClientModule.useListBookings as any).mockReturnValue({
      data: [{ id: 10, status: "pending" }],
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [{ id: 100, petId: 1, title: "Alimentar Bob", status: "pending", scheduledFor: "2026-09-02T12:00:00Z" }],
      isLoading: false,
    });

    (apiClientModule.useListCrecheStaff as any).mockReturnValue({
      data: [{ id: 50, name: "Carla", isActive: true }],
      isLoading: false,
    });

    renderWithProviders(<CrecheDashboard crecheId={10} user={crecheAdminUser} />);

    // Switch to Visão Geral
    fireEvent.click(screen.getByRole("button", { name: "Visão Geral" }));

    expect(screen.getByText("Pets Presentes")).toBeInTheDocument();
    expect(screen.getByText("Reservas Pendentes")).toBeInTheDocument();
    expect(screen.getByText("Tarefas Pendentes")).toBeInTheDocument();
    expect(screen.getByText("Equipe Ativa")).toBeInTheDocument();
  });

  it("TC-DASH-06: Staff Dashboard renders task execution greeting and present pets count badge", () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: [
        { id: 1, name: "Thor", isCheckedIn: true },
        { id: 2, name: "Lola", isCheckedIn: true },
        { id: 3, name: "Luna", isCheckedIn: true },
      ],
      isLoading: false,
    });

    renderWithProviders(<StaffDashboard user={staffUser} />);

    expect(screen.getByText(/Bruno!/i)).toBeInTheDocument();
    expect(screen.getByText("3 presentes")).toBeInTheDocument();
  });

  it("TC-DASH-07: Staff Dashboard renders quick actions (Tarefas, Passeios, Pets) and pending tasks with priority badges", () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: [{ id: 1, name: "Thor", isCheckedIn: true }],
      isLoading: false,
    });

    (apiClientModule.useListTasks as any).mockReturnValue({
      data: [
        { id: 201, petId: 1, petName: "Thor", title: "Administrar colírio", priority: "high", scheduledFor: "2026-09-02T15:00:00Z", status: "pending" },
      ],
      isLoading: false,
    });

    renderWithProviders(<StaffDashboard user={staffUser} />);

    // Quick actions
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/staff")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/walks")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/pets")).toBe(true);

    // Click Tarefas tab
    const tarefasTab = screen.getByRole("button", { name: "Tarefas" });
    fireEvent.click(tarefasTab);

    expect(screen.getByText("Próximas Tarefas")).toBeInTheDocument();
    expect(screen.getByText("Administrar colírio")).toBeInTheDocument();
    expect(screen.getByText("Thor")).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();
  });

  it("TC-DASH-08: Tutor Dashboard renders personal greeting, registered pets count, and na creche badge", () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: [
        { id: 10, name: "Pipoca", isCheckedIn: true },
        { id: 11, name: "Amora", isCheckedIn: false },
      ],
      isLoading: false,
    });

    renderWithProviders(<TutorDashboard user={tutorUser} />);

    expect(screen.getByText(/Renata!/i)).toBeInTheDocument();
    expect(screen.getByText("2 pets cadastrados")).toBeInTheDocument();
    expect(screen.getByText("1 na creche")).toBeInTheDocument();
  });

  it("TC-DASH-09: Tutor Dashboard renders financial alerts for overdue and upcoming invoices with direct action links", () => {
    (financialModule.useUpcomingInvoices as any).mockReturnValue({
      data: [
        { id: 1, invoiceNumber: "FAT-99", totalAmount: 20000, status: "overdue", dueDate: "2026-08-01" },
      ],
      isLoading: false,
    });

    renderWithProviders(<TutorDashboard user={tutorUser} />);

    expect(screen.getByText("Faturas Atrasadas")).toBeInTheDocument();
    const regularizeBtn = screen.getByRole("button", { name: "Regularizar" });
    expect(regularizeBtn.closest("a")).toHaveAttribute("href", "/tutor/financial");
  });

  it("TC-DASH-10: Tutor Dashboard renders quick actions including Lojinha (/tutor/store) preserving discoverability", () => {
    renderWithProviders(<TutorDashboard user={tutorUser} />);

    const storeLink = screen.getByRole("link", { name: /lojinha/i });
    expect(storeLink).toBeInTheDocument();
    expect(storeLink).toHaveAttribute("href", "/tutor/store");

    const petsLink = screen.getByRole("link", { name: /meus pets/i });
    expect(petsLink).toHaveAttribute("href", "/pets");

    const bookingsLink = screen.getByRole("link", { name: /reservas/i });
    expect(bookingsLink).toHaveAttribute("href", "/bookings");

    const chatLink = screen.getByRole("link", { name: /mensagens/i });
    expect(chatLink).toHaveAttribute("href", "/chat");
  });
});
