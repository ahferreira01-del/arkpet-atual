import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Modal } from "@/components/ui/modal";

describe("Custom Modal Accessibility Contract (R33L.B1)", () => {
  it("renders with role=dialog, aria-modal=true and accessible name from title", () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Ajustar estoque">
        <div>Conteúdo do modal</div>
      </Modal>
    );

    const dialog = screen.getByRole("dialog", { name: "Ajustar estoque" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Conteúdo do modal")).toBeInTheDocument();
  });

  it("links aria-describedby when description is provided, and omits it when absent", () => {
    const { rerender } = render(
      <Modal
        isOpen={true}
        onClose={vi.fn()}
        title="Confirmar Pagamento"
        description="Esta ação liquidará a fatura imediatamente."
      >
        <div>Corpo</div>
      </Modal>
    );

    const dialogWithDesc = screen.getByRole("dialog", { name: "Confirmar Pagamento" });
    const descId = dialogWithDesc.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    const descEl = document.getElementById(descId!);
    expect(descEl).toHaveTextContent("Esta ação liquidará a fatura imediatamente.");

    // Re-render without description
    rerender(
      <Modal isOpen={true} onClose={vi.fn()} title="Sem Descrição">
        <div>Corpo</div>
      </Modal>
    );

    const dialogWithoutDesc = screen.getByRole("dialog", { name: "Sem Descrição" });
    expect(dialogWithoutDesc.getAttribute("aria-describedby")).toBeNull();
  });

  it("exposes close button with accessible name Fechar", () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Título">
        <div>Corpo</div>
      </Modal>
    );

    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it("closes modal on Escape key press", () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose} title="Modal Escape">
        <button type="button">Ação</button>
      </Modal>
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("closes modal on backdrop click, but does not close on content click", () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose} title="Modal Backdrop">
        <button type="button">Botão Interno</button>
      </Modal>
    );

    // Click inside content
    const insideBtn = screen.getByRole("button", { name: "Botão Interno" });
    fireEvent.click(insideBtn);
    expect(handleClose).not.toHaveBeenCalled();

    // Click close button
    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("traps focus inside dialog on Tab and Shift+Tab traversal", async () => {
    render(
      <div>
        <button type="button" id="outside-btn">Fora</button>
        <Modal isOpen={true} onClose={vi.fn()} title="Modal Foco">
          <input type="text" placeholder="Primeiro campo" id="first-input" />
          <button type="button" id="last-btn">Último botão</button>
        </Modal>
      </div>
    );

    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    const firstInput = screen.getByPlaceholderText("Primeiro campo");
    const lastBtn = screen.getByRole("button", { name: "Último botão" });

    // Focus on last button and press Tab -> should wrap to first focusable element in modal (closeBtn)
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);

    // Focus on first element (closeBtn) and press Shift+Tab -> should wrap to last focusable element (lastBtn)
    closeBtn.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);
  });

  it("restores focus to previous active element after modal closes", async () => {
    function TestHost() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" id="trigger-btn" onClick={() => setOpen(true)}>
            Abrir Modal
          </button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Modal Host">
            <button type="button" onClick={() => setOpen(false)}>
              Salvar e Fechar
            </button>
          </Modal>
        </div>
      );
    }

    render(<TestHost />);
    const trigger = screen.getByRole("button", { name: "Abrir Modal" });

    // Focus trigger and open
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Close modal
    const closeAction = screen.getByRole("button", { name: "Salvar e Fechar" });
    fireEvent.click(closeAction);

    // Trigger should regain focus
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
