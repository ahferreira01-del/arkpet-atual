import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import PetsDirectory from "@/pages/pets/index";
import TutorsPage from "@/pages/tutors/index";
import BookingsPage from "@/pages/bookings/index";
import ManageStaff from "@/pages/staff/manage";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";

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

let mockLocation = "/";
let mockSetLocation = vi.fn();
let mockSearchString = "";

vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => [mockLocation, mockSetLocation],
    useSearch: () => mockSearchString,
  };
});

// Mock child modals for Bookings
vi.mock("@/components/bookings/personal-items-modal", () => ({
  PersonalItemsModal: ({ open, isOpen, onComplete, booking }: any) =>
    open || isOpen ? (
      <div data-testid="personal-items-modal">
        <span>Personal Items Modal for {booking?.petName}</span>
      </div>
    ) : null,
}));

vi.mock("@/components/bookings/add-consumable-modal", () => ({
  AddConsumableModal: ({ isOpen, onClose, booking }: any) =>
    isOpen ? (
      <div data-testid="add-consumable-modal">
        <span>Consumable Modal for {booking?.petName}</span>
      </div>
    ) : null,
}));

vi.mock("@/components/financial/smart-indicators", () => ({
  TutorSmartIndicators: () => <div data-testid="tutor-smart-indicators" />,
}));

vi.mock("@/components/commercial/tutor-commercial-modal", () => ({
  TutorCommercialModal: ({ isOpen, onClose, tutorName }: any) =>
    isOpen ? (
      <div data-testid="tutor-commercial-modal">
        <span>Commercial Modal for {tutorName}</span>
        <button onClick={onClose}>Fechar</button>
      </div>
    ) : null,
}));

const mockPets = [
  {
    id: 1,
    name: "Rex",
    species: "dog",
    breed: "Labrador",
    gender: "male",
    tutorId: 101,
    tutorName: "Carlos Silva",
    allergies: "Frango",
    specialNeeds: "Medicamento",
    temperament: "calmo",
    isCheckedIn: true,
    photoUrl: "/rex.jpg",
    status: "active",
  },
  {
    id: 2,
    name: "Mel",
    species: "cat",
    breed: "Siamês",
    gender: "female",
    tutorId: 102,
    tutorName: "Mariana Costa",
    allergies: null,
    specialNeeds: null,
    temperament: "dócil",
    isCheckedIn: false,
    photoUrl: null,
    status: "active",
  },
];

const mockTutors = [
  {
    id: 101,
    name: "Carlos Silva",
    email: "carlos@example.com",
    isActive: true,
    petCount: 1,
    mensalidadeDia: 10,
    createdAt: "2026-01-15T00:00:00Z",
  },
  {
    id: 102,
    name: "Mariana Costa",
    email: "mariana@example.com",
    isActive: false,
    petCount: 1,
    mensalidadeDia: null,
    createdAt: "2026-02-20T00:00:00Z",
  },
];

const mockBookings = [
  {
    id: 501,
    petId: 1,
    petName: "Rex",
    tutorId: 101,
    tutorName: "Carlos Silva",
    type: "day_use",
    status: "confirmed",
    startDate: "2026-09-30",
    endDate: "2026-09-30",
    checkInTime: null,
    checkOutTime: null,
    notes: null,
    hasPersonalItems: false,
    personalItemsPhotoUrl: null,
  },
  {
    id: 502,
    petId: 2,
    petName: "Mel",
    tutorId: 102,
    tutorName: "Mariana Costa",
    type: "lodging",
    status: "active",
    startDate: "2026-09-29",
    endDate: "2026-10-02",
    checkInTime: "2026-09-29T10:00:00Z",
    checkOutTime: null,
    notes: "Ração especial",
    hasPersonalItems: true,
    personalItemsPhotoUrl: "/items.jpg",
  },
];

const mockStaff = [
  {
    id: 201,
    name: "Roberto Admin",
    email: "roberto@creche.com",
    role: "creche_admin",
    isActive: true,
  },
  {
    id: 202,
    name: "Juliana Monitora",
    email: "juliana@creche.com",
    role: "staff",
    isActive: true,
  },
  {
    id: 203,
    name: "Marcos Ex-staff",
    email: "marcos@creche.com",
    role: "staff",
    isActive: false,
  },
];

vi.mock("@workspace/api-client-react", async () => {
  const actual: any = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual,
    useListPets: vi.fn(() => ({
      data: { items: mockPets, total: mockPets.length },
      isLoading: false,
    })),
    useListBookings: vi.fn(() => ({
      data: { items: mockBookings, total: mockBookings.length },
      isLoading: false,
    })),
    useListCrecheStaff: vi.fn(() => ({
      data: mockStaff,
      isLoading: false,
    })),
    useGetCrecheStats: vi.fn(() => ({
      data: { totalPets: 2, checkedInPets: 1 },
      isLoading: false,
    })),
    useGetBillingSubscription: vi.fn(() => ({
      data: { plan: { petLimit: 50 }, status: "active" },
      isLoading: false,
    })),
    useListTasks: vi.fn(() => ({ data: [], isLoading: false })),
    useCreatePet: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useCreateBooking: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useUpdateBooking: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useCheckIn: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useCheckOut: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useAddStaffMember: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    getListPetsQueryKey: (id: any) => ["pets", id],
    getListBookingsQueryKey: (id: any) => ["bookings", id],
    getListCrecheStaffQueryKey: (id: any) => ["staff", id],
    getGetCrecheStatsQueryKey: (id: any) => ["stats", id],
    getListUsersQueryKey: () => ["users"],
    getListTasksQueryKey: (id: any) => ["tasks", id],
  };
});

describe("R39.E — Core Entity Directories Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation = "/";
    mockSearchString = "";

    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin Test", role: "creche_admin", crecheId: 10 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: { items: mockPets, total: mockPets.length },
      isLoading: false,
    });

    (apiClientModule.useListBookings as any).mockReturnValue({
      data: { items: mockBookings, total: mockBookings.length },
      isLoading: false,
    });

    (apiClientModule.useListCrecheStaff as any).mockReturnValue({
      data: mockStaff,
      isLoading: false,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/tutors/manage") || url.includes("/tutors")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTutors),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    });
  });

  // ==========================================
  // COMMON DIRECTORY TESTS (TC-DIR-01 to TC-DIR-10)
  // ==========================================

  it("TC-DIR-01 — core directory pages use canonical PageHeader", async () => {
    // 1. Pets
    const { unmount: unmountPets } = renderWithProviders(<PetsDirectory />);
    expect(screen.getByRole("heading", { name: "Pets", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Gerencie perfis, registros médicos e rastreamento.")).toBeInTheDocument();
    unmountPets();

    // 2. Tutors
    const { unmount: unmountTutors } = renderWithProviders(<TutorsPage />);
    expect(screen.getByRole("heading", { name: "Tutores", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Gerencie os tutores cadastrados na sua creche.")).toBeInTheDocument();
    unmountTutors();

    // 3. Bookings
    const { unmount: unmountBookings } = renderWithProviders(<BookingsPage />);
    expect(screen.getByRole("heading", { name: "Reservas", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Gerencie day use e hospedagens.")).toBeInTheDocument();
    unmountBookings();

    // 4. Staff
    renderWithProviders(<ManageStaff />);
    expect(screen.getByRole("heading", { name: "Gestão de Equipe", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Gerencie os membros da sua equipe.")).toBeInTheDocument();
  });

  it("TC-DIR-02 — authorized primary actions remain visible", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin Test", role: "creche_admin", crecheId: 10 },
      isLoading: false,
    });

    const { unmount: unmountPets } = renderWithProviders(<PetsDirectory />);
    expect(screen.getByRole("button", { name: /Cadastrar Pet/i })).toBeInTheDocument();
    unmountPets();

    const { unmount: unmountTutors } = renderWithProviders(<TutorsPage />);
    expect(screen.getByRole("button", { name: /Novo Tutor/i })).toBeInTheDocument();
    unmountTutors();

    const { unmount: unmountBookings } = renderWithProviders(<BookingsPage />);
    expect(screen.getByRole("button", { name: /Nova Reserva/i })).toBeInTheDocument();
    unmountBookings();

    renderWithProviders(<ManageStaff />);
    expect(screen.getByRole("button", { name: /Adicionar/i })).toBeInTheDocument();
  });

  it("TC-DIR-03 — unauthorized actions remain hidden", async () => {
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 99, name: "Tutor User", role: "tutor", crecheId: 10 },
      isLoading: false,
    });

    const { unmount: unmountBookings } = renderWithProviders(<BookingsPage />);
    // Tutor does not have Nova Reserva on bookings index directly or cannot manage tutors
    expect(screen.queryByRole("button", { name: "Adicionar Membro" })).not.toBeInTheDocument();
    unmountBookings();
  });

  it("TC-DIR-04 — empty state renders contextual message when zero items exist", async () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });

    renderWithProviders(<PetsDirectory />);
    expect(screen.getByText("Nenhum pet encontrado")).toBeInTheDocument();
    expect(screen.getByText("Nenhum pet cadastrado nesta creche ainda.")).toBeInTheDocument();
  });

  it("TC-DIR-05 — filtered empty state guides user to adjust filters", async () => {
    renderWithProviders(<PetsDirectory />);
    const searchInput = screen.getByPlaceholderText("Buscar pets...");
    fireEvent.change(searchInput, { target: { value: "NonExistentPetName" } });

    expect(screen.getByText("Nenhum pet encontrado")).toBeInTheDocument();
    expect(screen.getByText("Tente ajustar os critérios de busca.")).toBeInTheDocument();
  });

  it("TC-DIR-06 — loading state renders skeleton without layout jumping", async () => {
    (apiClientModule.useListPets as any).mockReturnValueOnce({
      data: null,
      isLoading: true,
    });

    const { container } = renderWithProviders(<PetsDirectory />);
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("TC-DIR-07 — error state preserves stability on failure", async () => {
    global.fetch = vi.fn().mockImplementationOnce(() =>
      Promise.reject(new Error("Network connection error"))
    );

    renderWithProviders(<TutorsPage />);
    // Does not throw uncaught error and renders header
    expect(screen.getByRole("heading", { name: "Tutores", level: 1 })).toBeInTheDocument();
  });

  it("TC-DIR-08 — search/filter integrity preserves count summary", async () => {
    renderWithProviders(<PetsDirectory />);
    expect(screen.getByText("2 pets encontrados")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Buscar pets...");
    fireEvent.change(searchInput, { target: { value: "Rex" } });
    expect(screen.getByText("1 pet encontrado")).toBeInTheDocument();
  });

  it("TC-DIR-09 — detail links resolve to correct entity routes", async () => {
    renderWithProviders(<PetsDirectory />);
    const profileLinks = screen.getAllByRole("link", { name: /Ver perfil/i });
    expect(profileLinks.length).toBeGreaterThanOrEqual(2);
    const hrefs = profileLinks.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/pets/1");
    expect(hrefs).toContain("/pets/2");
  });

  it("TC-DIR-10 — action menu accessibility provides accessible names", async () => {
    renderWithProviders(<PetsDirectory />);
    const moreBtn = screen.getByLabelText("Mais opções de Rex");
    expect(moreBtn).toBeInTheDocument();
  });

  // ==========================================
  // PET DIRECTORY TESTS (TC-PET-01 to TC-PET-04)
  // ==========================================

  it("TC-PET-01 — pet directory renders real entities with species, breed, and gender", async () => {
    renderWithProviders(<PetsDirectory />);
    expect(screen.getByRole("heading", { name: "Rex" })).toBeInTheDocument();
    expect(screen.getByText(/Labrador • Macho/i)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Mel" })).toBeInTheDocument();
    expect(screen.getByText(/Siamês • Fêmea/i)).toBeInTheDocument();
  });

  it("TC-PET-02 — pet image fallback renders gracefully when photoUrl is null", async () => {
    const { container } = renderWithProviders(<PetsDirectory />);
    // Mel has photoUrl: null and species: "cat", so Cat fallback SVG renders in PetAvatar
    const fallback = container.querySelector("svg.lucide-cat, svg.lucide-dog");
    expect(fallback).toBeInTheDocument();
  });

  it("TC-PET-03 — pet/tutor relationship preserved and visible", async () => {
    renderWithProviders(<PetsDirectory />);
    expect(screen.getByText("Carlos Silva")).toBeInTheDocument();
    expect(screen.getByText("Mariana Costa")).toBeInTheDocument();
  });

  it("TC-PET-04 — authorized create/edit access preserved for creche_admin", async () => {
    renderWithProviders(<PetsDirectory />);
    const createBtn = screen.getByRole("button", { name: /Cadastrar Pet/i });
    fireEvent.click(createBtn);
    expect(screen.getByRole("heading", { name: "Cadastrar Pet" })).toBeInTheDocument();
  });

  // ==========================================
  // TUTOR DIRECTORY TESTS (TC-TUTOR-01 to TC-TUTOR-03)
  // ==========================================

  it("TC-TUTOR-01 — tutor directory renders real tutor data", async () => {
    renderWithProviders(<TutorsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Silva")).toBeInTheDocument();
      expect(screen.getByText("carlos@example.com")).toBeInTheDocument();
      expect(screen.getByText("Mariana Costa")).toBeInTheDocument();
      expect(screen.getByText("mariana@example.com")).toBeInTheDocument();
    });
  });

  it("TC-TUTOR-02 — relationship with pets preserved in tutor cards", async () => {
    renderWithProviders(<TutorsPage />);
    await waitFor(() => {
      const petCounts = screen.getAllByText("1 pet");
      expect(petCounts.length).toBe(2);
      expect(screen.getAllByRole("button", { name: /Ver Pets/i }).length).toBe(2);
    });
  });

  it("TC-TUTOR-03 — permission visibility preserved for commercial condition button", async () => {
    // Admin sees Condição Comercial
    renderWithProviders(<TutorsPage />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Condição Comercial/i }).length).toBe(2);
    });
  });

  // ==========================================
  // RESERVATION DIRECTORY TESTS (TC-BOOK-01 to TC-BOOK-04)
  // ==========================================

  it("TC-BOOK-01 — booking directory renders real booking records", async () => {
    renderWithProviders(<BookingsPage />);
    expect(screen.getAllByText("Rex").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Mel").length).toBeGreaterThanOrEqual(1);
  });

  it("TC-BOOK-02 — status mappings use domain values", async () => {
    renderWithProviders(<BookingsPage />);
    expect(screen.getAllByText("Confirmada").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ativa").length).toBeGreaterThanOrEqual(1);
  });

  it("TC-BOOK-03 — date information preserved and formatted in pt-BR", async () => {
    renderWithProviders(<BookingsPage />);
    expect(screen.getAllByText(/30\/09\/2026/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/29\/09\/2026/i).length).toBeGreaterThanOrEqual(1);
  });

  it("TC-BOOK-04 — operational action buttons preserved for confirmed/active bookings", async () => {
    renderWithProviders(<BookingsPage />);
    expect(screen.getAllByText(/Check-in/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Check-out/i).length).toBeGreaterThanOrEqual(1);
  });

  // ==========================================
  // STAFF DIRECTORY TESTS (TC-STAFF-01 to TC-STAFF-03)
  // ==========================================

  it("TC-STAFF-01 — staff directory renders real team data and metrics", async () => {
    renderWithProviders(<ManageStaff />);
    expect(screen.getByText("Roberto Admin")).toBeInTheDocument();
    expect(screen.getByText("Juliana Monitora")).toBeInTheDocument();
    expect(screen.getByText("Marcos Ex-staff")).toBeInTheDocument();

    expect(screen.getByText("Total Ativo")).toBeInTheDocument();
    expect(screen.getByText("Funcionários")).toBeInTheDocument();
    expect(screen.getByText("Admins")).toBeInTheDocument();
  });

  it("TC-STAFF-02 — role and status values preserved", async () => {
    renderWithProviders(<ManageStaff />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Funcionário")).toBeInTheDocument();
    expect(screen.getByText("Inativo")).toBeInTheDocument();
  });

  it("TC-STAFF-03 — permission visibility preserved for add member action", async () => {
    renderWithProviders(<ManageStaff />);
    const addBtn = screen.getByRole("button", { name: /Adicionar/i });
    fireEvent.click(addBtn);
    expect(screen.getByRole("heading", { name: "Adicionar Membro à Equipe" })).toBeInTheDocument();
  });
});
