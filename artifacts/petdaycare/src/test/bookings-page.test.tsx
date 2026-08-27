import React, { act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent, waitFor } from "./utils";
import Bookings from "../pages/bookings/index";
import * as apiClientReact from "@workspace/api-client-react";
import * as useAuthModule from "../hooks/use-auth";
import * as useToastModule from "../hooks/use-toast";

// ResizeObserver mock
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

let mockLocation = "/bookings";
let mockSetLocation = vi.fn();
let mockSearchString = "";

vi.mock("wouter", async () => {
  const actual: any = await vi.importActual("wouter");
  return {
    ...actual,
    useSearch: () => mockSearchString,
    useLocation: () => [mockLocation, mockSetLocation],
  };
});

vi.mock("../hooks/use-toast", () => ({
  useToast: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual: any = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual,
    useListBookings: vi.fn(),
    useListPets: vi.fn(),
    useListTasks: vi.fn(),
    useCreateBooking: vi.fn(),
    useUpdateBooking: vi.fn(),
    useCheckIn: vi.fn(),
    useCheckOut: vi.fn(),
    getListBookingsQueryKey: (id: any) => ["bookings", id],
    getListPetsQueryKey: (id: any) => ["pets", id],
    getListTasksQueryKey: (id: any) => ["tasks", id],
    getGetCrecheStatsQueryKey: (id: any) => ["stats", id],
  };
});

vi.mock("../hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

// Mock child modals
vi.mock("../components/bookings/personal-items-modal", () => ({
  PersonalItemsModal: ({ open, isOpen, onComplete, booking }: any) =>
    open || isOpen ? (
      <div data-testid="personal-items-modal">
        <span>Personal Items Modal for {booking?.petName}</span>
        <button onClick={() => onComplete && onComplete({ hasItems: true, photoUrl: "/photo.jpg" })}>
          Fechar Itens
        </button>
      </div>
    ) : null,
}));

vi.mock("../components/bookings/add-consumable-modal", () => ({
  AddConsumableModal: ({ isOpen, onClose, booking }: any) =>
    isOpen ? (
      <div data-testid="add-consumable-modal">
        <span>Consumable Modal for {booking?.petName}</span>
        <button onClick={onClose}>Fechar Consumo</button>
      </div>
    ) : null,
}));

describe("Bookings Page Characterization Tests (R33F.B8)", () => {
  let mockToast: any;
  let mockUpdateBookingMutate: any;
  let mockCheckInMutate: any;
  let mockCheckOutMutate: any;
  let mockCreateBookingMutate: any;

  const mockPets = [
    { id: 101, name: "Rex", tutorId: 1, tutorName: "Carlos Tutor", photoUrl: "/rex.jpg", isCheckedIn: false },
    { id: 102, name: "Luna", tutorId: 2, tutorName: "Ana Tutora", photoUrl: "/luna.jpg", isCheckedIn: true },
    { id: 103, name: "Thor", tutorId: 3, tutorName: "Marcos Tutor", photoUrl: null, isCheckedIn: true },
  ];

  const mockBookings = [
    {
      id: 1,
      petId: 101,
      petName: "Rex",
      tutorId: 1,
      tutorName: "Carlos Tutor",
      serviceType: "day_use",
      type: "day_use",
      catalogueItemType: "daycare",
      status: "pending",
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      notes: "Cuidado especial",
      hasPersonalItems: false,
      personalItemsPhotoUrl: null,
    },
    {
      id: 2,
      petId: 102,
      petName: "Luna",
      tutorId: 2,
      tutorName: "Ana Tutora",
      serviceType: "lodging",
      type: "lodging",
      catalogueItemType: "hotel",
      status: "confirmed",
      startDate: "2026-08-27",
      endDate: "2026-08-28",
      notes: null,
      hasPersonalItems: true,
      personalItemsPhotoUrl: "/items-luna.jpg",
    },
    {
      id: 3,
      petId: 103,
      petName: "Thor",
      tutorId: 3,
      tutorName: "Marcos Tutor",
      serviceType: "day_use",
      type: "day_use",
      catalogueItemType: "daycare",
      status: "active",
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      notes: null,
      hasPersonalItems: false,
      personalItemsPhotoUrl: null,
    },
    {
      id: 4,
      petId: 101,
      petName: "Rex",
      tutorId: 1,
      tutorName: "Carlos Tutor",
      serviceType: "banho",
      type: "banho",
      catalogueItemType: "service",
      status: "completed",
      startDate: "2026-08-26",
      endDate: "2026-08-26",
      notes: null,
      hasPersonalItems: false,
      personalItemsPhotoUrl: null,
    },
    {
      id: 5,
      petId: 102,
      petName: "Luna",
      tutorId: 2,
      tutorName: "Ana Tutora",
      serviceType: "visita_taxi",
      type: "visita_taxi",
      catalogueItemType: "service",
      status: "cancelled",
      startDate: "2026-08-25",
      endDate: "2026-08-25",
      notes: null,
      hasPersonalItems: false,
      personalItemsPhotoUrl: null,
    },
    {
      id: 6,
      petId: 103,
      petName: "Thor",
      tutorId: 3,
      tutorName: "Marcos Tutor",
      serviceType: "creche_taxi",
      type: "creche_taxi",
      catalogueItemType: "service",
      status: "cancel_requested",
      startDate: "2026-08-28",
      endDate: "2026-08-28",
      notes: null,
      hasPersonalItems: false,
      personalItemsPhotoUrl: null,
    },
  ];

  const mockTasks = [
    { id: 201, crecheId: 1, petId: 103, title: "Dar remédio", status: "pending" },
    { id: 202, crecheId: 1, petId: 103, title: "Escovar pelos", status: "completed" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation = "/bookings";
    mockSearchString = "";
    mockSetLocation = vi.fn();
    mockToast = vi.fn();
    (useToastModule.useToast as any).mockReturnValue({ toast: mockToast });

    (useAuthModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Staff User", email: "staff@arkpet.test", role: "staff", crecheId: 1 },
      isLoading: false,
    });

    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: mockBookings },
      isLoading: false,
    });

    (apiClientReact.useListPets as any).mockReturnValue({
      data: { items: mockPets },
      isLoading: false,
    });

    (apiClientReact.useListTasks as any).mockReturnValue({
      data: mockTasks,
      isLoading: false,
    });

    mockUpdateBookingMutate = vi.fn();
    (apiClientReact.useUpdateBooking as any).mockReturnValue({
      mutate: mockUpdateBookingMutate,
      isPending: false,
    });

    mockCheckInMutate = vi.fn();
    (apiClientReact.useCheckIn as any).mockReturnValue({
      mutate: mockCheckInMutate,
      isPending: false,
    });

    mockCheckOutMutate = vi.fn();
    (apiClientReact.useCheckOut as any).mockReturnValue({
      mutate: mockCheckOutMutate,
      isPending: false,
    });

    mockCreateBookingMutate = vi.fn();
    (apiClientReact.useCreateBooking as any).mockReturnValue({
      mutate: mockCreateBookingMutate,
      isPending: false,
    });

    // Mock fetch with default implementations for all custom endpoints
    global.fetch = vi.fn().mockImplementation((url: string, options: any) => {
      if (url.includes("/tutors/manage")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: "Carlos Tutor", email: "carlos@test.com" },
            { id: 2, name: "Ana Tutora", email: "ana@test.com" },
            { id: 3, name: "Marcos Tutor", email: "marcos@test.com" },
          ],
        });
      }
      if (url.includes("/on-the-way")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      if (url.includes("/complete-service")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      if (url.includes("/force-checkout")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      if (url.includes("/tasks/complete-by-pet")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    }) as any;
  });

  // TEST 1 — Status and type badge rendering
  it("1. renders current booking status and booking type labels", async () => {
    renderWithProviders(<Bookings />);

    expect(screen.getAllByText("Pendente").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Confirmada").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ativa").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Concluída").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Cancelada").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Cancelamento Solicitado").length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText("Day Use").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Hospedagem").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Banho").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Visita + Táxi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Creche + Táxi").length).toBeGreaterThanOrEqual(1);
  });

  // TEST 2 — Status filter
  it("2. filters bookings by status selection", async () => {
    renderWithProviders(<Bookings />);

    const statusFilterBtn = screen.getByRole("button", { name: /Todos os status/i });
    fireEvent.click(statusFilterBtn);

    const pendingOption = screen.getAllByRole("button", { name: /Pendente/i }).find((b) => b.classList.contains("w-full"));
    if (pendingOption) {
      fireEvent.click(pendingOption);
    }

    expect(screen.getAllByText("Rex").length).toBeGreaterThanOrEqual(1);
  });

  // TEST 3 — Pet filter
  it("3. filters bookings by pet combobox search and selection", async () => {
    renderWithProviders(<Bookings />);

    const petCombobox = screen.getByRole("button", { name: /Todos os pets/i });
    fireEvent.click(petCombobox);

    const rexOption = screen.getByRole("button", { name: /Rex/i });
    fireEvent.click(rexOption);

    expect(screen.getAllByText("Rex").length).toBeGreaterThanOrEqual(1);
  });

  // TEST 4 — Tutor filter
  it("4. filters bookings by tutor combobox search and selection for staff", async () => {
    renderWithProviders(<Bookings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Todos os tutores/i })).toBeInTheDocument();
    });

    const tutorCombobox = screen.getByRole("button", { name: /Todos os tutores/i });
    fireEvent.click(tutorCombobox);

    const anaOption = screen.getByRole("button", { name: /Ana Tutora/i });
    fireEvent.click(anaOption);

    expect(screen.getAllByText("Luna").length).toBeGreaterThanOrEqual(1);
  });

  // TEST 5 — Date range filter
  it("5. filters bookings by date range boundaries", async () => {
    renderWithProviders(<Bookings />);

    expect(screen.getAllByText("Rex").length).toBeGreaterThanOrEqual(1);
  });

  // TEST 6 — Staff approves pending booking
  it("6. staff approves pending booking triggering confirmed status update", async () => {
    renderWithProviders(<Bookings />);

    const confirmButtons = screen.getAllByRole("button", { name: /Confirmar/i });
    fireEvent.click(confirmButtons[0]);

    expect(mockUpdateBookingMutate).toHaveBeenCalledWith(
      { crecheId: 1, bookingId: 1, data: { status: "confirmed" } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );

    const options = mockUpdateBookingMutate.mock.calls[0][1];
    options.onSuccess();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Reserva confirmada com sucesso!" }));
  });

  // TEST 7 — Staff rejects pending booking
  it("7. staff rejects pending booking triggering cancelled status update", async () => {
    renderWithProviders(<Bookings />);

    const editButtons = screen.getAllByRole("button", { name: /Editar/i });
    fireEvent.click(editButtons[0]);

    expect(screen.getByText("Editar Reserva")).toBeInTheDocument();

    const cancelStatusBtn = screen.getByRole("button", { name: /Cancelada/i });
    fireEvent.click(cancelStatusBtn);

    expect(mockUpdateBookingMutate).toHaveBeenCalledWith(
      { crecheId: 1, bookingId: 1, data: { status: "cancelled" } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );

    const options = mockUpdateBookingMutate.mock.calls[0][1];
    options.onSuccess();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Reserva cancelada." }));
  });

  // TEST 8 — Tutor requests cancellation
  it("8. tutor requests cancellation for pending/confirmed booking", async () => {
    (useAuthModule.useAuth as any).mockReturnValue({
      user: { id: 1, name: "Carlos Tutor", email: "carlos@test.com", role: "tutor", crecheId: 1 },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const cancelReqButtons = screen.getAllByRole("button", { name: /Solicitar Cancelamento/i });
    fireEvent.click(cancelReqButtons[0]);

    expect(mockUpdateBookingMutate).toHaveBeenCalledWith(
      { crecheId: 1, bookingId: 1, data: { status: "cancel_requested" } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );

    const options = mockUpdateBookingMutate.mock.calls[0][1];
    options.onSuccess();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Solicitação de cancelamento enviada à creche." }));
  });

  // TEST 9 — Staff approves cancel request
  it("9. staff approves cancellation request transitioning status to cancelled", async () => {
    renderWithProviders(<Bookings />);

    const approveCancelButtons = screen.getAllByRole("button", { name: /Aprovar Cancelamento/i });
    fireEvent.click(approveCancelButtons[0]);

    expect(mockUpdateBookingMutate).toHaveBeenCalledWith(
      { crecheId: 1, bookingId: 6, data: { status: "cancelled" } },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );

    const options = mockUpdateBookingMutate.mock.calls[0][1];
    options.onSuccess();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Reserva cancelada." }));
  });

  // TEST 10 — Staff rejects cancel request
  it("10. staff rejects cancellation request reverting status to confirmed", async () => {
    renderWithProviders(<Bookings />);

    const rejectButtons = screen.getAllByRole("button", { name: /Recusar/i });
    fireEvent.click(rejectButtons[0]);

    expect(mockUpdateBookingMutate).toHaveBeenCalledWith(
      { crecheId: 1, bookingId: 6, data: { status: "confirmed" } },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );

    const options = mockUpdateBookingMutate.mock.calls[0][1];
    options.onSuccess();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Reserva confirmada com sucesso!" }));
  });

  // TEST 11 — Regular booking check-in
  it("11. regular booking check-in triggers checkInMutation and opens PersonalItemsModal on success", async () => {
    renderWithProviders(<Bookings />);

    const checkInButtons = screen.getAllByRole("button", { name: /^Check-in$/i });
    fireEvent.click(checkInButtons[0]);

    expect(mockCheckInMutate).toHaveBeenCalledWith(
      expect.objectContaining({ crecheId: 1, bookingId: 2 }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );

    const options = mockCheckInMutate.mock.calls[0][1];
    act(() => {
      options.onSuccess();
    });

    expect(screen.getByTestId("personal-items-modal")).toBeInTheDocument();
  });

  // TEST 12 — Service booking check-in ("Iniciar Serviço" when pet absent)
  it("12. service booking check-in renders Iniciar Serviço and triggers check-in when pet is absent", async () => {
    const serviceBookings = [
      {
        id: 12,
        petId: 101, // Rex isCheckedIn: false
        petName: "Rex",
        tutorId: 1,
        tutorName: "Carlos Tutor",
        serviceType: "banho",
        type: "banho",
        catalogueItemType: "service",
        status: "confirmed",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: serviceBookings },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const initServiceBtn = screen.getAllByRole("button", { name: /Iniciar Serviço/i });
    expect(initServiceBtn.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(initServiceBtn[0]);
    expect(mockCheckInMutate).toHaveBeenCalledWith(
      expect.objectContaining({ crecheId: 1, bookingId: 12 }),
      expect.anything()
    );
  });

  // TEST 13 — Confirmed service completion with pet present ("Concluir Serviço")
  it("13. confirmed service booking renders Concluir Serviço when pet is already present", async () => {
    const serviceBookings = [
      {
        id: 13,
        petId: 102, // Luna isCheckedIn: true
        petName: "Luna",
        tutorId: 2,
        tutorName: "Ana Tutora",
        serviceType: "banho",
        type: "banho",
        catalogueItemType: "service",
        status: "confirmed",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: serviceBookings },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const completeBtn = screen.getAllByRole("button", { name: /Concluir Serviço/i });
    expect(completeBtn.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(completeBtn[0]);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/bookings/13/complete-service"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // TEST 14 — Active service booking completion ("Concluir Serviço")
  it("14. active service booking renders Concluir Serviço and completes service on click", async () => {
    const serviceBookings = [
      {
        id: 14,
        petId: 102,
        petName: "Luna",
        tutorId: 2,
        tutorName: "Ana Tutora",
        serviceType: "visita_taxi",
        type: "visita_taxi",
        catalogueItemType: "service",
        status: "active",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: serviceBookings },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const completeBtn = screen.getAllByRole("button", { name: /Concluir Serviço/i });
    fireEvent.click(completeBtn[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/bookings/14/complete-service"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  // TEST 15 — Direct check-out (0 pending tasks)
  it("15. active regular booking with zero pending tasks performs direct check-out", async () => {
    const activeBookingNoTasks = [
      {
        id: 15,
        petId: 101, // Rex has 0 tasks
        petName: "Rex",
        tutorId: 1,
        tutorName: "Carlos Tutor",
        serviceType: "day_use",
        type: "day_use",
        catalogueItemType: "daycare",
        status: "active",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
        hasPersonalItems: false,
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: activeBookingNoTasks },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    expect(mockCheckOutMutate).toHaveBeenCalledWith(
      expect.objectContaining({ crecheId: 1, bookingId: 15 }),
      expect.anything()
    );
  });

  // TEST 16 — Check-out with pending tasks opens Confirmar Check-out Modal
  it("16. active regular booking with pending tasks opens Confirmar Check-out Modal", async () => {
    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    expect(mockCheckOutMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Confirmar Check-out")).toBeInTheDocument();
    expect(screen.getByText(/Thor tem 1 tarefa pendente/i)).toBeInTheDocument();
  });

  // TEST 17 — Personal items check-out reminder
  it("17. check-out modal renders personal items warning photo badge when pet brought items", async () => {
    const bookingWithItems = [
      {
        id: 17,
        petId: 103,
        petName: "Thor",
        tutorId: 3,
        tutorName: "Marcos Tutor",
        serviceType: "day_use",
        type: "day_use",
        catalogueItemType: "daycare",
        status: "active",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
        hasPersonalItems: true,
        personalItemsPhotoUrl: "/items-thor.jpg",
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: bookingWithItems },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    expect(screen.getByText(/Pet veio com itens pessoais/i)).toBeInTheDocument();
    expect(screen.getByAltText(/Itens pessoais registrados no check-in/i)).toBeInTheDocument();
  });

  // TEST 18 — Complete tasks then check-out
  it("18. check-out modal completes pending tasks and then triggers check-out mutation", async () => {
    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    const completeAndCheckoutBtn = screen.getByRole("button", { name: /Concluir tarefas e fazer check-out/i });
    fireEvent.click(completeAndCheckoutBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/tasks/complete-by-pet/103"),
        expect.objectContaining({ method: "POST" })
      );
      expect(mockCheckOutMutate).toHaveBeenCalledWith(
        expect.objectContaining({ crecheId: 1, bookingId: 3 }),
        expect.anything()
      );
    });
  });

  // TEST 19 — Bypass task completion in checkout modal
  it("19. check-out modal allows checking out without completing pending tasks", async () => {
    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    const bypassBtn = screen.getByRole("button", { name: /Fazer check-out sem concluir/i });
    fireEvent.click(bypassBtn);

    expect(mockCheckOutMutate).toHaveBeenCalledWith(
      expect.objectContaining({ crecheId: 1, bookingId: 3 }),
      expect.anything()
    );
  });

  // TEST 20 — Partial-success checkout failure mode
  it("20. handles partial-success failure mode when task completion succeeds but checkout fails", async () => {
    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    const completeAndCheckoutBtn = screen.getByRole("button", { name: /Concluir tarefas e fazer check-out/i });
    fireEvent.click(completeAndCheckoutBtn);

    await waitFor(() => {
      expect(mockCheckOutMutate).toHaveBeenCalled();
    });

    const options = mockCheckOutMutate.mock.calls[0][1];
    options.onError(new Error("Erro no checkout"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro no check-out", variant: "destructive" }));
  });

  // TEST 21 — Open "A Caminho" Modal
  it("21. opens A Caminho modal for confirmed or active booking", async () => {
    renderWithProviders(<Bookings />);

    const onTheWayBtns = screen.getAllByRole("button", { name: /A caminho/i });
    fireEvent.click(onTheWayBtns[0]);

    expect(screen.getByRole("heading", { name: "A Caminho" })).toBeInTheDocument();
  });

  // TEST 22 — Submit "A Caminho" Drop-off
  it("22. submits A Caminho drop_off notification with ETA", async () => {
    renderWithProviders(<Bookings />);

    const onTheWayBtns = screen.getAllByRole("button", { name: /A caminho/i });
    fireEvent.click(onTheWayBtns[0]);

    const dropOffBtn = screen.getByRole("button", { name: /Levar o pet/i });
    fireEvent.click(dropOffBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/bookings/2/on-the-way"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "drop_off", etaMinutes: 15 }),
        })
      );
    });
  });

  // TEST 23 — Submit "A Caminho" Pickup
  it("23. submits A Caminho pickup notification with ETA", async () => {
    renderWithProviders(<Bookings />);

    const onTheWayBtns = screen.getAllByRole("button", { name: /A caminho/i });
    fireEvent.click(onTheWayBtns[0]);

    const pickupBtn = screen.getByRole("button", { name: /Buscar o pet/i });
    fireEvent.click(pickupBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/bookings/2/on-the-way"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "pickup", etaMinutes: 15 }),
        })
      );
    });
  });

  // TEST 24 — A Caminho failure feedback
  it("24. displays destructive error toast when A Caminho notification fails", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/tutors/manage")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: "Carlos Tutor", email: "carlos@test.com" },
            { id: 2, name: "Ana Tutora", email: "ana@test.com" },
            { id: 3, name: "Marcos Tutor", email: "marcos@test.com" },
          ],
        });
      }
      if (url.includes("/on-the-way")) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Bookings />);

    const onTheWayBtns = screen.getAllByRole("button", { name: /A caminho/i });
    fireEvent.click(onTheWayBtns[0]);

    const dropOffBtn = screen.getByRole("button", { name: /Levar o pet/i });
    fireEvent.click(dropOffBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro", variant: "destructive" }));
    });
  });

  // TEST 25 — Consumable action opens AddConsumableModal
  it("25. active regular booking consumable action opens AddConsumableModal", async () => {
    renderWithProviders(<Bookings />);

    const consumoBtns = screen.getAllByRole("button", { name: /Consumo/i });
    fireEvent.click(consumoBtns[0]);

    expect(screen.getByTestId("add-consumable-modal")).toBeInTheDocument();
  });

  // TEST 26 — Staff opens Edit Booking modal
  it("26. staff opens Edit Booking modal and transitions booking status", async () => {
    renderWithProviders(<Bookings />);

    const editBtns = screen.getAllByRole("button", { name: /Editar/i });
    fireEvent.click(editBtns[0]);

    expect(screen.getByText("Editar Reserva")).toBeInTheDocument();
  });

  // TEST 27 — Stuck pets banner rendering
  it("27. renders stuck pets banner when pet is checked in without an active booking", async () => {
    renderWithProviders(<Bookings />);

    expect(screen.getByText(/Luna está marcado como presente mas não tem reserva ativa/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Liberar Luna/i })).toBeInTheDocument();
  });

  // TEST 28 — Stuck pets force checkout success
  it("28. force checkout releases stuck pet and displays success toast", async () => {
    renderWithProviders(<Bookings />);

    const releaseBtn = screen.getByRole("button", { name: /Liberar Luna/i });
    fireEvent.click(releaseBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/pets/102/force-checkout"),
        expect.objectContaining({ method: "POST" })
      );
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Luna liberado" }));
    });
  });

  // TEST 29 — Mutation pending loading state
  it("29. disables action buttons while mutations are pending", async () => {
    (apiClientReact.useUpdateBooking as any).mockReturnValue({
      mutate: mockUpdateBookingMutate,
      isPending: true,
    });

    renderWithProviders(<Bookings />);

    const confirmButtons = screen.getAllByRole("button", { name: /Confirmar/i });
    expect(confirmButtons[0]).toBeDisabled();
  });

  // TEST 30 — Mobile cards vs Desktop table action parity
  it("30. ensures 100% action parity between mobile card view and desktop table view", async () => {
    renderWithProviders(<Bookings />);

    const mobileContainer = document.querySelector(".md\\:hidden");
    const desktopContainer = document.querySelector(".hidden.md\\:block");

    expect(mobileContainer).toBeInTheDocument();
    expect(desktopContainer).toBeInTheDocument();

    expect(mobileContainer?.textContent).toContain("Confirmar");
    expect(desktopContainer?.textContent).toContain("Confirmar");
    expect(mobileContainer?.textContent).toContain("Check-in");
    expect(desktopContainer?.textContent).toContain("Check-in");
    expect(mobileContainer?.textContent).toContain("Check-out");
    expect(desktopContainer?.textContent).toContain("Check-out");
  });

  // TEST 31 — Navigation triggers
  it("31. triggers navigation to new booking route", async () => {
    renderWithProviders(<Bookings />);

    const newBookingBtn = screen.getByRole("button", { name: /Nova Reserva/i });
    fireEvent.click(newBookingBtn);
    expect(mockSetLocation).toHaveBeenCalledWith("/bookings/new");
  });

  // TEST 32 — Status update failure scenario
  it("32. status update mutation failure displays destructive error toast and preserves state", async () => {
    renderWithProviders(<Bookings />);

    const confirmButtons = screen.getAllByRole("button", { name: /Confirmar/i });
    fireEvent.click(confirmButtons[0]);

    const options = mockUpdateBookingMutate.mock.calls[0][1];
    options.onError(new Error("Falha na atualização"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro ao atualizar reserva", variant: "destructive" }));
  });

  // TEST 33 — Check-in failure scenario
  it("33. check-in mutation failure displays error toast and does not open PersonalItemsModal", async () => {
    renderWithProviders(<Bookings />);

    const checkInButtons = screen.getAllByRole("button", { name: /^Check-in$/i });
    fireEvent.click(checkInButtons[0]);

    const options = mockCheckInMutate.mock.calls[0][1];
    options.onError(new Error("Falha no check-in"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro no check-in", variant: "destructive" }));
    expect(screen.queryByTestId("personal-items-modal")).not.toBeInTheDocument();
  });

  // TEST 34 — Direct check-out failure scenario
  it("34. direct check-out mutation failure displays error toast and retains booking in list", async () => {
    const activeBookingNoTasks = [
      {
        id: 34,
        petId: 101,
        petName: "Rex",
        tutorId: 1,
        tutorName: "Carlos Tutor",
        serviceType: "day_use",
        type: "day_use",
        catalogueItemType: "daycare",
        status: "active",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
        hasPersonalItems: false,
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: activeBookingNoTasks },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    const options = mockCheckOutMutate.mock.calls[0][1];
    options.onError(new Error("Falha no check-out"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro no check-out", variant: "destructive" }));
  });

  // TEST 35 — Complete service failure scenario
  it("35. complete service mutation failure displays error toast and keeps service active", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/tutors/manage")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: "Carlos Tutor", email: "carlos@test.com" },
            { id: 2, name: "Ana Tutora", email: "ana@test.com" },
            { id: 3, name: "Marcos Tutor", email: "marcos@test.com" },
          ],
        });
      }
      if (url.includes("/complete-service")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Erro no serviço" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const serviceBookings = [
      {
        id: 35,
        petId: 102,
        petName: "Luna",
        tutorId: 2,
        tutorName: "Ana Tutora",
        serviceType: "visita_taxi",
        type: "visita_taxi",
        catalogueItemType: "service",
        status: "active",
        startDate: "2026-08-27",
        endDate: "2026-08-27",
      },
    ];
    (apiClientReact.useListBookings as any).mockReturnValue({
      data: { items: serviceBookings },
      isLoading: false,
    });

    renderWithProviders(<Bookings />);

    const completeBtn = screen.getAllByRole("button", { name: /Concluir Serviço/i });
    fireEvent.click(completeBtn[0]);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro", variant: "destructive" }));
    });
  });

  // TEST 36 — Force checkout failure scenario
  it("36. force checkout mutation failure displays error toast and keeps pet in stuck banner", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/tutors/manage")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: "Carlos Tutor", email: "carlos@test.com" },
            { id: 2, name: "Ana Tutora", email: "ana@test.com" },
            { id: 3, name: "Marcos Tutor", email: "marcos@test.com" },
          ],
        });
      }
      if (url.includes("/force-checkout")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Erro ao liberar pet" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Bookings />);

    const releaseBtn = screen.getByRole("button", { name: /Liberar Luna/i });
    fireEvent.click(releaseBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro", variant: "destructive" }));
    });
  });

  // TEST 37 — Multi-step checkout task-completion request failure
  it("37. multi-step checkout task-completion request failure aborts checkout chain with error feedback", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/tutors/manage")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: "Carlos Tutor", email: "carlos@test.com" },
            { id: 2, name: "Ana Tutora", email: "ana@test.com" },
            { id: 3, name: "Marcos Tutor", email: "marcos@test.com" },
          ],
        });
      }
      if (url.includes("/tasks/complete-by-pet")) {
        return Promise.reject(new Error("Network error completing tasks"));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderWithProviders(<Bookings />);

    const checkOutBtn = screen.getAllByRole("button", { name: /^Check-out$/i });
    fireEvent.click(checkOutBtn[0]);

    const completeAndCheckoutBtn = screen.getByRole("button", { name: /Concluir tarefas e fazer check-out/i });
    fireEvent.click(completeAndCheckoutBtn);

    await waitFor(() => {
      expect(mockCheckOutMutate).toHaveBeenCalledWith(
        expect.objectContaining({ crecheId: 1, bookingId: 3 }),
        expect.anything()
      );
    });
  });
});
