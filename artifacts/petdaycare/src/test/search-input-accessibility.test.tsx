import { describe, it, expect, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchInput } from "@/components/ui/search-input";

describe("SearchInput Accessibility Contract (R33L.B2 - A11Y-R33L-001)", () => {
  it("derives programmatic accessible name from placeholder when no aria-label is supplied", () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="Buscar pet..." />);

    const input = screen.getByRole("textbox", { name: "Buscar pet..." });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Buscar pet...");
  });

  it("prioritizes explicit caller-supplied aria-label over placeholder", () => {
    render(
      <SearchInput
        value=""
        onChange={vi.fn()}
        placeholder="Pesquisar..."
        aria-label="Buscar tutor específico"
      />
    );

    const input = screen.getByRole("textbox", { name: "Buscar tutor específico" });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Pesquisar...");
  });

  it("preserves caller-supplied aria-labelledby without injecting competing aria-label", () => {
    render(
      <div>
        <span id="external-search-label">Buscar transações financeiras</span>
        <SearchInput
          value=""
          onChange={vi.fn()}
          aria-labelledby="external-search-label"
          placeholder="Pesquisar..."
        />
      </div>
    );

    const input = screen.getByRole("textbox", { name: "Buscar transações financeiras" });
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-label");
  });

  it("falls back to generic 'Buscar' accessible name when placeholder and labels are empty", () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="" />);

    const input = screen.getByRole("textbox", { name: "Buscar" });
    expect(input).toBeInTheDocument();
  });

  it("renders clear button with accessible name 'Limpar busca' and invokes onClear handler", () => {
    const handleClear = vi.fn();
    render(
      <SearchInput
        value="Rex"
        onChange={vi.fn()}
        onClear={handleClear}
        placeholder="Buscar..."
      />
    );

    const clearBtn = screen.getByRole("button", { name: /limpar busca/i });
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);
  });

  it("passes through native props such as disabled and data-testid", () => {
    render(
      <SearchInput
        value=""
        onChange={vi.fn()}
        placeholder="Buscar..."
        disabled={true}
        data-testid="custom-search-input"
      />
    );

    const input = screen.getByTestId("custom-search-input");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-label", "Buscar...");
  });
});
