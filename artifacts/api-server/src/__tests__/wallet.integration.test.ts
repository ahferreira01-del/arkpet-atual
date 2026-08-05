/**
 * Wallet integration tests — WalletService.getBalance, listPackages,
 * createManualPackage, and expiry filtering.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { tutorCreditsTable } from "@workspace/db/schema";
import { WalletService } from "../services/wallet.js";
import { CreditRepository } from "../repositories/credit.repository.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";
import { createTestTutor } from "./helpers/fixtures.js";

let ctx: TestContext;

beforeAll(() => {
  ctx = getSharedCtx();
});

// ─── getBalance ───────────────────────────────────────────────────────────────

describe("WalletService.getBalance", () => {
  it("returns zero balance for a tutor with no credits", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    const balance = await WalletService.getBalance(tutor.id, ctx.crecheId);

    expect(balance.totalCredits).toBe(0);
    expect(balance.usedCredits).toBe(0);
    expect(balance.availableCredits).toBe(0);
    expect(balance.packages).toHaveLength(0);
    expect(balance.nearestExpiration).toBeNull();
  });

  it("returns correct balance after a package credit is created", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const expirationDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 10,
      usedCredits: 3,
      maxPetsPerDay: 1,
      expirationDate,
    });

    const balance = await WalletService.getBalance(tutor.id, ctx.crecheId);

    expect(balance.totalCredits).toBe(10);
    expect(balance.usedCredits).toBe(3);
    expect(balance.availableCredits).toBe(7);
    expect(balance.packages).toHaveLength(1);
    expect(balance.nearestExpiration).toBe(expirationDate);
  });

  it("aggregates multiple packages correctly", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const exp = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 5,
      usedCredits: 1,
      maxPetsPerDay: 1,
      expirationDate: exp,
    });

    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 8,
      usedCredits: 2,
      maxPetsPerDay: 1,
      expirationDate: exp,
    });

    const balance = await WalletService.getBalance(tutor.id, ctx.crecheId);

    expect(balance.totalCredits).toBe(13);   // 5 + 8
    expect(balance.usedCredits).toBe(3);     // 1 + 2
    expect(balance.availableCredits).toBe(10); // 4 + 6
    expect(balance.packages).toHaveLength(2);
  });

  it("excludes fully-used packages from the balance", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const exp = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Fully used package (should be excluded by WalletRepository which filters usedCredits < totalCredits)
    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 5,
      usedCredits: 5,
      maxPetsPerDay: 1,
      expirationDate: exp,
    });

    // Partially used package (should be included)
    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 3,
      usedCredits: 1,
      maxPetsPerDay: 1,
      expirationDate: exp,
    });

    const balance = await WalletService.getBalance(tutor.id, ctx.crecheId);

    // Only the partially-used package should appear
    expect(balance.packages).toHaveLength(1);
    expect(balance.availableCredits).toBe(2);
  });

  it("excludes expired packages from the balance", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    // Expired package
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 10,
      usedCredits: 0,
      maxPetsPerDay: 1,
      expirationDate: yesterday,
    });

    const balance = await WalletService.getBalance(tutor.id, ctx.crecheId);

    // Expired credits must not appear in the balance
    expect(balance.availableCredits).toBe(0);
    expect(balance.packages).toHaveLength(0);
  });
});

// ─── createManualPackage ──────────────────────────────────────────────────────

describe("WalletService.createManualPackage", () => {
  it("creates a package credit and returns it", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const expDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const credit = await WalletService.createManualPackage(
      ctx.crecheId,
      tutor.id,
      20,
      2,
      expDate,
      ctx.userId,
    );

    expect(credit.totalCredits).toBe(20);
    expect(credit.usedCredits).toBe(0);
    expect(credit.maxPetsPerDay).toBe(2);
    expect(credit.expirationDate).toBe(expDate);

    // Verify through getBalance
    const balance = await WalletService.getBalance(tutor.id, ctx.crecheId);
    expect(balance.availableCredits).toBe(20);
  });
});

// ─── listPackages ─────────────────────────────────────────────────────────────

describe("WalletService.listPackages", () => {
  it("returns all packages for a creche when tutorId is null", async () => {
    const { total } = await WalletService.listPackages(ctx.crecheId, null, 100, 0);
    expect(typeof total).toBe("number");
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it("scopes results to a specific tutor when tutorId is provided", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 7,
      usedCredits: 0,
      maxPetsPerDay: 1,
      expirationDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    });

    const { data, total } = await WalletService.listPackages(
      ctx.crecheId,
      tutor.id,
      100,
      0,
    );

    expect(total).toBeGreaterThanOrEqual(1);
    expect(data.every((p: any) => p.tutorId === tutor.id)).toBe(true);
  });
});
