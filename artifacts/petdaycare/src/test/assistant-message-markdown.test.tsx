import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { AssistantMessageContent, sanitizeMarkdownUrl } from "../features/assistant/AssistantMessageContent";
import { AssistantConversation } from "../features/assistant/AssistantConversation";
import type { AssistantUIMessage } from "../features/assistant/assistant.types";

describe("ArkPet — Assistant Markdown Message Rendering & Security Suite", () => {
  // Test 1: Section 24 - Non-raw markdown rendering for bold, inline code, and numbered lists
  it("renders bold text, inline code, and ordered lists without raw markdown symbols", () => {
    const markdown = "1. **Dados da creche** — Preencha em `/settings`.\n2. **Cadastrar equipe** — Vá para `/staff/manage`.";

    const { container } = render(<AssistantMessageContent content={markdown} />);

    // Must contain an ordered list
    const ol = container.querySelector("ol");
    expect(ol).toBeInTheDocument();
    expect(ol).toHaveClass("list-decimal");

    // Must have exactly two list items
    const listItems = container.querySelectorAll("li");
    expect(listItems).toHaveLength(2);

    // Strong tags must be present
    const strongTags = container.querySelectorAll("strong");
    expect(strongTags).toHaveLength(2);
    expect(strongTags[0]).toHaveTextContent("Dados da creche");
    expect(strongTags[1]).toHaveTextContent("Cadastrar equipe");

    // Code tags must be present
    const codeTags = container.querySelectorAll("code");
    expect(codeTags).toHaveLength(2);
    expect(codeTags[0]).toHaveTextContent("/settings");
    expect(codeTags[1]).toHaveTextContent("/staff/manage");

    // Zero raw markdown tokens (** or `) in the visible text
    const textContent = container.textContent || "";
    expect(textContent).not.toContain("**");
    expect(textContent).not.toContain("`");
  });

  // Test 2: Section 25 - Bullet lists (unordered lists)
  it("renders bullet lists with proper disc styling and list items", () => {
    const markdown = "- Alimentação\n- Medicação\n- Passeios";

    const { container } = render(<AssistantMessageContent content={markdown} />);

    const ul = container.querySelector("ul");
    expect(ul).toBeInTheDocument();
    expect(ul).toHaveClass("list-disc");

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Alimentação");
    expect(items[1]).toHaveTextContent("Medicação");
    expect(items[2]).toHaveTextContent("Passeios");
  });

  // Test 3: Section 26 - Separate paragraphs
  it("renders multiple paragraphs with proper spacing classes", () => {
    const markdown = "Sua creche está quase pronta.\n\nComplete os passos abaixo para continuar.";

    const { container } = render(<AssistantMessageContent content={markdown} />);

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("Sua creche está quase pronta.");
    expect(paragraphs[1]).toHaveTextContent("Complete os passos abaixo para continuar.");
    expect(paragraphs[0]).toHaveClass("mb-2");
  });

  // Test 4: Section 27 - Security & XSS protection
  it("prevents XSS execution and does not render raw executable scripts or event handlers", () => {
    const maliciousInput = "<script>alert('xss')</script><img src=x onerror=alert(1)>Texto seguro";

    const { container } = render(<AssistantMessageContent content={maliciousInput} />);

    // Script tag must not exist as an executable DOM element
    expect(container.querySelector("script")).toBeNull();

    // Img tag with onerror must not exist or be executed
    expect(container.querySelector("img")).toBeNull();

    // Safe text should still be displayed
    expect(container).toHaveTextContent("Texto seguro");
  });

  // Test 5: Dangerous URL protocol rejection
  it("sanitizes dangerous URLs such as javascript: or data: in markdown links", () => {
    const markdownWithDangerousLink = "[Ataque XSS](javascript:alert('hack')) e [Data URL](data:text/html;base64,PHNjcmlwdD4=) e [Link Seguro](https://arkpet.com.br)";

    const { container } = render(<AssistantMessageContent content={markdownWithDangerousLink} />);

    const links = container.querySelectorAll("a");
    // Only the secure https link should be rendered as an anchor tag
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://arkpet.com.br");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");

    // The dangerous links must not have hrefs with javascript:
    expect(container.querySelector("a[href^='javascript:']")).toBeNull();
    expect(container.querySelector("a[href^='data:']")).toBeNull();

    // Utility test
    expect(sanitizeMarkdownUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeMarkdownUrl("data:text/html,test")).toBe("");
    expect(sanitizeMarkdownUrl("https://example.com")).toBe("https://example.com");
    expect(sanitizeMarkdownUrl("/settings")).toBe("/settings");
  });

  // Test 6: Section 28 - Plain text natural rendering
  it("renders plain text naturally without degradation", () => {
    const text = "Olá! Como posso ajudar?";

    const { container } = render(<AssistantMessageContent content={text} />);

    expect(container).toHaveTextContent("Olá! Como posso ajudar?");
    const p = container.querySelector("p");
    expect(p).toBeInTheDocument();
  });

  // Test 7: Section 15 & 16 - Long identifiers and wrapping classes
  it("applies overflow-wrap and break-words classes to prevent horizontal overflow", () => {
    const longIdentifier = "Verifique o branch `/development/arkpet-r41-intelligent-assistant` para mais detalhes.";

    const { container } = render(<AssistantMessageContent content={longIdentifier} />);

    const wrapper = container.querySelector("[data-testid='assistant-markdown-content']");
    expect(wrapper).toHaveClass("break-words");
    expect(wrapper).toHaveClass("min-w-0");

    const code = container.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code).toHaveClass("break-all");
    expect(code).toHaveTextContent("/development/arkpet-r41-intelligent-assistant");
  });

  // Test 8: Section 21 & 22 - Headings, Blockquotes, and Codeblocks
  it("renders headings, blockquotes and codeblocks with compact chat-adapted typography", () => {
    const markdown = "## Configurações Gerais\n\n> Aviso importante sobre reservas.\n\n```text\nLOG DE ATIVIDADE\n```";

    const { container } = render(<AssistantMessageContent content={markdown} />);

    const h2 = container.querySelector("h2");
    expect(h2).toBeInTheDocument();
    expect(h2).toHaveTextContent("Configurações Gerais");
    expect(h2).toHaveClass("font-semibold");

    const blockquote = container.querySelector("blockquote");
    expect(blockquote).toBeInTheDocument();
    expect(blockquote).toHaveTextContent("Aviso importante sobre reservas.");
    expect(blockquote).toHaveClass("border-l-2");

    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveClass("overflow-x-auto");
  });

  // Test 9: Section 7 - Integration inside AssistantConversation (User vs Assistant roles)
  it("renders assistant messages using markdown and user messages as plain text", () => {
    const messages: AssistantUIMessage[] = [
      {
        id: "msg-user-1",
        role: "user",
        content: "Como configurar **minha creche** em `/settings`?",
        createdAt: new Date().toISOString(),
      },
      {
        id: "msg-assistant-1",
        role: "assistant",
        content: "Para configurar, siga:\n1. **Acesse as Configurações** em `/settings`.\n2. **Preencha os dados** da unidade.",
        createdAt: new Date().toISOString(),
      },
    ];

    const { container } = render(
      <AssistantConversation
        messages={messages}
        status="idle"
        screenContext={{ route: "/", feature: "dashboard", title: "Dashboard" }}
        onSendMessage={() => {}}
        onClearSession={() => {}}
      />
    );

    // User message must preserve literal string without parsing markdown
    expect(container).toHaveTextContent("Como configurar **minha creche** em `/settings`?");

    // Assistant message must render markdown without literal symbols
    const assistantContent = container.querySelector("[data-testid='assistant-markdown-content']");
    expect(assistantContent).toBeInTheDocument();
    expect(assistantContent?.querySelector("ol")).toBeInTheDocument();
    expect(assistantContent?.querySelectorAll("strong")).toHaveLength(2);
    expect(assistantContent?.querySelectorAll("code")).toHaveLength(1);
    expect(assistantContent?.textContent).not.toContain("**Acesse");
    expect(assistantContent?.textContent).not.toContain("`/settings`");
  });
});
