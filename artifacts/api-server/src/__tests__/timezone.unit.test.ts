import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getBusinessDate } from "../lib/date.js";

describe("Timezone Tests", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("should return the same day at 20:59 (BRT is UTC-3)", () => {
    // 20:59 BRT = 23:59 UTC
    vi.setSystemTime(new Date("2026-08-10T23:59:00Z"));
    expect(getBusinessDate()).toBe("2026-08-10");
  });

  it("should return the same day at 21:00 (BRT is UTC-3, UTC is next day)", () => {
    // 21:00 BRT = 00:00 UTC next day
    vi.setSystemTime(new Date("2026-08-11T00:00:00Z"));
    expect(getBusinessDate()).toBe("2026-08-10");
  });

  it("should return the same day at 23:59 (BRT is UTC-3, UTC is next day)", () => {
    // 23:59 BRT = 02:59 UTC next day
    vi.setSystemTime(new Date("2026-08-11T02:59:00Z"));
    expect(getBusinessDate()).toBe("2026-08-10");
  });

  it("should return the next day at 00:00 (BRT is UTC-3, UTC is next day)", () => {
    // 00:00 BRT next day = 03:00 UTC
    vi.setSystemTime(new Date("2026-08-11T03:00:00Z"));
    expect(getBusinessDate()).toBe("2026-08-11");
  });
});
