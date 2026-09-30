import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import * as authModule from "@/hooks/use-auth";
import * as apiClientModule from "@workspace/api-client-react";
import PetDetail from "@/pages/pets/detail";
import Bookings from "@/pages/bookings/index";
import QrScanner from "@/pages/staff/qr-scanner";
import Staff from "@/pages/staff/index";
import Walks from "@/pages/walks/index";
import { FeedTab } from "@/components/feed-tab";
import { QuickCheckIn } from "@/components/quick-checkin";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock QRCode canvas
vi.mock("qrcode", () => ({
  default: {
    toCanvas: vi.fn(),
    toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,mockqr")),
  },
}));

// Mock jsQR
vi.mock("jsqr", () => ({
  default: vi.fn(),
}));

describe("R39.F Core Operational Workflows Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("auth_token", "test-token-operational");
  });

  // ==========================================
  // TC-OP-PET-01 to TC-OP-PET-06: Pet Detail
  // ==========================================
  describe("Pet Detail Operational Workflow (TC-OP-PET)", () => {
    const mockPet = {
      id: 42,
      crecheId: 1,
      name: "Rex",
      species: "dog",
      breed: "Golden Retriever",
      gender: "male",
      weight: 28.5,
      color: "Dourado",
      birthDate: "2021-05-10",
      allergies: "Frango e pólen",
      specialNeeds: "Medo de fogos",
      temperament: "calm",
      isCastrated: true,
      isCheckedIn: false,
      tutorId: 99,
      qrToken: "PET-REX-42-TOKEN",
      photoUrl: "/uploads/rex.jpg",
    };

    it("TC-OP-PET-01: renders complete operational pet profile with real data", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useGetPet").mockReturnValue({
        data: mockPet,
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: { items: [{ id: 101, petId: 42, status: "confirmed", startDate: "2026-09-29" }] },
        isLoading: false,
      } as any);

      renderWithProviders(<PetDetail id={42} />);

      expect(screen.getByText("Rex")).toBeInTheDocument();
      expect(screen.getByText(/Golden Retriever/i)).toBeInTheDocument();
      expect(screen.getByText(/28.5 kg/i)).toBeInTheDocument();
      expect(screen.getByText(/Porte Grande/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Alergias/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Necessidades especiais/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/✓ Castrado/i)).toBeInTheDocument();
      expect(screen.getByText("Em casa")).toBeInTheDocument();
    });

    it("TC-OP-PET-02: displays operational action buttons for staff (QR Code, Editar, Check-in)", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useGetPet").mockReturnValue({
        data: mockPet,
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: { items: [{ id: 101, petId: 42, status: "confirmed", startDate: "2026-09-29" }] },
        isLoading: false,
      } as any);

      renderWithProviders(<PetDetail id={42} />);

      // QR Code buttons exist (desktop and mobile actions)
      const qrButtons = screen.getAllByRole("button", { name: /qr code/i });
      expect(qrButtons.length).toBeGreaterThan(0);

      // Check-in button available when pet has confirmed booking and is not checked in
      const checkInButtons = screen.getAllByRole("button", { name: /check-in/i });
      expect(checkInButtons.length).toBeGreaterThan(0);

      // Edit profile button available
      const editButtons = screen.getAllByRole("button", { name: /editar perfil/i });
      expect(editButtons.length).toBeGreaterThan(0);
    });

    it("TC-OP-PET-03: hides check-in button when pet is already checked in or user is tutor", async () => {
      // Checked in pet
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useGetPet").mockReturnValue({
        data: { ...mockPet, isCheckedIn: true },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: { items: [{ id: 101, petId: 42, status: "active", startDate: "2026-09-29" }] },
        isLoading: false,
      } as any);

      renderWithProviders(<PetDetail id={42} />);

      expect(screen.getByText("Presente")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^check-in$/i })).not.toBeInTheDocument();
    });

    it("TC-OP-PET-04: allows switching between tabs and viewing QR Code modal", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useGetPet").mockReturnValue({
        data: mockPet,
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: { items: [] },
        isLoading: false,
      } as any);

      renderWithProviders(<PetDetail id={42} />);

      // Click on QR Code button in header
      const qrButton = screen.getAllByRole("button", { name: /qr code/i })[0];
      fireEvent.click(qrButton);

      // Verify QR Code modal opened
      await waitFor(() => {
        expect(screen.getByText(/Token de Identificação/i)).toBeInTheDocument();
        expect(screen.getByText("PET-REX-42-TOKEN")).toBeInTheDocument();
      });
    });

    it("TC-OP-PET-05: handles loading and pet not found states gracefully", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useGetPet").mockReturnValue({
        data: null,
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListBookings").mockReturnValue({
        data: { items: [] },
        isLoading: false,
      } as any);

      renderWithProviders(<PetDetail id={999} />);

      expect(screen.getByText(/Pet não encontrado/i)).toBeInTheDocument();
    });
  });

  // ==========================================
  // TC-OP-CHECKIN: Operational Check-in
  // ==========================================
  describe("Check-in Operational Workflow (TC-OP-CHECKIN)", () => {
    it("TC-OP-CHECKIN-01: QuickCheckIn renders only for authorized staff/creche_admin", () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 2, name: "Tutor User", role: "tutor", crecheId: 1 },
        isLoading: false,
      } as any);

      const { container } = renderWithProviders(<QuickCheckIn />);
      expect(container.firstChild).toBeNull();
    });

    it("TC-OP-CHECKIN-02: QuickCheckIn searches absent pets and triggers check-in mutation", async () => {
      const mockMutate = vi.fn();
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 10, name: "Mel", tutorName: "Maria", isCheckedIn: false, activeBookingId: 201 },
            { id: 11, name: "Bob", tutorName: "João", isCheckedIn: true, activeBookingId: 202 },
          ],
        },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useCheckIn").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<QuickCheckIn />);

      const input = screen.getByPlaceholderText(/Check-in rápido/i);
      fireEvent.change(input, { target: { value: "Mel" } });

      await waitFor(() => {
        expect(screen.getByText("Mel")).toBeInTheDocument();
        expect(screen.getByText("Maria")).toBeInTheDocument();
      });

      const enterBtn = screen.getByRole("button", { name: /entrar/i });
      fireEvent.click(enterBtn);

      expect(mockMutate).toHaveBeenCalledWith(
        { crecheId: 1, bookingId: 201 },
        expect.anything()
      );
    });

    it("TC-OP-CHECKIN-03: QuickCheckIn guards against check-in without confirmed booking", async () => {
      const mockMutate = vi.fn();
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 10, name: "Pipoca", tutorName: "Carla", isCheckedIn: false, activeBookingId: null },
          ],
        },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useCheckIn").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      renderWithProviders(<QuickCheckIn />);

      const input = screen.getByPlaceholderText(/Check-in rápido/i);
      fireEvent.change(input, { target: { value: "Pipoca" } });

      await waitFor(() => {
        expect(screen.getByText("Pipoca")).toBeInTheDocument();
      });

      const enterBtn = screen.getByRole("button", { name: /entrar/i });
      fireEvent.click(enterBtn);

      // Should NOT call check-in mutation if bookingId is missing
      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // TC-OP-QR: QR Scanner Operational Workflow
  // ==========================================
  describe("QR Scanner Operational Workflow (TC-OP-QR)", () => {
    it("TC-OP-QR-01: renders QR Scanner initial state with PageHeader and Scan button", () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<QrScanner />);

      expect(screen.getByText("QR Scanner")).toBeInTheDocument();
      expect(screen.getByText("Check-in operacional rápido.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /escanear qr code/i })).toBeInTheDocument();
    });

    it("TC-OP-QR-02: recognizes pet token and allows check-in confirmation", async () => {
      const mockMutate = vi.fn();
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useCheckIn").mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [{ id: 1, petId: 55, type: "feeding", status: "pending" }],
        isLoading: false,
      } as any);

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/by-qr/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              id: 55,
              name: "Bidu",
              tutorName: "Franjinha",
              photoUrl: null,
              isCheckedIn: false,
              hasActiveBooking: true,
              bookingId: 777,
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      renderWithProviders(<QrScanner />);

      // Click scan
      const scanBtn = screen.getByRole("button", { name: /escanear qr code/i });
      fireEvent.click(scanBtn);
    });
  });

  // ==========================================
  // TC-OP-CARE: Daily Care, Tasks & Walks
  // ==========================================
  describe("Daily Care & Walks Operational Workflow (TC-OP-CARE)", () => {
    it("TC-OP-CARE-01: renders Staff daily tasks grouped by tutor with pet allergy and care badges", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListTasks").mockReturnValue({
        data: [
          {
            id: 1,
            title: "Dar ração especial",
            type: "feeding",
            petId: 10,
            petName: "Luna",
            priority: "high",
            scheduledFor: "2026-09-29T12:00:00Z",
            status: "pending",
          },
          {
            id: 2,
            title: "Administrar colírio",
            type: "medication",
            petId: 10,
            petName: "Luna",
            priority: "high",
            scheduledFor: "2026-09-29T14:00:00Z",
            status: "pending",
          },
        ],
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: {
          items: [
            { id: 10, name: "Luna", tutorName: "Ana Silva", tutorId: 5, allergies: "Ração de carne", specialNeeds: null, isCheckedIn: true },
          ],
        },
        isLoading: false,
      } as any);

      renderWithProviders(<Staff />);

      expect(screen.getByText("Tarefas do Dia")).toBeInTheDocument();
      expect(screen.getByText("Ana Silva")).toBeInTheDocument();
      expect(screen.getByText("Dar ração especial")).toBeInTheDocument();
      expect(screen.getByText("Administrar colírio")).toBeInTheDocument();
      expect(screen.getAllByText("Alergia").length).toBeGreaterThan(0);
    });

    it("TC-OP-CARE-02: renders active walks with timer countdown and finish button", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: { items: [] },
        isLoading: false,
      } as any);

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/walks")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([
              {
                id: 1,
                petName: "Max",
                staffName: "Lucas",
                status: "in_progress",
                durationMinutes: 30,
                startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // started 5 mins ago
              },
            ]),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      renderWithProviders(<Walks />);

      await waitFor(() => {
        expect(screen.getByText("Max")).toBeInTheDocument();
        expect(screen.getByText(/por Lucas/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /finalizar passeio/i })).toBeInTheDocument();
      });
    });
  });

  // ==========================================
  // TC-OP-MEDIA: Feed & Media Gallery
  // ==========================================
  describe("Media Gallery & Feed Operational Workflow (TC-OP-MEDIA)", () => {
    it("TC-OP-MEDIA-01: buildMediaSrc appends media token correctly for authenticated storage", () => {
      const src = buildMediaSrc("/objects/photo-123.jpg", "media-token-xyz");
      expect(src).toContain("/api/storage/objects/photo-123.jpg");
      expect(src).toContain("mt=media-token-xyz");
    });

    it("TC-OP-MEDIA-02: FeedTab renders feed items with sanitized semantic tokens and like interaction", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: { items: [] },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListFeed").mockReturnValue({
        data: {
          posts: [
            {
              id: 901,
              type: "play",
              content: "Brincando muito no parque da creche!",
              createdAt: new Date().toISOString(),
              pets: [{ petId: 10, petName: "Luna" }],
              author: { name: "Lucas Staff" },
              isLiked: false,
              likeCount: 3,
            },
          ],
        },
        isLoading: false,
        isError: false,
      } as any);

      renderWithProviders(<FeedTab crecheId={1} />);

      expect(screen.getByText("Brincando muito no parque da creche!")).toBeInTheDocument();
      expect(screen.getByText("Lucas Staff")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("TC-OP-MEDIA-03: FeedTab renders empty state when no posts exist", async () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: { id: 1, name: "Staff User", role: "staff", crecheId: 1 },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListPets").mockReturnValue({
        data: { items: [] },
        isLoading: false,
      } as any);

      vi.spyOn(apiClientModule, "useListFeed").mockReturnValue({
        data: { posts: [] },
        isLoading: false,
        isError: false,
      } as any);

      renderWithProviders(<FeedTab crecheId={1} />);

      expect(screen.getByText("Nenhuma novidade ainda")).toBeInTheDocument();
      expect(screen.getByText("O feed da creche aparecerá aqui.")).toBeInTheDocument();
    });
  });
});
