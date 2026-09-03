import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor, within } from "./utils";
import PetsDirectory from "@/pages/pets/index";
import PetDetail from "@/pages/pets/detail";
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

vi.mock("@/hooks/use-financial", () => ({
  useTutorInvoices: vi.fn(() => ({ data: [], isLoading: false })),
  useBookingConsumables: vi.fn(() => ({ data: [], isLoading: false })),
  useDeleteBookingConsumable: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const mockPets = [
  {
    id: 1,
    name: "Rex",
    species: "dog",
    breed: "Labrador",
    gender: "male",
    tutorId: 101,
    tutorName: "João Silva",
    allergies: "Frango, Conservantes",
    specialNeeds: "Medicamento diário às 14h",
    temperament: "calmo",
    isCheckedIn: true,
    photoUrl: "https://example.com/rex.jpg",
    status: "active",
  },
  {
    id: 2,
    name: "Thor",
    species: "dog",
    breed: "Bulldog",
    gender: "male",
    tutorId: 102,
    tutorName: "Maria Santos",
    allergies: null,
    specialNeeds: null,
    temperament: "brincalhão",
    isCheckedIn: false,
    photoUrl: null,
    status: "active",
  },
  {
    id: 3,
    name: "Luna",
    species: "dog",
    breed: "Poodle",
    gender: "female",
    tutorId: 103,
    tutorName: "Carlos Lima",
    allergies: "Pólen",
    specialNeeds: null,
    temperament: "sociável",
    isCheckedIn: true,
    photoUrl: null,
    status: "active",
  },
];

vi.mock("@workspace/api-client-react", () => ({
  useListPets: vi.fn(() => ({
    data: { items: mockPets, total: mockPets.length },
    isLoading: false,
  })),
  useGetPet: vi.fn((_crecheId, petId) => {
    const p = mockPets.find((pet) => pet.id === petId);
    return { data: p ?? null, isLoading: false };
  }),
  useUpdatePet: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useListBookings: vi.fn(() => ({ data: { items: [] }, isLoading: false })),
  useCheckIn: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  getGetPetQueryKey: vi.fn((crecheId, petId) => ["pet", crecheId, petId]),
  getListPetsQueryKey: vi.fn((crecheId) => ["pets", crecheId]),
  getListBookingsQueryKey: vi.fn((crecheId) => ["bookings", crecheId]),
  useListWalks: vi.fn(() => ({ data: [], isLoading: false })),
  useCreatePet: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useGetBillingSubscription: vi.fn(() => ({
    data: { plan: { petLimit: 100 }, status: "active" },
    isLoading: false,
  })),
  useGetCrecheStats: vi.fn(() => ({
    data: { totalPets: 3, checkedInPets: 2 },
    isLoading: false,
  })),
  getGetCrecheStatsQueryKey: vi.fn((crecheId) => ["stats", crecheId]),
  getListUsersQueryKey: vi.fn(() => ["users"]),
}));

describe("PetsDirectory (/pets) — Characterization Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin Test", role: "creche_admin", crecheId: 10 },
      isLoading: false,
    });

    (apiClientModule.useListPets as any).mockReturnValue({
      data: { items: mockPets, total: mockPets.length },
      isLoading: false,
    });

    (apiClientModule.useGetCrecheStats as any).mockReturnValue({
      data: { totalPets: 3, checkedInPets: 2 },
      isLoading: false,
    });

    (apiClientModule.useGetBillingSubscription as any).mockReturnValue({
      data: { plan: { petLimit: 100 }, status: "active" },
      isLoading: false,
    });

    // Mock fetch for useTutors
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ id: 101, name: "João Silva", email: "joao@example.com" }]),
      })
    );
  });

  it("1. renders page header, search input, view toggles, presence filter and sort select", async () => {
    renderWithProviders(<PetsDirectory />);

    expect(screen.getByRole("heading", { name: "Pets", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Gerencie perfis, registros médicos e rastreamento.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Buscar pets...")).toBeInTheDocument();
    expect(screen.getByText("Presentes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("A-Z (Nome)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cadastrar Pet/i })).toBeInTheDocument();
  });

  it("2. renders pet cards in Grid view with name, breed, gender, tutor, presence and profile links", async () => {
    renderWithProviders(<PetsDirectory />);

    // Rex card
    expect(screen.getByRole("heading", { name: "Rex" })).toBeInTheDocument();
    expect(screen.getByText(/Labrador • Macho/i)).toBeInTheDocument();
    expect(screen.getByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("calmo")).toBeInTheDocument();

    // Thor card
    expect(screen.getByRole("heading", { name: "Thor" })).toBeInTheDocument();
    expect(screen.getByText(/Bulldog • Macho/i)).toBeInTheDocument();
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("brincalhão")).toBeInTheDocument();

    // Presence badges (Rex & Luna present, Thor at home)
    const presentBadges = screen.getAllByText("Presente");
    expect(presentBadges.length).toBe(2);
    expect(screen.getByText("Em casa")).toBeInTheDocument();

    // Profile navigation links (all 3 pets have profile links)
    const profileLinks = screen.getAllByRole("link", { name: /Ver perfil/i });
    expect(profileLinks.length).toBeGreaterThanOrEqual(3);
    const hrefs = profileLinks.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/pets/1");
    expect(hrefs).toContain("/pets/2");
    expect(hrefs).toContain("/pets/3");
  });

  it("3. switches to List view mode when list button is clicked and persists mode", async () => {
    renderWithProviders(<PetsDirectory />);

    // Find list mode button by selecting buttons and finding svg.lucide-list
    const buttons = screen.getAllByRole("button");
    const listBtn = buttons.find((b) => b.querySelector("svg.lucide-list"));
    expect(listBtn).toBeDefined();
    fireEvent.click(listBtn!);

    // In List mode, pet names and info still render cleanly
    expect(screen.getByRole("heading", { name: "Rex" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Thor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Luna" })).toBeInTheDocument();

    expect(localStorage.getItem("petsViewMode")).toBe("list");
  });

  it("4. filters pets by search query against name and breed", async () => {
    renderWithProviders(<PetsDirectory />);

    const searchInput = screen.getByPlaceholderText("Buscar pets...");

    // Search by name "Thor"
    fireEvent.change(searchInput, { target: { value: "Thor" } });
    expect(screen.getByRole("heading", { name: "Thor" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Luna" })).not.toBeInTheDocument();
    expect(screen.getByText("1 pet encontrado")).toBeInTheDocument();

    // Search by breed "Poodle"
    fireEvent.change(searchInput, { target: { value: "Poodle" } });
    expect(screen.getByRole("heading", { name: "Luna" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rex" })).not.toBeInTheDocument();
  });

  it("5. filters pets by presence toggle button", async () => {
    renderWithProviders(<PetsDirectory />);

    const presentButton = screen.getByRole("button", { name: /Presentes/i });

    // Activate presence filter
    fireEvent.click(presentButton);

    // Rex and Luna are checked in, Thor is not
    expect(screen.getByRole("heading", { name: "Rex" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Luna" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Thor" })).not.toBeInTheDocument();
    expect(screen.getByText("2 pets encontrados")).toBeInTheDocument();

    // Deactivate presence filter
    fireEvent.click(presentButton);
    expect(screen.getByRole("heading", { name: "Thor" })).toBeInTheDocument();
    expect(screen.getByText("3 pets encontrados")).toBeInTheDocument();
  });

  it("6. sorts pets alphabetically by name A-Z and Z-A", async () => {
    renderWithProviders(<PetsDirectory />);

    const sortSelect = screen.getByDisplayValue("A-Z (Nome)");

    // Default A-Z order: Luna, Rex, Thor
    let headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Luna", "Rex", "Thor"]);

    // Change to Z-A order
    fireEvent.change(sortSelect, { target: { value: "name_desc" } });
    headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Thor", "Rex", "Luna"]);
  });

  it("7. renders empty state when search returns zero matching pets", async () => {
    renderWithProviders(<PetsDirectory />);

    const searchInput = screen.getByPlaceholderText("Buscar pets...");
    fireEvent.change(searchInput, { target: { value: "InexistenteXYZ" } });

    expect(screen.getByText("Nenhum pet encontrado")).toBeInTheDocument();
    expect(screen.getByText("Tente ajustar os critérios de busca.")).toBeInTheDocument();
  });

  it("8. renders loading skeletons when pets list is loading", async () => {
    (apiClientModule.useListPets as any).mockReturnValue({
      data: null,
      isLoading: true,
    });

    const { container } = renderWithProviders(<PetsDirectory />);
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBe(4);
  });

  it("9. opens Cadastrar Pet modal for creche_admin", async () => {
    renderWithProviders(<PetsDirectory />);

    const createBtn = screen.getByRole("button", { name: /Cadastrar Pet/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole("heading", { name: "Cadastrar Pet", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Dados Básicos")).toBeInTheDocument();
    expect(document.querySelector('input[name="name"]')).toBeInTheDocument();
  });

  it("10. EVO-R35-001: renders Alergia and Cuidados especiais badges in Grid view without exposing raw medical text", async () => {
    // Rex has allergies="Frango, Conservantes" and specialNeeds="Medicamento diário às 14h"
    // Luna has allergies="Pólen" and specialNeeds=null
    // Thor has allergies=null and specialNeeds=null
    renderWithProviders(<PetsDirectory />);

    // Rex card: renders BOTH "Alergia" and "Cuidados especiais"
    const rexHeading = screen.getByRole("heading", { name: "Rex" });
    const rexCard = rexHeading.closest(".group")!;
    expect(within(rexCard as HTMLElement).getByText(/^Alergia$/)).toBeInTheDocument();
    expect(within(rexCard as HTMLElement).getByText(/^Cuidados especiais$/)).toBeInTheDocument();

    // Luna card: renders "Alergia" only, does NOT render "Cuidados especiais"
    const lunaHeading = screen.getByRole("heading", { name: "Luna" });
    const lunaCard = lunaHeading.closest(".group")!;
    expect(within(lunaCard as HTMLElement).getByText(/^Alergia$/)).toBeInTheDocument();
    expect(within(lunaCard as HTMLElement).queryByText(/^Cuidados especiais$/)).not.toBeInTheDocument();

    // Thor card: renders NEITHER badge
    const thorHeading = screen.getByRole("heading", { name: "Thor" });
    const thorCard = thorHeading.closest(".group")!;
    expect(within(thorCard as HTMLElement).queryByText(/^Alergia$/)).not.toBeInTheDocument();
    expect(within(thorCard as HTMLElement).queryByText(/^Cuidados especiais$/)).not.toBeInTheDocument();

    // Totals on page: exactly 2 "Alergia" badges and 1 "Cuidados especiais" badge
    expect(screen.getAllByText(/^Alergia$/).length).toBe(2);
    expect(screen.getAllByText(/^Cuidados especiais$/).length).toBe(1);

    // Raw medical free text must NOT be rendered in the DOM
    expect(screen.queryByText(/Frango, Conservantes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Medicamento diário às 14h/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pólen/i)).not.toBeInTheDocument();

    // No unapproved "Medicação" badge
    expect(screen.queryByText(/^Medicação$/i)).not.toBeInTheDocument();
  });

  it("11. EVO-R35-001: renders badges in List view and handles special-care-only and whitespace-only edge cases", async () => {
    const customPets = [
      {
        id: 10,
        name: "Max",
        species: "dog",
        breed: "Beagle",
        gender: "male",
        tutorId: 101,
        tutorName: "João Silva",
        allergies: "   ", // whitespace only -> no allergy badge
        specialNeeds: "Ração renal", // special care only -> Cuidados especiais badge
        temperament: "calmo",
        isCheckedIn: true,
        photoUrl: null,
        status: "active",
      },
      {
        id: 11,
        name: "Bella",
        species: "dog",
        breed: "Golden",
        gender: "female",
        tutorId: 102,
        tutorName: "Maria Santos",
        allergies: "", // empty string -> no allergy badge
        specialNeeds: "   ", // whitespace only -> no special care badge
        temperament: "dócil",
        isCheckedIn: false,
        photoUrl: null,
        status: "active",
      },
    ];

    (apiClientModule.useListPets as any).mockReturnValue({
      data: { items: customPets, total: customPets.length },
      isLoading: false,
    });

    renderWithProviders(<PetsDirectory />);

    // Switch to List view
    const buttons = screen.getAllByRole("button");
    const listBtn = buttons.find((b) => b.querySelector("svg.lucide-list"));
    expect(listBtn).toBeDefined();
    fireEvent.click(listBtn!);

    // Max row in List view: renders "Cuidados especiais" only (whitespace allergies ignored)
    const maxHeading = screen.getByRole("heading", { name: "Max" });
    const maxCard = maxHeading.closest(".group")!;
    expect(within(maxCard as HTMLElement).getByText(/^Cuidados especiais$/)).toBeInTheDocument();
    expect(within(maxCard as HTMLElement).queryByText(/^Alergia$/)).not.toBeInTheDocument();

    // Bella row in List view: renders NEITHER badge (both are empty/whitespace)
    const bellaHeading = screen.getByRole("heading", { name: "Bella" });
    const bellaCard = bellaHeading.closest(".group")!;
    expect(within(bellaCard as HTMLElement).queryByText(/^Alergia$/)).not.toBeInTheDocument();
    expect(within(bellaCard as HTMLElement).queryByText(/^Cuidados especiais$/)).not.toBeInTheDocument();

    // Raw text check
    expect(screen.queryByText(/Ração renal/i)).not.toBeInTheDocument();
  });
});

describe("PetDetail (/pets/:id) — EVO-R35-002 Direct Tutor Chat Shortcut Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (authModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Admin Test", role: "creche_admin", crecheId: 10 },
      isLoading: false,
    });
    (apiClientModule.useGetPet as any).mockImplementation((_crecheId: number, id: number) => {
      const p = mockPets.find((pet) => pet.id === id);
      return { data: p ?? null, isLoading: false };
    });
    (apiClientModule.useListBookings as any).mockReturnValue({
      data: { items: [] },
      isLoading: false,
    });
  });

  it("12. characterizes PetDetail data baseline: pet.tutorId and pet.tutorName are present in loaded pet data", async () => {
    renderWithProviders(<PetDetail id={1} />);

    expect(await screen.findByRole("heading", { name: "Rex", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("João Silva").length).toBeGreaterThanOrEqual(1);
  });

  it("13. EVO-R35-002: renders Mensagem action pointing to /chat?tutor=101 for creche_admin", async () => {
    renderWithProviders(<PetDetail id={1} />);

    expect(await screen.findByRole("heading", { name: "Rex", level: 1 })).toBeInTheDocument();
    // Existing actions
    expect(screen.getAllByRole("button", { name: /QR Code/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /Editar Perfil/i }).length).toBeGreaterThanOrEqual(1);

    // Mensagem action rendered with accessible name, exact link href /chat?tutor=101, and no nested button
    const messageLinks = screen.getAllByRole("link", { name: /Mensagem/i });
    expect(messageLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of messageLinks) {
      expect(link).toHaveAttribute("href", "/chat?tutor=101");
      expect(link.querySelector("button")).toBeNull();
    }
  });

  it("14. EVO-R35-002: renders Mensagem action for staff role, but hides Mensagem for tutor role", async () => {
    // Test for staff
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 2, name: "Staff User", role: "staff", crecheId: 10 },
      isLoading: false,
    });

    const { unmount } = renderWithProviders(<PetDetail id={1} />);
    expect(await screen.findByRole("heading", { name: "Rex", level: 1 })).toBeInTheDocument();
    const staffLinks = screen.getAllByRole("link", { name: /Mensagem/i });
    expect(staffLinks.length).toBeGreaterThanOrEqual(1);
    expect(staffLinks[0]).toHaveAttribute("href", "/chat?tutor=101");
    unmount();

    // Test for tutor viewing own pet -> Mensagem must be HIDDEN
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 101, name: "João Silva", role: "tutor", crecheId: 10 },
      isLoading: false,
    });

    renderWithProviders(<PetDetail id={1} />);
    expect(await screen.findByRole("heading", { name: "Rex", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mensagem/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mensagem/i })).not.toBeInTheDocument();
  });

  it("15. EVO-R35-002: hides Mensagem action when pet has no tutorId", async () => {
    (apiClientModule.useGetPet as any).mockReturnValue({
      data: {
        id: 99,
        name: "SemTutorPet",
        species: "dog",
        breed: "SRD",
        gender: "male",
        tutorId: null,
        tutorName: null,
        status: "active",
      },
      isLoading: false,
    });

    renderWithProviders(<PetDetail id={99} />);

    expect(await screen.findByRole("heading", { name: "SemTutorPet", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("Sem tutor").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("link", { name: /Mensagem/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mensagem/i })).not.toBeInTheDocument();
  });

  it("16. EVO-R35-002: master_admin context rule — shows Mensagem with active creche context, hides Mensagem without creche context", async () => {
    // Positive case: master_admin with active creche context (crecheId: 10)
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 999, name: "Master Admin", role: "master_admin", crecheId: 10 },
      isLoading: false,
    });

    const { unmount } = renderWithProviders(<PetDetail id={1} />);
    expect(await screen.findByRole("heading", { name: "Rex", level: 1 })).toBeInTheDocument();
    const maLinks = screen.getAllByRole("link", { name: /Mensagem/i });
    expect(maLinks.length).toBeGreaterThanOrEqual(1);
    expect(maLinks[0]).toHaveAttribute("href", "/chat?tutor=101");
    unmount();

    // Negative case: master_admin without active creche context (crecheId: null) -> MUST HIDE
    (authModule.useAuth as any).mockReturnValue({
      user: { id: 999, name: "Master Admin", role: "master_admin", crecheId: null },
      isLoading: false,
    });

    renderWithProviders(<PetDetail id={1} />);
    expect(await screen.findByRole("heading", { name: "Rex", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Mensagem/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mensagem/i })).not.toBeInTheDocument();
  });
});
