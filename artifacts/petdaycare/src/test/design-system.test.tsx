import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dog, Plus, RefreshCw, AlertCircle, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardHeader, CardTitle, CardContent, MetricCard, InteractiveCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Alert } from "@/components/ui/alert";
import { Skeleton, InlineLoader } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { SectionHeader } from "@/components/ui/section-header";
import { PageHeader } from "@/components/layout/page-header";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ContentContainer } from "@/components/ui/content-container";
import { FilterBar } from "@/components/ui/filter-bar";

describe("R39.C Design System Consolidation Suite", () => {
  describe("Button Primitive", () => {
    it("renders children, default styles, and handles click events", () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Cadastrar Pet</Button>);

      const btn = screen.getByRole("button", { name: "Cadastrar Pet" });
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("handles isLoading state with aria-busy and disabled behavior", () => {
      const handleClick = vi.fn();
      render(
        <Button isLoading onClick={handleClick}>
          Salvar
        </Button>
      );

      const btn = screen.getByRole("button", { name: "Salvar" });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("aria-busy", "true");
      fireEvent.click(btn);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it("respects explicit disabled state", () => {
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Ação Bloqueada
        </Button>
      );

      const btn = screen.getByRole("button", { name: "Ação Bloqueada" });
      expect(btn).toBeDisabled();
      fireEvent.click(btn);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it("supports backward-compatible pill shape and custom class overrides", () => {
      render(
        <Button shape="pill" className="custom-test-btn">
          Pill Button
        </Button>
      );

      const btn = screen.getByRole("button", { name: "Pill Button" });
      expect(btn.className).toContain("rounded-full");
      expect(btn.className).toContain("custom-test-btn");
    });
  });

  describe("IconButton Primitive", () => {
    it("requires and exposes programmatic accessible name from aria-label", () => {
      const handleClick = vi.fn();
      render(
        <IconButton aria-label="Adicionar item" onClick={handleClick}>
          <Plus className="h-4 w-4" />
        </IconButton>
      );

      const btn = screen.getByRole("button", { name: "Adicionar item" });
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("supports isLoading state and disables interaction", () => {
      render(
        <IconButton aria-label="Atualizando dados" isLoading>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      );

      const btn = screen.getByRole("button", { name: "Atualizando dados" });
      expect(btn).toBeDisabled();
    });
  });

  describe("StatusBadge Primitive", () => {
    it("renders each of the 5 canonical semantic variants", () => {
      const { rerender } = render(<StatusBadge variant="neutral">Rascunho</StatusBadge>);
      expect(screen.getByText("Rascunho")).toBeInTheDocument();

      rerender(<StatusBadge variant="success">Ativo</StatusBadge>);
      expect(screen.getByText("Ativo")).toBeInTheDocument();

      rerender(<StatusBadge variant="warning">Pendente</StatusBadge>);
      expect(screen.getByText("Pendente")).toBeInTheDocument();

      rerender(<StatusBadge variant="danger">Cancelado</StatusBadge>);
      expect(screen.getByText("Cancelado")).toBeInTheDocument();

      rerender(<StatusBadge variant="info">Agendado</StatusBadge>);
      expect(screen.getByText("Agendado")).toBeInTheDocument();
    });

    it("renders optional leading status dot and icon without breaking text flow", () => {
      render(
        <StatusBadge variant="success" dot icon={Dog}>
          Check-in Feito
        </StatusBadge>
      );

      expect(screen.getByText("Check-in Feito")).toBeInTheDocument();
    });
  });

  describe("Card System & Composites", () => {
    it("renders Card container with header, title, and content", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Visão Geral</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Conteúdo do card operacional.</p>
          </CardContent>
        </Card>
      );

      expect(screen.getByText("Visão Geral")).toBeInTheDocument();
      expect(screen.getByText("Conteúdo do card operacional.")).toBeInTheDocument();
    });

    it("renders MetricCard with label, value, supporting text, and trend", () => {
      render(
        <MetricCard
          label="Total de Pets Ativos"
          value="142"
          supportingText="Capacidade em 85%"
          trend={{ value: "+12%", isPositive: true, label: "vs mês anterior" }}
          icon={Dog}
        />
      );

      expect(screen.getByText("Total de Pets Ativos")).toBeInTheDocument();
      expect(screen.getByText("142")).toBeInTheDocument();
      expect(screen.getByText("Capacidade em 85%")).toBeInTheDocument();
      expect(screen.getByText("+12%")).toBeInTheDocument();
      expect(screen.getByText("vs mês anterior")).toBeInTheDocument();
    });

    it("renders InteractiveCard with accessible button semantics and click handler", () => {
      const handleAction = vi.fn();
      render(
        <InteractiveCard onClick={handleAction}>
          <h4>Acessar Módulo Financeiro</h4>
        </InteractiveCard>
      );

      const card = screen.getByRole("button", { name: /Acessar Módulo Financeiro/i });
      expect(card).toBeInTheDocument();
      fireEvent.click(card);
      expect(handleAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("EmptyState Primitive", () => {
    it("renders title, description, primary action, and optional secondary action", () => {
      const handlePrimary = vi.fn();
      const handleSecondary = vi.fn();

      render(
        <EmptyState
          icon={Dog}
          title="Nenhum pet cadastrado"
          description="Cadastre seu primeiro pet para começar a utilizar o sistema."
          action={{ label: "Cadastrar Pet", onClick: handlePrimary }}
          secondaryAction={{ label: "Importar Pets", onClick: handleSecondary }}
        />
      );

      expect(screen.getByRole("region", { name: "Nenhum pet cadastrado" })).toBeInTheDocument();
      expect(screen.getByText("Nenhum pet cadastrado")).toBeInTheDocument();
      expect(
        screen.getByText("Cadastre seu primeiro pet para começar a utilizar o sistema.")
      ).toBeInTheDocument();

      const primaryBtn = screen.getByRole("button", { name: "Cadastrar Pet" });
      fireEvent.click(primaryBtn);
      expect(handlePrimary).toHaveBeenCalledTimes(1);

      const secondaryBtn = screen.getByRole("button", { name: "Importar Pets" });
      fireEvent.click(secondaryBtn);
      expect(handleSecondary).toHaveBeenCalledTimes(1);
    });

    it("supports compact mode for tight card/table sections", () => {
      render(
        <EmptyState
          compact
          icon={Dog}
          title="Sem registros"
          description="Nenhum histórico recente encontrado."
        />
      );

      expect(screen.getByText("Sem registros")).toBeInTheDocument();
    });
  });

  describe("ErrorState Primitive", () => {
    it("renders specified error type with default fallback copy and executes action", () => {
      const handleRetry = vi.fn();
      render(<ErrorState type="access-denied" action={{ label: "Voltar ao início", onClick: handleRetry }} />);

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Acesso não autorizado")).toBeInTheDocument();

      const btn = screen.getByRole("button", { name: "Voltar ao início" });
      fireEvent.click(btn);
      expect(handleRetry).toHaveBeenCalledTimes(1);
    });

    it("allows custom title and description overrides", () => {
      render(
        <ErrorState
          type="generic"
          title="Falha na sincronização"
          description="Não foi possível sincronizar o extrato."
        />
      );

      expect(screen.getByText("Falha na sincronização")).toBeInTheDocument();
      expect(screen.getByText("Não foi possível sincronizar o extrato.")).toBeInTheDocument();
    });
  });

  describe("Alert Primitive", () => {
    it("renders alert role with semantic message and title", () => {
      render(
        <Alert variant="warning" title="Atenção à Quota">
          Sua creche atingiu 90% da capacidade do plano atual.
        </Alert>
      );

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(screen.getByText("Atenção à Quota")).toBeInTheDocument();
      expect(
        screen.getByText("Sua creche atingiu 90% da capacidade do plano atual.")
      ).toBeInTheDocument();
    });
  });

  describe("Skeleton & Loading Primitives", () => {
    it("renders Skeleton with aria-hidden for screen readers", () => {
      const { container } = render(<Skeleton className="h-6 w-32" />);
      const skeleton = container.firstChild as HTMLElement;
      expect(skeleton).toHaveAttribute("aria-hidden", "true");
    });

    it("renders InlineLoader with live status role", () => {
      render(<InlineLoader label="Atualizando status..." />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getAllByText("Atualizando status...").length).toBeGreaterThan(0);
    });
  });

  describe("Breadcrumbs Primitive", () => {
    it("renders accessible navigation trail and marks final item as active page", () => {
      render(
        <Breadcrumbs
          items={[
            { label: "Operação", href: "/bookings" },
            { label: "Nova Reserva" },
          ]}
        />
      );

      const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(nav).toBeInTheDocument();

      const activePage = screen.getByText("Nova Reserva");
      expect(activePage).toHaveAttribute("aria-current", "page");

      const link = screen.getByRole("link", { name: "Operação" });
      expect(link).toHaveAttribute("href", "/bookings");
    });
  });

  describe("PageHeader & SectionHeader Primitives", () => {
    it("renders PageHeader with title, description, status, and actions", () => {
      const handleBack = vi.fn();
      render(
        <PageHeader
          title="Gestão de Reservas"
          description="Monitore e organize o fluxo diário de pets na creche."
          status={<StatusBadge variant="success">Em Operação</StatusBadge>}
          primaryAction={<Button>Nova Reserva</Button>}
          showBack={true}
          onBack={handleBack}
        />
      );

      expect(screen.getByText("Gestão de Reservas")).toBeInTheDocument();
      expect(
        screen.getByText("Monitore e organize o fluxo diário de pets na creche.")
      ).toBeInTheDocument();
      expect(screen.getByText("Em Operação")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Nova Reserva" })).toBeInTheDocument();

      const backBtn = screen.getByRole("button", { name: "Voltar para tela anterior" });
      fireEvent.click(backBtn);
      expect(handleBack).toHaveBeenCalledTimes(1);
    });

    it("renders SectionHeader with title, badge, and description", () => {
      render(
        <SectionHeader
          title="Serviços Adicionais"
          description="Selecione os adicionais contratados para este dia."
          badge={<StatusBadge variant="info">3 disponíveis</StatusBadge>}
        />
      );

      expect(screen.getByText("Serviços Adicionais")).toBeInTheDocument();
      expect(screen.getByText("3 disponíveis")).toBeInTheDocument();
      expect(
        screen.getByText("Selecione os adicionais contratados para este dia.")
      ).toBeInTheDocument();
    });
  });

  describe("Canonical Form Controls", () => {
    it("renders Checkbox with accessible state", () => {
      render(<Checkbox aria-label="Aceitar termos do plano" />);
      const checkbox = screen.getByRole("checkbox", { name: "Aceitar termos do plano" });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it("renders Switch with accessible toggle role", () => {
      render(<Switch aria-label="Ativar notificações por e-mail" />);
      const toggle = screen.getByRole("switch", { name: "Ativar notificações por e-mail" });
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute("data-state", "unchecked");

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("data-state", "checked");
    });
  });

  describe("FilterBar & ContentContainer", () => {
    it("renders FilterBar with search slot and clear filters button", () => {
      const handleClear = vi.fn();
      render(
        <FilterBar
          searchSlot={<input placeholder="Buscar por tutor..." />}
          hasActiveFilters={true}
          onClearFilters={handleClear}
        />
      );

      expect(screen.getByRole("search", { name: "Filtros e busca" })).toBeInTheDocument();
      const clearBtn = screen.getByRole("button", { name: /Limpar filtros/i });
      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });

    it("renders ContentContainer with width bounds", () => {
      const { container } = render(
        <ContentContainer width="normal">
          <p>Conteúdo centralizado</p>
        </ContentContainer>
      );

      expect(container.firstChild).toHaveClass("max-w-5xl");
    });
  });
});
