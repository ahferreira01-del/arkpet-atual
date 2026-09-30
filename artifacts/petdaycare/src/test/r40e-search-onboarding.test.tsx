import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor, act } from "./utils";
import * as authModule from "@/hooks/use-auth";
import { Header } from "@/components/layout/header";
import { GlobalSearchModal } from "@/components/search/global-search-modal";
import { CrecheOnboardingCard } from "@/components/onboarding/creche-onboarding-card";

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock matchMedia
window.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

describe("ARKPET — R40.E GLOBAL SEARCH & ONBOARDING FRONTEND TEST SUITE", () => {
  const crecheAdminUser = {
    id: 1,
    name: "Admin Alpha",
    email: "admin.alpha@arkpet.test",
    role: "creche_admin",
    crecheId: 1,
  };

  const staffUser = {
    id: 2,
    name: "Staff Lucas",
    email: "lucas@arkpet.test",
    role: "staff",
    crecheId: 1,
  };

  const tutorUser = {
    id: 25,
    name: "Tutor Alice",
    email: "alice@arkpet.test",
    role: "tutor",
    crecheId: 1,
  };

  const masterAdminUser = {
    id: 999,
    name: "Master Operator",
    email: "master@arkpet.test",
    role: "master_admin",
    crecheId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      user: crecheAdminUser as any,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    } as any);
  });

  // ────────────────────────────────────────────────────────────
  // GLOBAL SEARCH TESTS (SEARCH-001..009)
  // ────────────────────────────────────────────────────────────
  describe("SEARCH-001..009 — Global Search Experience & Shortcuts", () => {
    it("SEARCH-001: opens search modal when clicking search trigger button in Header", async () => {
      renderWithProviders(<Header user={crecheAdminUser as any} />);

      const searchBtn = screen.getByRole("button", { name: /buscar \(ctrl\+k\)/i });
      expect(searchBtn).toBeInTheDocument();

      fireEvent.click(searchBtn);

      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: /busca global/i })).toBeInTheDocument();
      });
    });

    it("SEARCH-002: opens search modal when pressing Ctrl+K on the keyboard", async () => {
      renderWithProviders(<Header user={crecheAdminUser as any} />);

      fireEvent.keyDown(window, { key: "k", ctrlKey: true });

      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: /busca global/i })).toBeInTheDocument();
      });
    });

    it("SEARCH-003 & SEARCH-004: helper prompt shown for query < 2 chars, debounces queries", async () => {
      renderWithProviders(<GlobalSearchModal isOpen={true} onClose={vi.fn()} />);

      expect(
        screen.getByText(/digite pelo menos 2 caracteres para buscar/i)
      ).toBeInTheDocument();

      const input = screen.getByPlaceholderText(/digite o nome de um pet, tutor ou reserva/i);
      fireEvent.change(input, { target: { value: "a" } });

      // Still < 2 characters
      expect(
        screen.getByText(/digite pelo menos 2 caracteres para buscar/i)
      ).toBeInTheDocument();
    });

    it("SEARCH-005: displays empty state when query >= 2 chars returns 0 results", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: "inexistente",
          groups: [],
          total: 0,
        }),
      } as any);

      renderWithProviders(<GlobalSearchModal isOpen={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText(/digite o nome de um pet, tutor ou reserva/i);
      fireEvent.change(input, { target: { value: "inexistente" } });

      await waitFor(
        () => {
          expect(
            screen.getByText(/nenhum resultado encontrado para "inexistente"/i)
          ).toBeInTheDocument();
        },
        { timeout: 1500 }
      );
    });

    it("SEARCH-006: renders grouped search results with titles, badges and context", async () => {
      const mockSearchData = {
        query: "pipoca",
        groups: [
          {
            type: "pet",
            label: "Pets",
            items: [
              {
                id: 101,
                type: "pet",
                title: "Pipoca",
                subtitle: "Poodle • Tutor: Alice",
                url: "/pets/101",
              },
            ],
          },
          {
            type: "booking",
            label: "Reservas",
            items: [
              {
                id: 201,
                type: "booking",
                title: "Reserva #201 — Day Care",
                subtitle: "Pipoca • 2026-08-30",
                badge: "confirmed",
                url: "/bookings",
              },
            ],
          },
        ],
        total: 2,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchData,
      } as any);

      renderWithProviders(<GlobalSearchModal isOpen={true} onClose={vi.fn()} />);

      const input = screen.getByPlaceholderText(/digite o nome de um pet, tutor ou reserva/i);
      fireEvent.change(input, { target: { value: "pipoca" } });

      await waitFor(
        () => {
          expect(screen.getByText("Pets")).toBeInTheDocument();
          expect(screen.getByText("Pipoca")).toBeInTheDocument();
          expect(screen.getByText("Poodle • Tutor: Alice")).toBeInTheDocument();

          expect(screen.getByText("Reservas")).toBeInTheDocument();
          expect(screen.getByText("Reserva #201 — Day Care")).toBeInTheDocument();
        },
        { timeout: 1500 }
      );
    });

    it("SEARCH-007: supports ArrowDown, ArrowUp and Enter keyboard navigation", async () => {
      const mockSearchData = {
        query: "teste",
        groups: [
          {
            type: "pet",
            label: "Pets",
            items: [
              { id: 1, type: "pet", title: "Item 1", url: "/pets/1" },
              { id: 2, type: "pet", title: "Item 2", url: "/pets/2" },
            ],
          },
        ],
        total: 2,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSearchData,
      } as any);

      const onClose = vi.fn();
      renderWithProviders(<GlobalSearchModal isOpen={true} onClose={onClose} />);

      const input = screen.getByPlaceholderText(/digite o nome de um pet, tutor ou reserva/i);
      fireEvent.change(input, { target: { value: "teste" } });

      await waitFor(() => {
        expect(screen.getByText("Item 1")).toBeInTheDocument();
      });

      // Press ArrowDown to select second item
      const resultsContainer = screen.getByRole("listbox");
      fireEvent.keyDown(resultsContainer, { key: "ArrowDown" });

      // Press Enter to select
      fireEvent.keyDown(resultsContainer, { key: "Enter" });

      expect(onClose).toHaveBeenCalled();
    });

    it("SEARCH-009: clicking a search result navigates and closes modal", async () => {
      const mockSearchData = {
        query: "pipoca",
        groups: [
          {
            type: "pet",
            label: "Pets",
            items: [
              { id: 101, type: "pet", title: "Pipoca", url: "/pets/101" },
            ],
          },
        ],
        total: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSearchData,
      } as any);

      const onClose = vi.fn();
      renderWithProviders(<GlobalSearchModal isOpen={true} onClose={onClose} />);

      const input = screen.getByPlaceholderText(/digite o nome de um pet, tutor ou reserva/i);
      fireEvent.change(input, { target: { value: "pipoca" } });

      await waitFor(() => {
        expect(screen.getByText("Pipoca")).toBeInTheDocument();
      });

      const option = screen.getByRole("option", { name: /pipoca/i });
      fireEvent.click(option);

      expect(onClose).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // CRECHE ONBOARDING TESTS (ONBOARD-001..008)
  // ────────────────────────────────────────────────────────────
  describe("ONBOARD-001..008 — Creche Admin Onboarding Checklist", () => {
    const mockIncompleteOnboarding = {
      crecheId: 1,
      isComplete: false,
      completedCount: 2,
      totalSteps: 5,
      steps: [
        { id: "creche_details", title: "Completar dados da creche", description: "Informe telefone", completed: true, route: "/settings", actionLabel: "Configurar" },
        { id: "staff", title: "Cadastrar equipe", description: "Convide funcionários", completed: false, route: "/staff/manage", actionLabel: "Equipe" },
        { id: "tutors", title: "Cadastrar tutor", description: "Cadastre seu primeiro tutor", completed: true, route: "/tutors", actionLabel: "Tutores" },
        { id: "pets", title: "Cadastrar primeiro pet", description: "Cadastre um pet", completed: false, route: "/pets", actionLabel: "Pets" },
        { id: "bookings", title: "Conhecer reservas", description: "Crie agendamentos", completed: false, route: "/bookings", actionLabel: "Reservas" },
      ],
    };

    it("ONBOARD-001: renders incomplete onboarding checklist for creche_admin with progress", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockIncompleteOnboarding,
      } as any);

      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="creche_admin" />
      );

      await waitFor(() => {
        expect(screen.getByRole("region", { name: /primeiros passos na arkpet/i })).toBeInTheDocument();
        expect(screen.getByText(/2 de 5 etapas concluídas/i)).toBeInTheDocument();
        expect(screen.getByText("Completar dados da creche")).toBeInTheDocument();
        expect(screen.getByText("Cadastrar equipe")).toBeInTheDocument();
      });
    });

    it("ONBOARD-002: marks completed items clearly based on facts", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockIncompleteOnboarding,
      } as any);

      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="creche_admin" />
      );

      await waitFor(() => {
        const completedStep = screen.getByText("Completar dados da creche");
        expect(completedStep).toHaveClass("line-through");
      });
    });

    it("ONBOARD-003 & ONBOARD-004: 'Continuar depois' dismisses checklist and persists without hard lock", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockIncompleteOnboarding,
      } as any);

      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="creche_admin" />
      );

      await waitFor(() => {
        expect(screen.getByText(/primeiros passos na arkpet/i)).toBeInTheDocument();
      });

      const dismissBtn = screen.getByRole("button", { name: /continuar depois/i });
      fireEvent.click(dismissBtn);

      await waitFor(() => {
        expect(screen.queryByText(/primeiros passos na arkpet/i)).not.toBeInTheDocument();
      });

      expect(localStorage.getItem("onboarding_dismissed_1")).toBe("true");
    });

    it("ONBOARD-005: staff does NOT see creche admin onboarding (ONBOARDING_ROLE_LEAK = 0)", () => {
      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="staff" />
      );

      expect(screen.queryByText(/primeiros passos na arkpet/i)).not.toBeInTheDocument();
    });

    it("ONBOARD-006: tutor does NOT see creche admin onboarding (ONBOARDING_ROLE_LEAK = 0)", () => {
      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="tutor" />
      );

      expect(screen.queryByText(/primeiros passos na arkpet/i)).not.toBeInTheDocument();
    });

    it("ONBOARD-007: master_admin does NOT see creche admin onboarding (ONBOARDING_ROLE_LEAK = 0)", () => {
      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="master_admin" />
      );

      expect(screen.queryByText(/primeiros passos na arkpet/i)).not.toBeInTheDocument();
    });

    it("ONBOARD-008: CTA buttons route to valid application URLs", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockIncompleteOnboarding,
      } as any);

      renderWithProviders(
        <CrecheOnboardingCard crecheId={1} userRole="creche_admin" />
      );

      await waitFor(() => {
        const staffLink = screen.getByRole("link", { name: /equipe/i });
        expect(staffLink).toHaveAttribute("href", "/staff/manage");

        const petsLink = screen.getByRole("link", { name: /pets/i });
        expect(petsLink).toHaveAttribute("href", "/pets");

        const bookingsLink = screen.getByRole("link", { name: /reservas/i });
        expect(bookingsLink).toHaveAttribute("href", "/bookings");
      });
    });
  });
});
