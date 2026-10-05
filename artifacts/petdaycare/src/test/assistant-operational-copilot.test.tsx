import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssistantConversation } from "../features/assistant/AssistantConversation";
import type {
  AssistantUIMessage,
  ScreenContextInfo,
  OperationalCopilotUI,
} from "../features/assistant/assistant.types";

describe("ArkPet R41.F — Operational Copilot Frontend UI Test Suite", () => {
  const dummyScreenContext: ScreenContextInfo = {
    route: "/staff/board",
    feature: "staff_board",
    title: "Painel Operacional",
  };

  const dummyOperationalData: OperationalCopilotUI = {
    asOf: "2026-10-05T10:00:00.000Z",
    businessDate: "2026-10-05",
    dataCompleteness: "complete",
    occupancy: {
      current: 12,
      capacity: 25,
    },
    arrivals: {
      totalExpected: 15,
      checkedIn: 10,
      pending: 4,
      completed: 1,
      cancelled: 0,
      onTheWay: 2,
    },
    tasks: {
      total: 8,
      pending: 5,
      completed: 3,
      overdue: 2,
      unassigned: 1,
    },
    priorities: [
      {
        id: "task_medication_11",
        priority: "critical",
        title: "Medicação de Thor (Antibiótico 250mg)",
        reason: "Medicação está atrasada há 90 minuto(s).",
        suggestedAction: {
          tool: "record_medication_administration",
          label: "Registrar administração de Antibiótico 250mg",
          targetId: 11,
        },
      },
      {
        id: "task_feeding_12",
        priority: "high",
        title: "Alimentação de Thor (Ração Premium)",
        reason: "Alimentação está atrasada há 30 minuto(s).",
        suggestedAction: {
          tool: "complete_feeding_task",
          label: "Concluir alimentação de Thor",
          targetId: 12,
        },
      },
      {
        id: "task_walk_13",
        priority: "low",
        title: "Passeio de Rex",
        reason: "Passeio agendado para hoje.",
      },
    ],
  };

  const dummyMessageWithOperational: AssistantUIMessage = {
    id: "msg_test_ops_1",
    role: "assistant",
    content: "Aqui está o resumo da operação de hoje e os itens prioritários.",
    createdAt: new Date().toISOString(),
    operational: dummyOperationalData,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("R41F-UI-001: displays operational quick suggestion pills for staff and creche_admin", () => {
    const { rerender } = render(
      <AssistantConversation
        messages={[]}
        status="idle"
        screenContext={dummyScreenContext}
        userRole="staff"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
      />
    );

    expect(screen.getByText("O que precisa da minha atenção agora?")).toBeInTheDocument();
    expect(screen.getByText("Quais pets ainda não comeram?")).toBeInTheDocument();
    expect(screen.getByText("Tem alguma medicação atrasada?")).toBeInTheDocument();

    rerender(
      <AssistantConversation
        messages={[]}
        status="idle"
        screenContext={dummyScreenContext}
        userRole="creche_admin"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
      />
    );

    expect(screen.getByText("Resumo operacional de hoje")).toBeInTheDocument();
    expect(screen.getByText("Quem ainda está aguardando check-in?")).toBeInTheDocument();
  });

  it("R41F-UI-002: renders operational card with occupancy, arrivals, and tasks metrics", () => {
    render(
      <AssistantConversation
        messages={[dummyMessageWithOperational]}
        status="idle"
        screenContext={dummyScreenContext}
        userRole="staff"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
      />
    );

    expect(screen.getByTestId("operational-card")).toBeInTheDocument();
    expect(screen.getByText("Copiloto Operacional")).toBeInTheDocument();

    expect(screen.getByTestId("operational-occupancy")).toBeInTheDocument();
    expect(screen.getByText("12/25 pets")).toBeInTheDocument();

    expect(screen.getByTestId("operational-arrivals")).toBeInTheDocument();
    expect(screen.getByText("15 (4 aguardando)")).toBeInTheDocument();

    expect(screen.getByTestId("operational-tasks")).toBeInTheDocument();
    expect(screen.getByText("5 (2 atrasadas)")).toBeInTheDocument();
  });

  it("R41F-UI-003: renders priority items with deterministic priority badges", () => {
    render(
      <AssistantConversation
        messages={[dummyMessageWithOperational]}
        status="idle"
        screenContext={dummyScreenContext}
        userRole="staff"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
      />
    );

    expect(screen.getByTestId("operational-priorities")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("LOW")).toBeInTheDocument();

    expect(screen.getByText("Medicação de Thor (Antibiótico 250mg)")).toBeInTheDocument();
    expect(screen.getByText("Alimentação de Thor (Ração Premium)")).toBeInTheDocument();
    expect(screen.getByText("Passeio de Rex")).toBeInTheDocument();
  });

  it("R41F-UI-004: clicking a suggested action button sends the action label message to the assistant", () => {
    const handleSendMessage = vi.fn();

    render(
      <AssistantConversation
        messages={[dummyMessageWithOperational]}
        status="idle"
        screenContext={dummyScreenContext}
        userRole="staff"
        onSendMessage={handleSendMessage}
        onClearSession={vi.fn()}
      />
    );

    const actionBtn = screen.getByText("Registrar administração de Antibiótico 250mg");
    expect(actionBtn).toBeInTheDocument();

    fireEvent.click(actionBtn);
    expect(handleSendMessage).toHaveBeenCalledWith("Registrar administração de Antibiótico 250mg");
  });

  it("R41F-UI-005: surfaces dataCompleteness warning badge when data is partial", () => {
    const partialMessage: AssistantUIMessage = {
      ...dummyMessageWithOperational,
      operational: {
        ...dummyOperationalData,
        dataCompleteness: "partial",
        unavailableSources: ["tasks"],
      },
    };

    render(
      <AssistantConversation
        messages={[partialMessage]}
        status="idle"
        screenContext={dummyScreenContext}
        userRole="staff"
        onSendMessage={vi.fn()}
        onClearSession={vi.fn()}
      />
    );

    expect(screen.getByText("Dados Parciais")).toBeInTheDocument();
  });
});
