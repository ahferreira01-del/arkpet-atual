import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AssistantService } from "../assistant/assistant.service.js";
import type { AssistantSecurityContext, AssistantRole } from "../assistant/assistant.types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const evalsPath = path.join(currentDir, "assistant-evals.json");
const evalCases: Array<{
  id: string;
  role: AssistantRole;
  category: string;
  query: string;
  expectedContains: string[];
  forbiddenContains: string[];
}> = JSON.parse(fs.readFileSync(evalsPath, "utf-8"));

describe("ArkPet R41.A — Golden Evaluation Dataset (52 Cases)", () => {
  it("verifies the evaluation dataset contains at least 50 test cases across 4 roles", () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(50);

    const roles = new Set(evalCases.map((c) => c.role));
    expect(roles.has("master_admin")).toBe(true);
    expect(roles.has("creche_admin")).toBe(true);
    expect(roles.has("staff")).toBe(true);
    expect(roles.has("tutor")).toBe(true);
  });

  for (const testCase of evalCases) {
    it(`evaluates ${testCase.id} [${testCase.role}]: "${testCase.query.slice(0, 45)}"`, async () => {
      const context: AssistantSecurityContext = {
        userId: testCase.role === "tutor" ? 50 : 10,
        role: testCase.role,
        crecheId: testCase.role === "master_admin" ? null : 1,
        name: `User ${testCase.role}`,
        email: `${testCase.role}@test.com`,
        requestId: `eval-${testCase.id}`,
      };

      const result = await AssistantService.processMessage(
        testCase.query,
        undefined,
        context
      );

      const content = result.message.content.toLowerCase();

      // Check expected keywords (case-insensitive)
      for (const expected of testCase.expectedContains) {
        expect(content).toContain(expected.toLowerCase());
      }

      // Check forbidden keywords (case-insensitive)
      for (const forbidden of testCase.forbiddenContains) {
        expect(content).not.toContain(forbidden.toLowerCase());
      }
    });
  }
});
