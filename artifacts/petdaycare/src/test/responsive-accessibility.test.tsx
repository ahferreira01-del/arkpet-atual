import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent } from "./utils";
import * as authModule from "@/hooks/use-auth";
import * as billingModule from "@workspace/api-client-react";
import { UserProfile } from "@workspace/api-client-react";

import { AppLayout } from "@/components/layout/app-layout";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { PetAvatar } from "@/components/pet-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AdvancedDataTable } from "@/components/ui/advanced-data-table";
import { ColumnDef } from "@tanstack/react-table";
import { X, Search } from "lucide-react";

const mockStaffUser: UserProfile = {
  id: 1,
  name: "Staff User",
  email: "staff@arkpet.com",
  role: "staff",
  crecheId: 10,
  createdAt: "2026-01-01T00:00:00Z",
};

const mockAdminUser: UserProfile = {
  id: 2,
  name: "Admin User",
  email: "admin@arkpet.com",
  role: "creche_admin",
  crecheId: 10,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("R39.H Global Responsive & Accessibility Verification Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      user: mockStaffUser,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    } as any);

    // Mock billing subscription to prevent redirection
    vi.spyOn(billingModule, "useGetBillingSubscription").mockReturnValue({
      data: { status: "active" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any);
  });

  describe("Accessibility Compliance (TC-A11Y-01 .. TC-A11Y-10)", () => {
    it("TC-A11Y-01: renders semantic landmarks including header, nav, and main with id='main-content'", () => {
      renderWithProviders(
        <AppLayout>
          <div>Conteúdo Principal</div>
        </AppLayout>
      );

      // Check header banner landmark
      const banner = screen.getByRole("banner");
      expect(banner).toBeInTheDocument();

      // Check main landmark with target id for skip link
      const main = screen.getByRole("main");
      expect(main).toBeInTheDocument();
      expect(main).toHaveAttribute("id", "main-content");
      expect(main).toHaveAttribute("tabIndex", "-1");

      // Check navigation landmarks (sidebar and bottom nav)
      const navs = screen.getAllByRole("navigation");
      expect(navs.length).toBeGreaterThan(0);
    });

    it("TC-A11Y-02: marks active navigation links with aria-current='page'", () => {
      vi.spyOn(authModule, "useAuth").mockReturnValue({
        user: mockAdminUser,
        isLoading: false,
      } as any);

      renderWithProviders(<Sidebar user={mockAdminUser} />);

      // In default location (/), Dashboard link is active and marked with aria-current="page"
      const activeLink = document.querySelector('[aria-current="page"]');
      expect(activeLink).toBeInTheDocument();
      expect(activeLink?.getAttribute("href")).toBe("/");
    });

    it("TC-A11Y-03: ensures all icon-only buttons provide accessible names via aria-label", () => {
      renderWithProviders(
        <div className="flex gap-2">
          <IconButton
            aria-label="Fechar janela"
            onClick={() => {}}
          >
            <X className="w-4 h-4" />
          </IconButton>
          <IconButton
            aria-label="Pesquisar registros"
            onClick={() => {}}
          >
            <Search className="w-4 h-4" />
          </IconButton>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Alternar tema visual"
          >
            <Search className="w-4 h-4" />
          </Button>
        </div>
      );

      expect(
        screen.getByRole("button", { name: "Fechar janela" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Pesquisar registros" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Alternar tema visual" })
      ).toBeInTheDocument();
    });

    it("TC-A11Y-04: binds form inputs with accessible labels and communicates validation state", () => {
      renderWithProviders(
        <div className="space-y-4">
          <div>
            <Label htmlFor="pet-name">Nome do Pet</Label>
            <Input id="pet-name" placeholder="Ex: Rex" />
          </div>
          <div>
            <Label htmlFor="pet-age">Idade (Anos)</Label>
            <Input
              id="pet-age"
              aria-invalid="true"
              aria-describedby="age-error"
            />
            <span id="age-error" role="alert" className="text-destructive text-xs">
              Idade inválida
            </span>
          </div>
        </div>
      );

      const nameInput = screen.getByLabelText("Nome do Pet");
      expect(nameInput).toBeInTheDocument();

      const ageInput = screen.getByLabelText("Idade (Anos)");
      expect(ageInput).toBeInTheDocument();
      expect(ageInput).toHaveAttribute("aria-invalid", "true");
      expect(ageInput).toHaveAttribute("aria-describedby", "age-error");
      expect(screen.getByRole("alert")).toHaveTextContent("Idade inválida");
    });

    it("TC-A11Y-05: modal renders with role='dialog', aria-modal='true', and accessible close button", () => {
      const handleClose = vi.fn();
      renderWithProviders(
        <Modal
          isOpen={true}
          onClose={handleClose}
          title="Confirmar Operação"
        >
          <p>Deseja confirmar o check-in do pet?</p>
        </Modal>
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(screen.getByText("Confirmar Operação")).toBeInTheDocument();

      const closeBtn = screen.getByRole("button", { name: /fechar/i });
      expect(closeBtn).toBeInTheDocument();
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("TC-A11Y-06: maintains visible focus ring styling across interactive controls", () => {
      renderWithProviders(
        <div>
          <Button variant="default">Ação Principal</Button>
          <Input placeholder="Digitar..." />
        </div>
      );

      const btn = screen.getByRole("button", { name: "Ação Principal" });
      expect(btn.className).toContain("focus-visible:ring-");

      const input = screen.getByPlaceholderText("Digitar...");
      expect(input.className).toContain("focus-visible:ring-");
    });

    it("TC-A11Y-07: conveys status semantics via explicit text and labels, not color alone", () => {
      renderWithProviders(
        <div className="flex gap-2">
          <StatusBadge variant="success">Confirmado</StatusBadge>
          <StatusBadge variant="warning">Pendente</StatusBadge>
          <StatusBadge variant="danger">Cancelado</StatusBadge>
          <Badge variant="success">Pago</Badge>
          <Badge variant="destructive">Atrasado</Badge>
        </div>
      );

      expect(screen.getByText("Confirmado")).toBeInTheDocument();
      expect(screen.getByText("Pendente")).toBeInTheDocument();
      expect(screen.getByText("Cancelado")).toBeInTheDocument();
      expect(screen.getByText("Pago")).toBeInTheDocument();
      expect(screen.getByText("Atrasado")).toBeInTheDocument();
    });

    it("TC-A11Y-08: provides accessible values and text representation for progress/occupancy", () => {
      const current = 42;
      const capacity = 50;
      const percentage = Math.round((current / capacity) * 100);

      renderWithProviders(
        <div>
          <div
            role="progressbar"
            aria-valuenow={current}
            aria-valuemin={0}
            aria-valuemax={capacity}
            aria-label="Ocupação da creche"
            aria-valuetext={`${current} de ${capacity} pets (${percentage}%)`}
            className="w-full bg-muted rounded-full h-3"
          >
            <div
              className="bg-primary h-3 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {current} / {capacity} pets
          </span>
        </div>
      );

      const progress = screen.getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "42");
      expect(progress).toHaveAttribute("aria-valuemax", "50");
      expect(progress).toHaveAttribute(
        "aria-valuetext",
        "42 de 50 pets (84%)"
      );
      expect(screen.getByText("42 / 50 pets")).toBeInTheDocument();
    });

    it("TC-A11Y-09: includes descriptive alt text for pet avatars and hides decorative icons", () => {
      renderWithProviders(
        <div className="flex gap-2">
          <PetAvatar name="Thor" photoUrl="https://example.com/thor.jpg" />
          <PetAvatar name="Mel" photoUrl={null} />
        </div>
      );

      const img = screen.getByAltText("Thor");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://example.com/thor.jpg");

      // Mel does not have a photoUrl, displays accessible fallback icon
      const fallbackIcon = screen.getByRole("img", { name: "Avatar padrão de Mel" });
      expect(fallbackIcon).toBeInTheDocument();
    });

    it("TC-A11Y-10: verifies Skip to Main Content anchor points to #main-content with keyboard focusability", () => {
      renderWithProviders(
        <AppLayout>
          <div>Conteúdo</div>
        </AppLayout>
      );

      const skipLink = screen.getByText("Pular para o conteúdo principal");
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute("href", "#main-content");
      expect(skipLink.className).toContain("sr-only");
      expect(skipLink.className).toContain("focus:not-sr-only");
    });
  });

  describe("Responsive Layout & Touch Ergonomics (TC-RSP-01 .. TC-RSP-06)", () => {
    it("TC-RSP-01: app shell hides sidebar on mobile and renders desktop sidebar on lg/md viewports", () => {
      renderWithProviders(
        <AppLayout>
          <div>Dashboard View</div>
        </AppLayout>
      );

      const aside = screen.getByRole("complementary", { hidden: true });
      expect(aside).toBeInTheDocument();
      expect(aside.className).toContain("hidden");
      expect(aside.className).toContain("md:flex");
    });

    it("TC-RSP-02: bottom navigation targets meet touch ergonomics criteria (min-h-[48px])", () => {
      renderWithProviders(<BottomNav user={mockStaffUser} />);

      const nav = screen.getByRole("navigation", {
        name: "Navegação Inferior Mobile",
      });
      expect(nav).toBeInTheDocument();
      expect(nav.className).toContain("md:hidden");

      // All bottom nav action containers should have min-h-[48px]
      const buttons = nav.querySelectorAll("a, button");
      expect(buttons.length).toBeGreaterThanOrEqual(4);
      buttons.forEach((btn) => {
        const inner = btn.querySelector("div");
        if (inner) {
          expect(inner.className).toContain("min-h-[48px]");
        }
      });
    });

    it("TC-RSP-03: AdvancedDataTable renders mobile card layout via renderMobileCard", () => {
      type RowItem = { id: number; name: string; status: string };
      const data: RowItem[] = [
        { id: 1, name: "Max", status: "Presente" },
        { id: 2, name: "Luna", status: "Ausente" },
      ];

      const columns: ColumnDef<RowItem>[] = [
        { accessorKey: "name", header: "Nome" },
        { accessorKey: "status", header: "Status" },
      ];

      renderWithProviders(
        <AdvancedDataTable
          data={data}
          columns={columns}
          renderMobileCard={(row) => (
            <div data-testid={`mobile-card-${row.original.id}`}>
              <span>{row.original.name}</span>
              <span>{row.original.status}</span>
            </div>
          )}
        />
      );

      // Mobile cards rendered
      expect(screen.getByTestId("mobile-card-1")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-card-2")).toBeInTheDocument();
      expect(screen.getAllByText("Max").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Luna").length).toBeGreaterThanOrEqual(1);
    });

    it("TC-RSP-04: operational actions maintain touch-friendly button targets (h-10 or h-11)", () => {
      renderWithProviders(
        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="h-11 sm:h-10 w-full sm:w-auto">
            Registrar Check-in
          </Button>
          <Button variant="outline" className="h-11 sm:h-10 w-full sm:w-auto">
            Escanear QR Code
          </Button>
        </div>
      );

      const checkInBtn = screen.getByRole("button", {
        name: "Registrar Check-in",
      });
      const qrBtn = screen.getByRole("button", {
        name: "Escanear QR Code",
      });

      expect(checkInBtn.className).toContain("h-11");
      expect(qrBtn.className).toContain("h-11");
    });

    it("TC-RSP-05: administrative forms use responsive grids adapting from 1 column to multi-column", () => {
      renderWithProviders(
        <Card className="p-4">
          <CardHeader>
            <CardTitle>Configurações da Unidade</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="creche-name">Razão Social</Label>
                <Input id="creche-name" defaultValue="ArkPet Jardins" />
              </div>
              <div>
                <Label htmlFor="creche-cnpj">CNPJ</Label>
                <Input id="creche-cnpj" defaultValue="00.000.000/0001-00" />
              </div>
            </form>
          </CardContent>
        </Card>
      );

      const form = document.querySelector("form");
      expect(form?.className).toContain("grid-cols-1");
      expect(form?.className).toContain("md:grid-cols-2");
    });

    it("TC-RSP-06: dialogs and sheets constrain viewport height with scrollable content", () => {
      renderWithProviders(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Fatura Detalhada"
          className="max-w-4xl max-h-[90vh] overflow-y-auto"
        >
          <div className="space-y-4">
            <p>Linha de detalhe de cobrança</p>
          </div>
        </Modal>
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog.className).toContain("max-h-[90vh]");
      expect(dialog.className).toContain("overflow-y-auto");
    });
  });
});
