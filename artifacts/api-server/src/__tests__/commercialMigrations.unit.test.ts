import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionsTable, crechesTable } from "@workspace/db/schema";

const mockDbExecute = vi.fn().mockResolvedValue([]);

vi.mock("@workspace/db", () => ({
  db: {
    execute: (...args: any[]) => mockDbExecute(...args),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../lib/stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripePublishableKey: vi.fn(),
  getStripeSecretKey: vi.fn(),
  getStripeSync: vi.fn(),
}));

import { ensureCommercialFoundationSchema } from "../startup.js";

describe("Commercial Migrations and Schema Evolution Unit Characterization (R36.F1 Section 3, 4, 5, 6, 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("proves startup DDL executes ALTER COLUMN creche_id DROP NOT NULL on commercial_operation_requests (Section 3)", async () => {
    await ensureCommercialFoundationSchema();

    expect(mockDbExecute).toHaveBeenCalled();
    const ddlCalls = mockDbExecute.mock.calls.map((c) => String(c[0])).join("\n");

    expect(ddlCalls).toMatch(/ALTER\s+TABLE\s+commercial_operation_requests\s+ALTER\s+COLUMN\s+creche_id\s+DROP\s+NOT\s+NULL/i);
    expect(ddlCalls).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+commercial_operation_requests\s*\(\s*id\s+SERIAL\s+PRIMARY\s+KEY,\s*creche_id\s+INTEGER,/i);
  });

  it("proves startup DDL replaces legacy unpredicated idempotency index with tenant-scoped and global-scoped indexes (Section 4)", async () => {
    await ensureCommercialFoundationSchema();

    const ddlCalls = mockDbExecute.mock.calls.map((c) => String(c[0])).join("\n");

    // Proves legacy unpredicated index is safely dropped if found without WHERE
    expect(ddlCalls).toContain("DROP INDEX commercial_operation_requests_creche_idempotency_unique");
    expect(ddlCalls).toContain("indexdef NOT LIKE '%WHERE%'");

    // Proves tenant-scoped unique index is created with WHERE creche_id IS NOT NULL
    expect(ddlCalls).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+commercial_operation_requests_creche_idempotency_unique\s+ON\s+commercial_operation_requests\s*\(creche_id,\s*idempotency_key\)\s+WHERE\s+creche_id\s+IS\s+NOT\s+NULL/i,
    );

    // Proves global unique index is created with WHERE creche_id IS NULL
    expect(ddlCalls).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+commercial_operation_requests_global_idempotency_unique\s+ON\s+commercial_operation_requests\s*\(idempotency_key\)\s+WHERE\s+creche_id\s+IS\s+NULL/i,
    );
  });

  it("proves startup DDL safely drops and replaces obsolete singleActiveCampaignIdx predicate (Section 5)", async () => {
    await ensureCommercialFoundationSchema();

    const ddlCalls = mockDbExecute.mock.calls.map((c) => String(c[0])).join("\n");

    // Proves obsolete index predicate missing restoration_review or pending_activation is dropped
    expect(ddlCalls).toContain("DROP INDEX assigned_commercial_benefits_single_active_idx");
    expect(ddlCalls).toContain("indexdef NOT LIKE '%restoration_review%'");
    expect(ddlCalls).toContain("indexdef NOT LIKE '%pending_activation%'");

    // Proves full R36.F1 non-stacking predicate is created
    expect(ddlCalls).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+assigned_commercial_benefits_single_active_idx\s+ON\s+assigned_commercial_benefits\s*\(creche_id\)\s+WHERE\s+status\s+IN\s*\('pending',\s*'pending_activation',\s*'scheduled',\s*'active',\s*'restoration_review'\)/i,
    );
  });

  it("proves startup DDL defines all campaign tables, columns, and snapshot coordinates (Section 9, 10)", async () => {
    await ensureCommercialFoundationSchema();

    const ddlCalls = mockDbExecute.mock.calls.map((c) => String(c[0])).join("\n");

    expect(ddlCalls).toContain("CREATE TABLE IF NOT EXISTS commercial_campaigns");
    expect(ddlCalls).toContain("CREATE TABLE IF NOT EXISTS commercial_campaign_benefits");
    expect(ddlCalls).toContain("CREATE TABLE IF NOT EXISTS assigned_commercial_benefits");
    expect(ddlCalls).toContain("CREATE TABLE IF NOT EXISTS benefit_cycle_consumptions");

    // Preserves entitlement_pet_limit column
    expect(ddlCalls).toMatch(/ALTER\s+TABLE\s+assigned_commercial_benefits\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+entitlement_pet_limit\s+INTEGER/i);

    // Canonical cycle uniqueness
    expect(ddlCalls).toContain("benefit_cycle_consumptions_assigned_cycle_key_unique");
  });

  it("verifies single activeConditionId pointer authority belongs strictly to subscriptionsTable (Section 6)", () => {
    // subscriptionsTable must have activeConditionId
    expect(subscriptionsTable.activeConditionId).toBeDefined();

    // crechesTable must NOT have activeConditionId (fail-closed architecture)
    expect((crechesTable as any).activeConditionId).toBeUndefined();
  });
});
