import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantActionConfirmation } from "../features/assistant/AssistantActionConfirmation";
import type { AssistantSafeActionUI } from "../features/assistant/assistant.types";

describe("ArkPet R41.E — Safe Actions Frontend UI Test Suite (AI-ACT-UI-001..007)", () => {
  const dummyPreviewAction: AssistantSafeActionUI = {
    type: "cancel_my_booking",
    state: "confirmation_required",
    pendingActionId: "pa_test_12345",
    targetType: "booking",
    targetId: 42,
    summary: "Cancelar reserva #42 (Day Use) de Thor para amanhã",
    preview: {
      bookingId: 42,
      petName: "Thor",
      tutorName: "João da Silva",
      date: "03/10/2026",
      type: "Day Use",
    },
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("R41E-UI-001: renders confirmation card with summary, preview fields, risk badge, and buttons", () => {
    render(
      <AssistantActionConfirmation
        action={dummyPreviewAction}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId("assistant-action-confirmation-card")).toBeInTheDocument();
    expect(screen.getByText("Confirmação Necessária")).toBeInTheDocument();
    expect(screen.getByText("Ação Controlada")).toBeInTheDocument();
    expect(screen.getByText("Cancelar reserva #42 (Day Use) de Thor para amanhã")).toBeInTheDocument();
    expect(screen.getByText("Thor")).toBeInTheDocument();
    expect(screen.getByText("03/10/2026")).toBeInTheDocument();

    const confirmBtn = screen.getByTestId("assistant-action-confirm-button");
    const cancelBtn = screen.getByTestId("assistant-action-cancel-button");

    expect(confirmBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();
    expect(confirmBtn).not.toBeDisabled();
    expect(cancelBtn).not.toBeDisabled();
  });

  it("R41E-UI-002: clicking Confirmar invokes onConfirm with pendingActionId and disables double clicks", async () => {
    const handleConfirm = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    render(
      <AssistantActionConfirmation
        action={dummyPreviewAction}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    );

    const confirmBtn = screen.getByTestId("assistant-action-confirm-button");
    const cancelBtn = screen.getByTestId("assistant-action-cancel-button");

    fireEvent.click(confirmBtn);

    // Double-click protection: buttons are disabled during execution
    expect(confirmBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();

    await waitFor(() => {
      expect(handleConfirm).toHaveBeenCalledTimes(1);
      expect(handleConfirm).toHaveBeenCalledWith("pa_test_12345");
    });
  });

  it("R41E-UI-003: clicking Cancelar invokes onCancel with pendingActionId", async () => {
    const handleCancel = vi.fn(async () => {});

    render(
      <AssistantActionConfirmation
        action={dummyPreviewAction}
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    );

    const cancelBtn = screen.getByTestId("assistant-action-cancel-button");
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(handleCancel).toHaveBeenCalledTimes(1);
      expect(handleCancel).toHaveBeenCalledWith("pa_test_12345");
    });
  });

  it("R41E-UI-004: renders executed state with success badge and summary", () => {
    const executedAction: AssistantSafeActionUI = {
      ...dummyPreviewAction,
      state: "executed",
      summary: "Reserva #42 cancelada com sucesso.",
    };

    render(
      <AssistantActionConfirmation
        action={executedAction}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("Ação executada com sucesso")).toBeInTheDocument();
    expect(screen.getByText("Reserva #42 cancelada com sucesso.")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-action-confirm-button")).not.toBeInTheDocument();
  });

  it("R41E-UI-005: renders cancelled state when user cancels the pending action", () => {
    const cancelledAction: AssistantSafeActionUI = {
      ...dummyPreviewAction,
      state: "cancelled",
    };

    render(
      <AssistantActionConfirmation
        action={cancelledAction}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/Ação cancelada pelo usuário/i)).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-action-confirm-button")).not.toBeInTheDocument();
  });

  it("R41E-UI-006: renders expired state message", () => {
    const expiredAction: AssistantSafeActionUI = {
      ...dummyPreviewAction,
      state: "expired",
    };

    render(
      <AssistantActionConfirmation
        action={expiredAction}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/Tempo para confirmação expirado/i)).toBeInTheDocument();
  });

  it("R41E-UI-007: renders failed state message when mutation fails on server", () => {
    const failedAction: AssistantSafeActionUI = {
      ...dummyPreviewAction,
      state: "failed",
      error: "Conflito de concorrência ao atualizar reserva no banco de dados.",
    };

    render(
      <AssistantActionConfirmation
        action={failedAction}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("Falha na execução")).toBeInTheDocument();
    expect(screen.getByText("Conflito de concorrência ao atualizar reserva no banco de dados.")).toBeInTheDocument();
  });
});
