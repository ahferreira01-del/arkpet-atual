import { describe, it, expect, beforeEach } from "vitest";
import { AssistantKnowledgeService } from "../assistant/assistant-knowledge.service.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { ASSISTANT_CONFIG } from "../assistant/assistant.config.js";
import type { AssistantSecurityContext } from "../assistant/assistant.types.js";

describe("ArkPet R41.A — Assistant Knowledge Test Suite (AI-KNOW-001..007)", () => {
  beforeEach(() => {
    AssistantKnowledgeService.resetCache();
  });

  const context: AssistantSecurityContext = {
    userId: 1,
    role: "creche_admin",
    crecheId: 1,
    name: "Admin Tester",
    email: "admin@test.com",
    requestId: "req-know-001",
  };

  it("AI-KNOW-001: retrieves accurate knowledge regarding reservations (Hospedagem vs Day Use)", async () => {
    const results = await AssistantKnowledgeService.search("qual a diferenca entre hospedagem e day use");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe("reservations");
    expect(results[0].snippet.toLowerCase()).toContain("pernoite");
  });

  it("AI-KNOW-002: retrieves accurate knowledge regarding pet registration and requirements", async () => {
    const results = await AssistantKnowledgeService.search("como cadastrar pet dados do pet e tutor");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe("pets");
    expect(results[0].snippet.toLowerCase()).toContain("tutor");
  });

  it("AI-KNOW-003: retrieves accurate knowledge regarding in-app chat and media sharing", async () => {
    const results = await AssistantKnowledgeService.search("como funciona o chat mensagens e canais");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe("chat");
    expect(results[0].snippet.toLowerCase()).toContain("tutor");
  });

  it("AI-KNOW-004: retrieves accurate knowledge regarding operational check-in / check-out", async () => {
    const results = await AssistantKnowledgeService.search("como fazer check-in qr code");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.snippet.toLowerCase().includes("check-in") || r.snippet.toLowerCase().includes("status"))).toBe(true);
  });

  it("AI-KNOW-005: retrieves accurate knowledge regarding push and in-app notifications", async () => {
    const results = await AssistantKnowledgeService.search("como funcionam as notificacoes push e avisos");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe("notifications");
    expect(results[0].snippet.toLowerCase()).toContain("push");
  });

  it("AI-KNOW-006: retrieves accurate knowledge regarding the 4 canonical user roles", async () => {
    const results = await AssistantKnowledgeService.search("quais sao os papeis master_admin creche_admin staff tutor");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe("roles");
    expect(results[0].snippet).toContain("master_admin");
  });

  it("AI-KNOW-007: strictly refuses to invent functionality for unavailable or fictitious features (INVENTED_FEATURE_FAILURES = 0)", async () => {
    // 1. Detect non-existent feature in knowledge service
    expect(AssistantKnowledgeService.isKnownFeature("entrega de pet por drone autonomo")).toBe(false);
    expect(AssistantKnowledgeService.isKnownFeature("comunicador telepatico canino")).toBe(false);
    expect(AssistantKnowledgeService.isKnownFeature("pagamento em bitcoin")).toBe(false);

    // 2. Verified via Assistant Service response
    const response = await AssistantService.processMessage(
      "O ArkPet tem entrega de pet por drone e telepatia canina?",
      undefined,
      context
    );

    expect(response.message.content).toContain("Não encontrei essa funcionalidade no ArkPet");
    expect(response.message.content).not.toContain("Sim, o ArkPet oferece entrega por drone");
  });

  it("verifies knowledge and prompt version tagging", () => {
    expect(ASSISTANT_CONFIG.knowledgeVersion).toBe("arkpet-v32-r41");
    expect(ASSISTANT_CONFIG.promptVersion).toBe("r41-b-1");
  });
});
