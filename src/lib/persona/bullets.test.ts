import { describe, expect, it } from "vitest";
import { personaBullets, relativeAge } from "@/lib/persona/bullets";
import { thinFallbackCard } from "@/lib/persona/compile";
import { fixturePersona } from "@/lib/persona/fixture-store";
import type { PersonaCard } from "@/types/persona";

const rich = fixturePersona("testfounder", 100)!.card;

function thin(): PersonaCard {
  return thinFallbackCard({
    handle: "quiet",
    displayName: "Quiet Account",
    bio: "",
    profileUrl: "https://x.com/quiet",
    tweets: [],
  });
}

describe("personaBullets", () => {
  it("ranks the anti-invention bullets above humour and catchphrases", () => {
    // These two are what stop a reader trusting an answer the account never
    // earned, so they must survive the cap.
    const bullets = personaBullets(rich).join(" | ");
    expect(bullets).toContain("No public take on");
    expect(bullets).toContain("changed position on");
  });

  it("produces between 6 and 8 bullets for a rich card", () => {
    const bullets = personaBullets(rich);
    expect(bullets.length).toBeGreaterThanOrEqual(6);
    expect(bullets.length).toBeLessThanOrEqual(8);
  });

  it("never exceeds the requested maximum", () => {
    expect(personaBullets(rich, 4)).toHaveLength(4);
  });

  it("describes register, length, and disagreement style", () => {
    const bullets = personaBullets(rich).join(" | ");
    expect(bullets).toContain("bluntly");
    expect(bullets).toContain("line or two");
    expect(bullets).toContain("steelmanning");
  });

  it("names only firm takes as firm", () => {
    const bullets = personaBullets(rich).join(" | ");
    expect(bullets).toContain("Firm public takes on");
    // usage-based pricing sits at 0.71 and is firm; nothing below 0.7 exists here.
    const belowThreshold = rich.topics.filter((t) => t.confidence < 0.7);
    for (const topic of belowThreshold) {
      expect(bullets).not.toContain(`Firm public takes on ${topic.name}`);
    }
  });

  it("surfaces a publicly changed position", () => {
    expect(personaBullets(rich).join(" | ")).toContain("changed position on usage-based pricing");
  });

  it("surfaces what the account has no take on", () => {
    expect(personaBullets(rich).join(" | ")).toContain("No public take on");
  });

  it("says so plainly when the record is thin", () => {
    expect(personaBullets(thin()).join(" | ")).toContain("Thin public record");
  });

  it("still produces bullets for an empty card without throwing", () => {
    expect(personaBullets(thin()).length).toBeGreaterThan(0);
  });

  it("uses no forbidden copy", () => {
    const banned = ["soul", "clone of the real", "indistinguishable", "really them"];
    const text = [...personaBullets(rich), ...personaBullets(thin())].join(" ").toLowerCase();
    for (const phrase of banned) expect(text).not.toContain(phrase);
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("reads recent compiles as just now", () => {
    expect(relativeAge(ago(30_000), now)).toBe("just now");
  });

  it("counts minutes, hours, and days", () => {
    expect(relativeAge(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(relativeAge(ago(60 * 60_000), now)).toBe("1 hour ago");
    expect(relativeAge(ago(3 * 3600_000), now)).toBe("3 hours ago");
    expect(relativeAge(ago(50 * 3600_000), now)).toBe("2 days ago");
  });

  it("does not print a negative age for a future timestamp", () => {
    expect(relativeAge(new Date(now.getTime() + 10_000).toISOString(), now)).toBe("just now");
  });

  it("handles an unparseable timestamp", () => {
    expect(relativeAge("nonsense", now)).toBe("just now");
  });
});
