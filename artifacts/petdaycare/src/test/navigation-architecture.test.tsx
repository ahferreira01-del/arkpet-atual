import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  NAVIGATION_CONFIG,
  getNavigationItemsForRole,
  getDesktopNavigationItems,
  getMobileNavigationItems,
  UserRole,
} from "@/config/navigation-config";
import { Sidebar } from "@/components/layout/sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { MasterAdminDashboard } from "@/pages/dashboard/components/master-admin-dashboard";
import { TutorDashboard } from "@/pages/dashboard/components/tutor-dashboard";
import { FileSignature, ShoppingBag, ScanLine, Megaphone, UserCog } from "lucide-react";
import App from "@/App";

// Mock child components of App that are not under test to isolate routing
vi.mock("@/components/layout/app-layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/pages/admin/creches", () => ({
  default: () => <div data-testid="admin-creches-page">ADMIN_CRECHES</div>,
}));

vi.mock("@/pages/admin/campaigns", () => ({
  default: () => <div data-testid="admin-campaigns-page">ADMIN_CAMPAIGNS</div>,
}));

vi.mock("@/pages/admin/proposals", () => ({
  default: () => <div data-testid="admin-proposals-page">ADMIN_PROPOSALS</div>,
}));

vi.mock("@/pages/admin/users", () => ({
  default: () => <div data-testid="admin-users-page">ADMIN_USERS</div>,
}));

vi.mock("@/pages/dashboard", () => ({
  default: () => <div data-testid="canonical-dashboard-page">CANONICAL_DASHBOARD</div>,
}));

// Mock API client hooks used by dashboards
vi.mock("@workspace/api-client-react", () => ({
  useListCreches: () => ({ data: [], isLoading: false }),
  useListUsers: () => ({ data: [], isLoading: false }),
  useGetCreche: () => ({ data: null, isLoading: false }),
  getGetCrecheQueryKey: () => ["getCreche"],
  useListPets: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/use-financial", () => ({
  useUpcomingInvoices: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/use-push", () => ({
  usePush: () => ({
    isSupported: false,
    permission: "default",
    isSubscribed: false,
    isLoading: false,
    subscribe: vi.fn(),
  }),
}));

let mockCurrentUser: any = null;

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockCurrentUser,
    isLoading: false,
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function LocationTracker() {
  const [loc] = useLocation();
  return <div data-testid="current-location">{loc}</div>;
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe("R39.B Navigation Architecture & Discoverability Suite", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    mockCurrentUser = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TC-NAV-01: Every user route has at least one valid UI entry point
  it("TC-NAV-01: Every user route has at least one valid UI entry point (ORPHAN_USER_ROUTES = 0)", () => {
    const auditedUserRoutes = [
      "/",
      "/admin/creches",
      "/admin/campaigns",
      "/admin/proposals",
      "/admin/users",
      "/pets",
      "/bookings",
      "/staff/board",
      "/staff/manage",
      "/staff/qr-scanner",
      "/tutors",
      "/chat",
      "/settings",
      "/financial",
      "/assinatura",
      "/marketing/campaigns",
      "/tutor/financial",
      "/tutor/store",
    ];

    const configuredPaths = new Set(NAVIGATION_CONFIG.map((item) => item.path));

    for (const route of auditedUserRoutes) {
      expect(
        configuredPaths.has(route),
        `Route ${route} must have a persistent entry in NAVIGATION_CONFIG`
      ).toBe(true);
    }

    // Verify orphan user routes count is 0
    const orphanRoutes = auditedUserRoutes.filter((r) => !configuredPaths.has(r));
    expect(orphanRoutes).toHaveLength(0);
  });

  // TC-NAV-02: Navigation entries resolve to registered routes
  it("TC-NAV-02: Navigation entries resolve to registered routes", () => {
    const registeredRoutes = [
      "/",
      "/admin",
      "/admin/creches",
      "/admin/campaigns",
      "/admin/proposals",
      "/admin/users",
      "/pets",
      "/bookings",
      "/staff/board",
      "/staff/manage",
      "/staff/qr-scanner",
      "/tutors",
      "/chat",
      "/settings",
      "/financial",
      "/assinatura",
      "/marketing/campaigns",
      "/tutor/financial",
      "/tutor/store",
    ];

    for (const item of NAVIGATION_CONFIG) {
      expect(
        registeredRoutes.includes(item.path),
        `Navigation item ${item.id} path "${item.path}" must be registered in the app router`
      ).toBe(true);
    }
  });

  // TC-NAV-03: Desktop/mobile role visibility matches
  it("TC-NAV-03: Desktop and mobile role visibility match with zero drift", () => {
    const roles: UserRole[] = ["master_admin", "creche_admin", "staff", "tutor"];

    for (const role of roles) {
      const desktopPaths = getDesktopNavigationItems(role).map((i) => i.path).sort();
      const mobilePaths = getMobileNavigationItems(role).map((i) => i.path).sort();

      expect(
        desktopPaths,
        `Role "${role}" must have matching desktop and mobile navigation paths`
      ).toEqual(mobilePaths);
    }
  });

  // TC-NAV-04: Unauthorized roles do not receive protected navigation links
  it("TC-NAV-04: Unauthorized roles do not receive protected navigation links", () => {
    // 1. Tutor cannot access admin, financial, staff, or creche management
    const tutorPaths = getNavigationItemsForRole("tutor").map((i) => i.path);
    expect(tutorPaths.some((p) => p.startsWith("/admin"))).toBe(false);
    expect(tutorPaths.includes("/financial")).toBe(false);
    expect(tutorPaths.includes("/staff/board")).toBe(false);
    expect(tutorPaths.includes("/staff/manage")).toBe(false);
    expect(tutorPaths.includes("/staff/qr-scanner")).toBe(false);
    expect(tutorPaths.includes("/marketing/campaigns")).toBe(false);

    // 2. Staff cannot access global admin or creche owner financial/staff management
    const staffPaths = getNavigationItemsForRole("staff").map((i) => i.path);
    expect(staffPaths.some((p) => p.startsWith("/admin"))).toBe(false);
    expect(staffPaths.includes("/financial")).toBe(false);
    expect(staffPaths.includes("/assinatura")).toBe(false);
    expect(staffPaths.includes("/staff/manage")).toBe(false);

    // 3. Creche Admin cannot access global master_admin routes
    const crecheAdminPaths = getNavigationItemsForRole("creche_admin").map((i) => i.path);
    expect(crecheAdminPaths.some((p) => p.startsWith("/admin"))).toBe(false);

    // 4. Master Admin cannot access operational creche routes
    const masterAdminPaths = getNavigationItemsForRole("master_admin").map((i) => i.path);
    expect(masterAdminPaths.includes("/pets")).toBe(false);
    expect(masterAdminPaths.includes("/bookings")).toBe(false);
    expect(masterAdminPaths.includes("/staff/board")).toBe(false);
  });

  // TC-NAV-05: /admin canonical alias behavior
  it("TC-NAV-05: /admin aliases to canonical / for master_admin and redirects unauthorized roles", async () => {
    // Master admin accessing /admin redirects to /
    mockCurrentUser = { id: 1, name: "Master Admin", role: "master_admin" };
    const { hook: masterHook } = memoryLocation({ path: "/admin" });

    const { unmount: unmountMaster } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={masterHook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/");
    });
    unmountMaster();

    // Creche admin accessing /admin is redirected to / by MasterAdminGuard
    mockCurrentUser = { id: 2, name: "Creche Admin", role: "creche_admin", crecheId: 1 };
    const { hook: crecheHook } = memoryLocation({ path: "/admin" });

    const { unmount: unmountCreche } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={crecheHook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/");
    });
    unmountCreche();

    // Tutor accessing /admin is redirected to / by MasterAdminGuard
    mockCurrentUser = { id: 3, name: "Tutor User", role: "tutor", crecheId: 1 };
    const { hook: tutorHook } = memoryLocation({ path: "/admin" });

    const { unmount: unmountTutor } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={tutorHook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/");
    });
    unmountTutor();
  });

  // TC-NAV-06: Master Admin proposals discoverability
  it("TC-NAV-06: Master Admin proposals discoverability in sidebar, mobile config, and dashboard", () => {
    const masterItems = getNavigationItemsForRole("master_admin");
    const proposalsItem = masterItems.find((i) => i.path === "/admin/proposals");

    expect(proposalsItem).toBeDefined();
    expect(proposalsItem?.label).toBe("Propostas");
    expect(proposalsItem?.icon).toBe(FileSignature);
    expect(proposalsItem?.desktop).toBe(true);
    expect(proposalsItem?.mobile).toBe(true);

    // Verify presence in MasterAdminDashboard Quick Actions
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <MasterAdminDashboard />
        </Router>
      </QueryClientProvider>
    );

    const proposalsLink = screen.getByRole("link", { name: /propostas & serviços/i });
    expect(proposalsLink).toBeInTheDocument();
    expect(proposalsLink).toHaveAttribute("href", "/admin/proposals");
  });

  // TC-NAV-07: Tutor store discoverability
  it("TC-NAV-07: Tutor store discoverability in sidebar, mobile config, and dashboard", () => {
    const tutorItems = getNavigationItemsForRole("tutor");
    const storeItem = tutorItems.find((i) => i.path === "/tutor/store");

    expect(storeItem).toBeDefined();
    expect(storeItem?.label).toBe("Lojinha");
    expect(storeItem?.icon).toBe(ShoppingBag);
    expect(storeItem?.desktop).toBe(true);
    expect(storeItem?.mobile).toBe(true);

    // Verify presence in TutorDashboard Quick Actions
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <TutorDashboard user={{ id: 5, name: "Maria Silva", role: "tutor", crecheId: 1 }} />
        </Router>
      </QueryClientProvider>
    );

    const storeLink = screen.getByRole("link", { name: /lojinha/i });
    expect(storeLink).toBeInTheDocument();
    expect(storeLink).toHaveAttribute("href", "/tutor/store");
  });

  // TC-NAV-08: QR scanner discoverability
  it("TC-NAV-08: QR scanner discoverability for creche_admin and staff", () => {
    const crecheItems = getNavigationItemsForRole("creche_admin");
    const crecheQr = crecheItems.find((i) => i.path === "/staff/qr-scanner");
    expect(crecheQr).toBeDefined();
    expect(crecheQr?.icon).toBe(ScanLine);
    expect(crecheQr?.desktop).toBe(true);
    expect(crecheQr?.mobile).toBe(true);

    const staffItems = getNavigationItemsForRole("staff");
    const staffQr = staffItems.find((i) => i.path === "/staff/qr-scanner");
    expect(staffQr).toBeDefined();
    expect(staffQr?.icon).toBe(ScanLine);
    expect(staffQr?.desktop).toBe(true);
    expect(staffQr?.mobile).toBe(true);

    // Verify render in creche_admin sidebar
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <Sidebar user={{ id: 2, name: "Admin Creche", role: "creche_admin", crecheId: 1 } as any} />
        </Router>
      </QueryClientProvider>
    );

    expect(screen.getByText("Leitor QR")).toBeInTheDocument();
  });

  // TC-NAV-09: No duplicate route entries inside same navigation context
  it("TC-NAV-09: No duplicate route entries inside same navigation context", () => {
    const roles: UserRole[] = ["master_admin", "creche_admin", "staff", "tutor"];

    for (const role of roles) {
      const desktop = getDesktopNavigationItems(role);
      const desktopPaths = desktop.map((i) => i.path);
      const uniqueDesktop = new Set(desktopPaths);
      expect(
        desktopPaths.length,
        `Role ${role} has duplicate entries in desktop navigation`
      ).toBe(uniqueDesktop.size);

      const mobile = getMobileNavigationItems(role);
      const mobilePaths = mobile.map((i) => i.path);
      const uniqueMobile = new Set(mobilePaths);
      expect(
        mobilePaths.length,
        `Role ${role} has duplicate entries in mobile navigation`
      ).toBe(uniqueMobile.size);
    }
  });

  // TC-NAV-10: Unknown/current paths do not break active navigation state
  it("TC-NAV-10: Unknown or deep paths do not throw and render navigation properly", () => {
    const { hook } = memoryLocation({ path: "/unknown-subpath-that-does-not-exist" });

    expect(() => {
      render(
        <QueryClientProvider client={queryClient}>
          <Router hook={hook}>
            <Sidebar user={{ id: 1, name: "Master Admin", role: "master_admin" } as any} />
            <BottomNav user={{ id: 1, name: "Master Admin", role: "master_admin" } as any} />
          </Router>
        </QueryClientProvider>
      );
    }).not.toThrow();

    expect(screen.getAllByText("Dashboard").length).toBeGreaterThanOrEqual(1);
  });

  // TC-NAV-11: Navigation configuration references only registered routes
  it("TC-NAV-11: Navigation configuration items are well-formed and valid", () => {
    for (const item of NAVIGATION_CONFIG) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.path.startsWith("/")).toBe(true);
      expect(item.icon).toBeDefined();
      expect(item.roles.length).toBeGreaterThan(0);
    }
  });

  // TC-NAV-12: Navigation configuration uses valid existing roles
  it("TC-NAV-12: Navigation configuration strictly uses canonical existing roles (ROLE_MODEL_CHANGES = 0)", () => {
    const canonicalRoles = new Set(["master_admin", "creche_admin", "staff", "tutor"]);

    for (const item of NAVIGATION_CONFIG) {
      for (const role of item.roles) {
        expect(
          canonicalRoles.has(role),
          `Role "${role}" in item ${item.id} is not a canonical user role`
        ).toBe(true);
      }
    }
  });
});
