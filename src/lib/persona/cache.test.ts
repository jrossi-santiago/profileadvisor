import { describe, expect, it } from "vitest";
import { DEFAULT_CACHE_HOURS, cacheWindowMs, decideCache } from "@/lib/persona/cache";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-09-17T12:00:00.000Z");
const windowMs = DEFAULT_CACHE_HOURS * HOUR;

function ago(hours: number): string {
  return new Date(now.getTime() - hours * HOUR).toISOString();
}

describe("cacheWindowMs", () => {
  it("defaults to 24 hours", () => {
    expect(cacheWindowMs({})).toBe(24 * HOUR);
  });

  it("reads an override", () => {
    expect(cacheWindowMs({ COMPILE_CACHE_HOURS: "1" })).toBe(HOUR);
  });

  it("allows zero to disable caching", () => {
    expect(cacheWindowMs({ COMPILE_CACHE_HOURS: "0" })).toBe(0);
  });

  it("ignores nonsense", () => {
    expect(cacheWindowMs({ COMPILE_CACHE_HOURS: "soon" })).toBe(24 * HOUR);
    expect(cacheWindowMs({ COMPILE_CACHE_HOURS: "-3" })).toBe(24 * HOUR);
  });
});

describe("decideCache", () => {
  it("misses when there is no card", () => {
    const decision = decideCache({ compiledAt: null, now, windowMs });
    expect(decision).toEqual({ hit: false, reason: "no-card" });
  });

  it("hits inside the window", () => {
    const decision = decideCache({ compiledAt: ago(3), now, windowMs });
    expect(decision.hit).toBe(true);
    if (decision.hit) expect(decision.ageMs).toBe(3 * HOUR);
  });

  it("hits just under 24h", () => {
    expect(decideCache({ compiledAt: ago(23.9), now, windowMs }).hit).toBe(true);
  });

  it("misses just past 24h", () => {
    const decision = decideCache({ compiledAt: ago(24.1), now, windowMs });
    expect(decision.hit).toBe(false);
    if (!decision.hit) expect(decision.reason).toBe("stale");
  });

  it("misses when refresh is requested, however fresh the card", () => {
    const decision = decideCache({ compiledAt: ago(0.1), refresh: true, now, windowMs });
    expect(decision.hit).toBe(false);
    if (!decision.hit) {
      expect(decision.reason).toBe("refresh-requested");
      expect(decision.compiledAt).toBeTruthy();
    }
  });

  it("recompiles a card dated in the future rather than trusting the clock", () => {
    const decision = decideCache({ compiledAt: ago(-5), now, windowMs });
    expect(decision.hit).toBe(false);
    if (!decision.hit) expect(decision.reason).toBe("stale");
  });

  it("treats an unparseable date as no card", () => {
    const decision = decideCache({ compiledAt: "whenever", now, windowMs });
    expect(decision).toEqual({ hit: false, reason: "no-card" });
  });

  it("never hits when the window is zero", () => {
    expect(decideCache({ compiledAt: ago(0), now, windowMs: 0 }).hit).toBe(false);
  });
});
