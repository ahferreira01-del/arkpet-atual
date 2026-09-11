import { describe, it, expect } from "vitest";
import { isCampaignActive } from "../services/crecheCampaignPricing.js";

describe("crecheCampaignPricing - Temporal Window Contract", () => {
  const startAt = new Date("2026-10-01T00:00:00.000Z");
  const endAt = new Date("2026-10-15T00:00:00.000Z");

  it("should be inactive before validFrom (scheduled)", () => {
    const beforeStart = new Date("2026-09-30T23:59:59.999Z");
    const active = isCampaignActive(
      { status: "ACTIVE", validFrom: startAt, validUntil: endAt },
      beforeStart
    );
    expect(active).toBe(false);
  });

  it("should be active exactly at validFrom (start inclusive)", () => {
    const active = isCampaignActive(
      { status: "ACTIVE", validFrom: startAt, validUntil: endAt },
      startAt
    );
    expect(active).toBe(true);
  });

  it("should be active during the window", () => {
    const midWindow = new Date("2026-10-07T12:00:00.000Z");
    const active = isCampaignActive(
      { status: "ACTIVE", validFrom: startAt, validUntil: endAt },
      midWindow
    );
    expect(active).toBe(true);
  });

  it("should be active one millisecond before validUntil", () => {
    const justBeforeEnd = new Date(endAt.getTime() - 1);
    const active = isCampaignActive(
      { status: "ACTIVE", validFrom: startAt, validUntil: endAt },
      justBeforeEnd
    );
    expect(active).toBe(true);
  });

  it("should be inactive exactly at validUntil (end exclusive contract)", () => {
    const active = isCampaignActive(
      { status: "ACTIVE", validFrom: startAt, validUntil: endAt },
      endAt
    );
    expect(active).toBe(false);
  });

  it("should be inactive after validUntil (expired)", () => {
    const afterEnd = new Date("2026-10-15T00:00:01.000Z");
    const active = isCampaignActive(
      { status: "ACTIVE", validFrom: startAt, validUntil: endAt },
      afterEnd
    );
    expect(active).toBe(false);
  });

  it("should be inactive if status is PAUSED, even within time window", () => {
    const midWindow = new Date("2026-10-07T12:00:00.000Z");
    const active = isCampaignActive(
      { status: "PAUSED", validFrom: startAt, validUntil: endAt },
      midWindow
    );
    expect(active).toBe(false);
  });

  it("should be inactive if status is REVOKED or DRAFT, even within time window", () => {
    const midWindow = new Date("2026-10-07T12:00:00.000Z");
    expect(
      isCampaignActive(
        { status: "REVOKED", validFrom: startAt, validUntil: endAt },
        midWindow
      )
    ).toBe(false);

    expect(
      isCampaignActive(
        { status: "DRAFT", validFrom: startAt, validUntil: endAt },
        midWindow
      )
    ).toBe(false);

    expect(
      isCampaignActive(
        { status: "ENDED", validFrom: startAt, validUntil: endAt },
        midWindow
      )
    ).toBe(false);
  });
});
