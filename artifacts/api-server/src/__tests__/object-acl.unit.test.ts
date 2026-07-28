/**
 * Unit tests — Object ACL: photo access after owner/role changes
 *
 * Covers the three key scenarios from task #41:
 *   1. The uploader (owner) can read their own file.
 *   2. An unrelated user from a different creche is denied (403 equivalent).
 *   3. A creche admin / staff member of the same creche can read the file
 *      even when they are not the uploader.
 *
 * Also verifies:
 *   4. Public files are readable without authentication.
 *   5. A file with no ACL policy is always denied.
 *   6. A deactivated user is denied even if they are in the right creche.
 *
 * The DB and GCS File are mocked so these tests run without real infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { canAccessObject, ObjectPermission, ObjectAccessGroupType } from "../lib/objectAcl.js";
import type { ObjectAclPolicy } from "../lib/objectAcl.js";
import type { File } from "@google-cloud/storage";

// ---------------------------------------------------------------------------
// Mock @workspace/db so CrecheMemberAccessGroup.hasMember() is interceptable
// ---------------------------------------------------------------------------

// Rows returned by the mocked DB query — keyed by userId
let mockDbRows: Array<{ id: number }> = [];

vi.mock("@workspace/db", () => {
  // Minimal drizzle-like chainable mock
  const makeChain = (rows: () => Array<{ id: number }>) => ({
    select: () => makeChain(rows),
    from: () => makeChain(rows),
    where: () => makeChain(rows),
    limit: () => Promise.resolve(rows()),
  });

  return {
    db: makeChain(() => mockDbRows),
    usersTable: { id: "id", crecheId: "creche_id", isActive: "is_active" },
  };
});

// Also mock drizzle-orm helpers used inside objectAcl.ts so the import doesn't
// fail in the test environment (no real DB connection needed).
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Mock the schema export (usersTable) so the shape is accepted by drizzle mocks
vi.mock("@workspace/db/schema", () => ({
  usersTable: {
    id: "id",
    crecheId: "creche_id",
    isActive: "is_active",
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal GCS File mock whose getMetadata resolves with the given
 * ACL policy embedded in custom metadata (or with no metadata when null).
 */
function mockFile(aclPolicy: ObjectAclPolicy | null): File {
  const metadataValue =
    aclPolicy !== null ? JSON.stringify(aclPolicy) : undefined;

  return {
    getMetadata: vi.fn().mockResolvedValue([
      {
        metadata: metadataValue
          ? { "custom:aclPolicy": metadataValue }
          : undefined,
      },
    ]),
    exists: vi.fn().mockResolvedValue([true]),
    name: "test-object",
  } as unknown as File;
}

/** ACL policy tied to owner "user-1" with a CRECHE_MEMBER rule for creche 42 */
function privateFilePolicy(ownerId = "1", crecheId = "42"): ObjectAclPolicy {
  return {
    owner: ownerId,
    visibility: "private",
    aclRules: [
      {
        group: { type: ObjectAccessGroupType.CRECHE_MEMBER, id: crecheId },
        permission: ObjectPermission.READ,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset DB mock state before each test
  mockDbRows = [];
});

describe("canAccessObject — owner access", () => {
  it("owner can read their own private file", async () => {
    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: "1",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("owner can write their own private file", async () => {
    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: "1",
      objectFile: file,
      requestedPermission: ObjectPermission.WRITE,
    });
    expect(result).toBe(true);
  });
});

describe("canAccessObject — stranger access", () => {
  it("user from a different creche is denied READ", async () => {
    // DB returns empty — user-99 is not in creche 42
    mockDbRows = [];

    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: "99",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });

  it("unauthenticated request is denied READ on private file", async () => {
    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: undefined,
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });
});

describe("canAccessObject — creche member access", () => {
  it("creche admin of the same creche can read a file uploaded by a tutor", async () => {
    // DB returns a row — user-5 is an active member of creche 42
    mockDbRows = [{ id: 5 }];

    const file = mockFile(privateFilePolicy("1", "42")); // owner is user-1
    const result = await canAccessObject({
      userId: "5", // different user, same creche
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("staff member of the same creche can read the file", async () => {
    mockDbRows = [{ id: 7 }];

    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: "7",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("creche member cannot WRITE (only READ permission granted by rule)", async () => {
    mockDbRows = [{ id: 5 }];

    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: "5",
      objectFile: file,
      requestedPermission: ObjectPermission.WRITE,
    });
    // Rule grants READ only; owner check also fails (5 ≠ 1)
    expect(result).toBe(false);
  });

  it("deactivated user is denied even if they were once a creche member", async () => {
    // DB returns empty — inactive user excluded by isActive filter
    mockDbRows = [];

    const file = mockFile(privateFilePolicy("1", "42"));
    const result = await canAccessObject({
      userId: "6",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });
});

describe("canAccessObject — public file", () => {
  it("public file is readable without authentication", async () => {
    const file = mockFile({ owner: "1", visibility: "public" });
    const result = await canAccessObject({
      userId: undefined,
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(true);
  });

  it("public file WRITE still requires being the owner", async () => {
    const file = mockFile({ owner: "1", visibility: "public" });
    const resultStranger = await canAccessObject({
      userId: "99",
      objectFile: file,
      requestedPermission: ObjectPermission.WRITE,
    });
    expect(resultStranger).toBe(false);

    const resultOwner = await canAccessObject({
      userId: "1",
      objectFile: file,
      requestedPermission: ObjectPermission.WRITE,
    });
    expect(resultOwner).toBe(true);
  });
});

describe("canAccessObject — missing ACL policy", () => {
  it("file with no ACL policy metadata is always denied", async () => {
    const file = mockFile(null);
    const result = await canAccessObject({
      userId: "1",
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    expect(result).toBe(false);
  });
});
