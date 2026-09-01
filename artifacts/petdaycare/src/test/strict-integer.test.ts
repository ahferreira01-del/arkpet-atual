import { describe, it, expect } from "vitest";
import { parseStrictInteger } from "@/lib/utils";

describe("parseStrictInteger Unit Matrix Suite (R33M.B1 - FORM-R33M-001)", () => {
  it("parses valid positive and zero unsigned integers", () => {
    expect(parseStrictInteger("0")).toBe(0);
    expect(parseStrictInteger("1")).toBe(1);
    expect(parseStrictInteger("12")).toBe(12);
    expect(parseStrictInteger("01")).toBe(1);
    expect(parseStrictInteger(" 2 ")).toBe(2);
    expect(parseStrictInteger(42)).toBe(42);
  });

  it("handles signed integers when allowNegative is enabled", () => {
    expect(parseStrictInteger("-1", { allowNegative: true })).toBe(-1);
    expect(parseStrictInteger("-5", { allowNegative: true })).toBe(-5);
    expect(parseStrictInteger("+5", { allowNegative: true })).toBeNull();
    expect(parseStrictInteger("5", { allowNegative: true })).toBe(5);
    expect(parseStrictInteger("0", { allowNegative: true })).toBe(0);
  });

  it("rejects negative numbers when allowNegative is false or omitted", () => {
    expect(parseStrictInteger("-1")).toBeNull();
    expect(parseStrictInteger("-1", { allowNegative: false })).toBeNull();
  });

  it("rejects decimal numbers completely (no prefix truncation)", () => {
    expect(parseStrictInteger("1.9")).toBeNull();
    expect(parseStrictInteger("1.5")).toBeNull();
    expect(parseStrictInteger("2.01")).toBeNull();
    expect(parseStrictInteger("1,5")).toBeNull();
    expect(parseStrictInteger("0.0")).toBeNull();
  });

  it("rejects scientific notation completely (no prefix truncation to 1 or silent 100)", () => {
    expect(parseStrictInteger("1e2")).toBeNull();
    expect(parseStrictInteger("2e1")).toBeNull();
    expect(parseStrictInteger("1e-1")).toBeNull();
    expect(parseStrictInteger("1E2")).toBeNull();
  });

  it("rejects alpha suffixes and malformed strings (no parseInt substring consumption)", () => {
    expect(parseStrictInteger("100px")).toBeNull();
    expect(parseStrictInteger("12abc")).toBeNull();
    expect(parseStrictInteger("abc")).toBeNull();
    expect(parseStrictInteger("1 2")).toBeNull();
  });

  it("rejects empty, null, and undefined values", () => {
    expect(parseStrictInteger("")).toBeNull();
    expect(parseStrictInteger("   ")).toBeNull();
    expect(parseStrictInteger(null)).toBeNull();
    expect(parseStrictInteger(undefined)).toBeNull();
  });

  it("enforces min and max range boundaries", () => {
    expect(parseStrictInteger("5", { min: 1, max: 10 })).toBe(5);
    expect(parseStrictInteger("1", { min: 1, max: 10 })).toBe(1);
    expect(parseStrictInteger("10", { min: 1, max: 10 })).toBe(10);
    expect(parseStrictInteger("0", { min: 1, max: 10 })).toBeNull();
    expect(parseStrictInteger("11", { min: 1, max: 10 })).toBeNull();
    expect(parseStrictInteger("32", { min: 1, max: 31 })).toBeNull();
  });
});
