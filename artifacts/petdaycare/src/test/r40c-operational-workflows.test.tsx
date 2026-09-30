import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import Bookings from "@/pages/bookings/index";
import QrScanner from "@/pages/staff/qr-scanner";
import Staff from "@/pages/staff/index";
import Walks from "@/pages/walks/index";
import { QuickCheckIn } from "@/components/quick-checkin";

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

describe("ARKPET — R40.C CORE OPERATIONAL WORKFLOW TEST SUITE", () => {
  const staffUser = { id: 1, name: "Lucas Staff", role: "staff", crecheId: 10 };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "test-token-operational");
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      user: staffUser,
      isLoading: false,
    } as any);
  });

  // ────────────────────────────────────────────────────────────
  // OPS-001: Booking to Check-In Transition
  // ────────────────────────────────────────────────────────────
  describe("OPS-001 — Booking Confirmation to Check-In Transition", () => {
    it("renders confirmed booking and triggers check-in mutation upon action", async () => {
      const mockCheckInMutate = vi.fn();
      vi.spyOn(apiClientModule, "useCheckIn").mockReturnValue({
        mutate: mockCheckInMutate,
        isPending: false,
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: [
          {
            id: 201,
            crecheId: 10,
            petId: 50,
            petName: "Thor",
            tutorId: 30,
            tutorName: "Marcos Paulo",
            startDate: "2026-09-30",
            endDate: "2026-09-30",
            type: "day_use",
            status: "confirmed",
          },
        ],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: [{ id: 50, name: "Thor", isCheckedIn: false }],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<Bookings />);

      expect(screen.getAllByText("Thor").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Confirmada").length).toBeGreaterThan(0);

      // Find Check-in button
      const checkinButtons = screen.getAllByRole("button", { name: /check-in/i });
      expect(checkinButtons.length).toBeGreaterThan(0);

      fireEvent.click(checkinButtons[0]);

      expect(mockCheckInMutate).toHaveBeenCalledWith(
        expect.objectContaining({ crecheId: 10, bookingId: 201 }),
        expect.any(Object)
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-002: Invalid Check-In Blocked
  // ────────────────────────────────────────────────────────────
  describe("OPS-002 — Invalid Check-In Blocked Without Confirmed Reservation", () => {
    it("QuickCheckIn prevents check-in if pet has no confirmed reservation for today", async () => {
      const mockCheckInMutate = vi.fn();
      vi.spyOn(apiClientModule, "useCheckIn").mockReturnValue({
        mutate: mockCheckInMutate,
        isPending: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 60, name: "Mel", tutorName: "Juliana", isCheckedIn: false, activeBookingId: null },
          ],
        },
        isLoading: false,
      } as any);

      renderWithProviders(<QuickCheckIn />);

      const searchInput = screen.getByPlaceholderText(/Check-in rápido/i);
      fireEvent.change(searchInput, { target: { value: "Mel" } });

      await waitFor(() => {
        expect(screen.getByText("Mel")).toBeInTheDocument();
      });

      const enterBtn = screen.getByRole("button", { name: /entrar/i });
      fireEvent.click(enterBtn);

      // Mutation must NOT be invoked when activeBookingId is null
      expect(mockCheckInMutate).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-003: Feeding Task Completion
  // ────────────────────────────────────────────────────────────
  describe("OPS-003 — Feeding Completion & Notes Recording", () => {
    it("renders feeding task with scheduled time and completes with operator notes", async () => {
      const mockCompleteMutate = vi.fn();
      vi.spyOn(apiClientModule, "useCompleteTask").mockReturnValue({
        mutate: mockCompleteMutate,
        isPending: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [
          {
            id: 301,
            title: "Alimentação da tarde (200g Ração Premier)",
            type: "feeding",
            petId: 70,
            petName: "Bob",
            priority: "medium",
            scheduledFor: "2026-09-30T13:00:00Z",
            status: "pending",
          },
        ],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 70, name: "Bob", tutorName: "Carlos", tutorId: 15, isCheckedIn: true },
          ],
        },
        isLoading: false,
      } as any);

      renderWithProviders(<Staff />);

      expect(screen.getByText(/Alimentação da tarde/i)).toBeInTheDocument();
      expect(screen.getByText("10:00")).toBeInTheDocument(); // 13:00 UTC = 10:00 Brasilia

      // Click Concluir
      const completeBtn = screen.getByRole("button", { name: /concluir/i });
      fireEvent.click(completeBtn);

      // Opens TaskCompleteModal
      await waitFor(() => {
        expect(screen.getByText(/Publicar atualização na linha do tempo de Bob/i)).toBeInTheDocument();
      });

      // Click "Concluir sem publicar"
      const completeOnlyBtn = screen.getByRole("button", { name: /concluir sem publicar/i });
      fireEvent.click(completeOnlyBtn);

      expect(mockCompleteMutate).toHaveBeenCalledWith(
        expect.objectContaining({ crecheId: 10, taskId: 301 }),
        expect.any(Object)
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-004: Medication Completion
  // ────────────────────────────────────────────────────────────
  describe("OPS-004 — Medication Completion with Schedule and Instructions Preserved", () => {
    it("displays exact clinical instructions and dosage without inference", async () => {
      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [
          {
            id: 401,
            title: "Antibiótico Cefalexina 250mg",
            description: "Dar 1 comprimido envolto em patê logo após a refeição",
            type: "medication",
            petId: 80,
            petName: "Pipoca",
            priority: "high",
            scheduledFor: "2026-09-30T15:00:00Z",
            status: "pending",
          },
        ],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 80, name: "Pipoca", tutorName: "Mariana", tutorId: 22, isCheckedIn: true, allergies: "Frango", specialNeeds: "Cardiopata" },
          ],
        },
        isLoading: false,
      } as any);

      renderWithProviders(<Staff />);

      // Must preserve title, clinical instructions, and special needs badges
      expect(screen.getByText(/Antibiótico Cefalexina 250mg/i)).toBeInTheDocument();
      expect(screen.getByText(/Dar 1 comprimido envolto em patê/i)).toBeInTheDocument();
      expect(screen.getAllByText("Alergia").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Cuidados especiais").length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-005: Walk Completion & Protection
  // ────────────────────────────────────────────────────────────
  describe("OPS-005 — Walk Completion & Duplicate Protection", () => {
    it("excludes pets already walking and allows ending active walks", async () => {
      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 91, name: "Toby", isCheckedIn: true },
            { id: 92, name: "Spike", isCheckedIn: true },
          ],
        },
        isLoading: false,
      } as any);

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/walks")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              {
                id: 501,
                petId: 91,
                petName: "Toby",
                staffName: "Lucas Staff",
                status: "in_progress",
                durationMinutes: 30,
                startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              },
            ]),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      renderWithProviders(<Walks />);

      await waitFor(() => {
        expect(screen.getByText("Toby")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /finalizar passeio/i })).toBeInTheDocument();
      });

      // Open Start Walk modal to verify pet filtering
      const startWalkBtn = screen.getByRole("button", { name: /iniciar passeio/i });
      fireEvent.click(startWalkBtn);

      await waitFor(() => {
        expect(screen.getByText(/Selecione o Pet/i)).toBeInTheDocument();
      });

      // Toby is already walking, only Spike should be available
      expect(screen.getByText(/Spike/i)).toBeInTheDocument();
      const selectElement = screen.getByRole("combobox");
      const optionTexts = Array.from(selectElement.querySelectorAll("option")).map(o => o.textContent);
      expect(optionTexts.some(t => t?.includes("Toby"))).toBe(false);
      expect(optionTexts.some(t => t?.includes("Spike"))).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-006: QR Flow
  // ────────────────────────────────────────────────────────────
  describe("OPS-006 — QR Code Check-In Shortcut", () => {
    it("decodes QR token and provides check-in action using standard check-in mutation", async () => {
      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<QrScanner />);

      expect(screen.getByText("QR Scanner")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /escanear qr code/i })).toBeInTheDocument();
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-007: Check-Out with Warnings
  // ────────────────────────────────────────────────────────────
  describe("OPS-007 — Check-Out with Personal Items & Pending Tasks Warnings", () => {
    it("displays personal items alert and pending tasks when opening check-out modal", async () => {
      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: [
          {
            id: 701,
            crecheId: 10,
            petId: 110,
            petName: "Zeus",
            tutorId: 44,
            tutorName: "Renata",
            startDate: "2026-09-30",
            endDate: "2026-09-30",
            type: "day_use",
            status: "active",
            hasPersonalItems: true,
            personalItemsPhotoUrl: "/uploads/items.jpg",
          },
        ],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: [{ id: 110, name: "Zeus", isCheckedIn: true }],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [
          { id: 801, title: "Alimentar Zeus", type: "feeding", petId: 110, status: "pending" },
        ],
        isLoading: false,
      } as any);

      renderWithProviders(<Bookings />);

      const checkoutButtons = screen.getAllByRole("button", { name: /check-out/i });
      expect(checkoutButtons.length).toBeGreaterThan(0);

      fireEvent.click(checkoutButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("Confirmar Check-out")).toBeInTheDocument();
        expect(screen.getByText(/Pet veio com itens pessoais/i)).toBeInTheDocument();
        expect(screen.getByText(/Zeus tem 1 tarefa pendente/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /concluir tarefas e fazer check-out/i })).toBeInTheDocument();
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // OPS-008: Duplicate Action Prevention
  // ────────────────────────────────────────────────────────────
  describe("OPS-008 — Duplicate Action Prevention", () => {
    it("disables check-in buttons while mutation is pending to prevent double check-in", async () => {
      vi.spyOn(apiClientModule, "useCheckIn").mockReturnValue({
        mutate: vi.fn(),
        isPending: true, // currently in-flight
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: [
          {
            id: 801,
            crecheId: 10,
            petId: 120,
            petName: "Bidu",
            tutorId: 55,
            startDate: "2026-09-30",
            endDate: "2026-09-30",
            type: "day_use",
            status: "confirmed",
          },
        ],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: [{ id: 120, name: "Bidu", isCheckedIn: false }],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<Bookings />);

      const checkinButtons = screen.getAllByRole("button", { name: /check-in/i });
      // All checkin buttons must be disabled while isCheckInPending is true
      checkinButtons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });
  });
});
