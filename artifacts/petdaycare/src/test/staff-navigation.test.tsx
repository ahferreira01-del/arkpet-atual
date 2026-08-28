import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, useLocation, useSearch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Real components under test
import StaffBoard from "@/pages/staff/board";

// Mock child components of StaffBoard (StaffTasks and Walks) to simple markers
vi.mock("@/pages/staff/index", () => ({
  default: () => <div data-testid="staff-tasks-content">STAFF_TASKS_CONTENT</div>,
}));

vi.mock("@/pages/walks/index", () => ({
  default: () => <div data-testid="walks-content">WALKS_CONTENT</div>,
}));

vi.mock("@/pages/staff/manage", () => ({
  default: () => <div data-testid="manage-staff-content">MANAGE_STAFF_CONTENT</div>,
}));

// Mock Auth
let mockUser: { id: number; name: string; role: string; crecheId: number | null } | null = {
  id: 10,
  name: "Staff Teste",
  role: "staff",
  crecheId: 1,
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock minimal App components to isolate routing
vi.mock("@/components/layout/app-layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

import App from "@/App";

function LocationTracker() {
  const [loc] = useLocation();
  const search = useSearch();
  return <div data-testid="current-location">{loc}{search ? `?${search}` : ""}</div>;
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe("Staff Navigation & Guard Characterization Suite", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    mockUser = {
      id: 10,
      name: "Staff Teste",
      role: "staff",
      crecheId: 1,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // TEST 1: Green
  it("redirects /staff to /staff/board for staff using replace semantics", async () => {
    mockUser = { id: 10, name: "Staff User", role: "staff", crecheId: 1 };
    const { hook } = memoryLocation({ path: "/staff" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/staff/board");
    });
  });

  // TEST 2: Green
  it("redirects /staff to /staff/board for creche_admin", async () => {
    mockUser = { id: 20, name: "Admin User", role: "creche_admin", crecheId: 1 };
    const { hook } = memoryLocation({ path: "/staff" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/staff/board");
    });
  });

  // TEST 3: Green
  it("denies staff access to /staff/manage through CrecheAdminGuard", async () => {
    mockUser = { id: 10, name: "Staff User", role: "staff", crecheId: 1 };
    const { hook } = memoryLocation({ path: "/staff/manage" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/");
    });
    expect(screen.queryByTestId("manage-staff-content")).not.toBeInTheDocument();
  });

  // TEST 4: Green
  it("allows creche_admin access to /staff/manage", async () => {
    mockUser = { id: 20, name: "Admin User", role: "creche_admin", crecheId: 1 };
    const { hook } = memoryLocation({ path: "/staff/manage" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("manage-staff-content")).toBeInTheDocument();
    });
    expect(screen.getByTestId("current-location")).toHaveTextContent("/staff/manage");
  });

  // TEST 5: Green
  it("resolves StaffBoard initial tab from current query contract", async () => {
    // 5.1 Default /staff/board -> Tarefas
    {
      const { hook } = memoryLocation({ path: "/staff/board" });
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <Router hook={hook}>
            <StaffBoard />
          </Router>
        </QueryClientProvider>
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tarefas");
      expect(screen.getByTestId("staff-tasks-content")).toBeInTheDocument();
      unmount();
    }

    // 5.2 /staff/board?tab=tarefas -> Tarefas
    {
      const { hook } = memoryLocation({ path: "/staff/board?tab=tarefas" });
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <Router hook={hook}>
            <StaffBoard />
          </Router>
        </QueryClientProvider>
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tarefas");
      expect(screen.getByTestId("staff-tasks-content")).toBeInTheDocument();
      unmount();
    }

    // 5.3 /staff/board?tab=passeios -> Passeios
    {
      const { hook } = memoryLocation({ path: "/staff/board?tab=passeios" });
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <Router hook={hook}>
            <StaffBoard />
          </Router>
        </QueryClientProvider>
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Passeios");
      expect(screen.getByTestId("walks-content")).toBeInTheDocument();
      unmount();
    }

    // 5.4 /staff/board?tab=invalid -> Tarefas
    {
      const { hook } = memoryLocation({ path: "/staff/board?tab=invalid" });
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <Router hook={hook}>
            <StaffBoard />
          </Router>
        </QueryClientProvider>
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tarefas");
      expect(screen.getByTestId("staff-tasks-content")).toBeInTheDocument();
      unmount();
    }
  });

  // TEST 6: Green
  it("writes ?tab=passeios and updates presentation when Passeios is selected", async () => {
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/staff/board?tab=tarefas" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <LocationTracker />
          <StaffBoard />
        </Router>
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tarefas");
    expect(screen.getByTestId("staff-tasks-content")).toBeInTheDocument();

    const passeiosTabButton = screen.getByRole("button", { name: /passeios/i });
    await user.click(passeiosTabButton);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Passeios");
      expect(screen.getByTestId("walks-content")).toBeInTheDocument();
    });

    expect(screen.getByTestId("current-location")).toHaveTextContent("tab=passeios");
  });

  // TEST 7: RED (R33HA-NAV-001)
  it("preserves Passeios intent when legacy /walks alias redirects to StaffBoard", async () => {
    mockUser = { id: 10, name: "Staff User", role: "staff", crecheId: 1 };
    const { hook } = memoryLocation({ path: "/walks" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <LocationTracker />
          <App />
        </Router>
      </QueryClientProvider>
    );

    // Expected contract: /walks should redirect to /staff/board?tab=passeios
    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent("/staff/board?tab=passeios");
    });
  });

  // TEST 8: RED (R33HA-NAV-002)
  it("re-synchronizes StaffBoard tab and title when the tab query changes after mount", async () => {
    const { hook, navigate } = memoryLocation({ path: "/staff/board?tab=tarefas" });

    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <StaffBoard />
        </Router>
      </QueryClientProvider>
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tarefas");
    expect(screen.getByTestId("staff-tasks-content")).toBeInTheDocument();

    // External query navigation without unmounting StaffBoard
    navigate("/staff/board?tab=passeios");

    // Desired contract: StaffBoard must react to the query change and re-sync tab and title
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Passeios");
      expect(screen.getByTestId("walks-content")).toBeInTheDocument();
    });
  });
});
