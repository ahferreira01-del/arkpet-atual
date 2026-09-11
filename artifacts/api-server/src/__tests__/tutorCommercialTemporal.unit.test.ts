import { describe, it, expect } from "vitest";
import {
  checkIntervalOverlap,
  isConditionActive,
} from "../services/tutorCommercialPricing.js";

describe("TutorCommercialPricing - Temporal & Overlap Rules Unit Tests (R37.B)", () => {
  describe("1. checkIntervalOverlap — Half-Open Interval Semantics [validFrom, validUntil)", () => {
    it("detects genuine temporal overlap between two bounded intervals", () => {
      // A: Jan 1 to Jan 15; B: Jan 10 to Jan 20
      const aStart = new Date("2026-01-01T00:00:00Z");
      const aEnd = new Date("2026-01-15T00:00:00Z");
      const bStart = new Date("2026-01-10T00:00:00Z");
      const bEnd = new Date("2026-01-20T00:00:00Z");

      expect(checkIntervalOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
      expect(checkIntervalOverlap(bStart, bEnd, aStart, aEnd)).toBe(true);
    });

    it("permits adjacent intervals where A.validUntil === B.validFrom (zero overlap)", () => {
      // Adjacent boundary: A ends Jan 10 00:00, B starts Jan 10 00:00
      const aStart = new Date("2026-01-01T00:00:00Z");
      const aEnd = new Date("2026-01-10T00:00:00Z");
      const bStart = new Date("2026-01-10T00:00:00Z");
      const bEnd = new Date("2026-01-20T00:00:00Z");

      expect(checkIntervalOverlap(aStart, aEnd, bStart, bEnd)).toBe(false);
      expect(checkIntervalOverlap(bStart, bEnd, aStart, aEnd)).toBe(false);
    });

    it("detects overlap when first interval is open-ended (validUntil = null)", () => {
      // A: Jan 1 onwards (null end); B: Feb 1 to Feb 15
      const aStart = new Date("2026-01-01T00:00:00Z");
      const aEnd = null;
      const bStart = new Date("2026-02-01T00:00:00Z");
      const bEnd = new Date("2026-02-15T00:00:00Z");

      expect(checkIntervalOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
      expect(checkIntervalOverlap(bStart, bEnd, aStart, aEnd)).toBe(true);
    });

    it("detects overlap when both intervals are open-ended", () => {
      const aStart = new Date("2026-01-01T00:00:00Z");
      const aEnd = null;
      const bStart = new Date("2026-06-01T00:00:00Z");
      const bEnd = null;

      expect(checkIntervalOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
    });

    it("returns false for completely disjoint intervals", () => {
      // A: Jan 1 to Jan 5; B: Jan 10 to Jan 15
      const aStart = new Date("2026-01-01T00:00:00Z");
      const aEnd = new Date("2026-01-05T00:00:00Z");
      const bStart = new Date("2026-01-10T00:00:00Z");
      const bEnd = new Date("2026-01-15T00:00:00Z");

      expect(checkIntervalOverlap(aStart, aEnd, bStart, bEnd)).toBe(false);
    });
  });

  describe("2. isConditionActive — Point-in-Time Condition State", () => {
    it("identifies ACTIVE condition when time is between validFrom and validUntil", () => {
      const cond: any = {
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2026-01-31T00:00:00Z"),
      };

      const midTime = new Date("2026-01-15T12:00:00Z");
      expect(isConditionActive(cond, midTime)).toBe(true);
    });

    it("returns false if point-in-time is before validFrom (SCHEDULED)", () => {
      const cond: any = {
        status: "SCHEDULED",
        validFrom: new Date("2026-02-01T00:00:00Z"),
        validUntil: new Date("2026-02-28T00:00:00Z"),
      };

      const now = new Date("2026-01-15T12:00:00Z");
      expect(isConditionActive(cond, now)).toBe(false);
    });

    it("returns false if point-in-time is after validUntil (EXPIRED)", () => {
      const cond: any = {
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2026-01-10T00:00:00Z"),
      };

      const later = new Date("2026-01-11T00:00:00Z");
      expect(isConditionActive(cond, later)).toBe(false);
    });

    it("returns true for open-ended condition when time is after validFrom", () => {
      const cond: any = {
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: null,
      };

      const muchLater = new Date("2028-05-20T00:00:00Z");
      expect(isConditionActive(cond, muchLater)).toBe(true);
    });

    it("returns false if condition status is REVOKED or SUPERSEDED regardless of dates", () => {
      const revoked: any = {
        status: "REVOKED",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: null,
      };
      const superseded: any = {
        status: "SUPERSEDED",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: null,
      };

      const now = new Date("2026-01-15T00:00:00Z");
      expect(isConditionActive(revoked, now)).toBe(false);
      expect(isConditionActive(superseded, now)).toBe(false);
    });
  });
});
