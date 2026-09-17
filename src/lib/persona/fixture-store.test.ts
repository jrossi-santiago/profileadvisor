import { describe, expect, it } from "vitest";
import { personaCardSchema } from "@/lib/persona/schema";
import { fixturePersona, hasFixturePersona } from "@/lib/persona/fixture-store";
import { buildPrompt } from "@/lib/chat/system-prompt";

describe("fixture persona", () => {
  it("serves only the synthetic handle", () => {
    expect(hasFixturePersona("testfounder")).toBe(true);
    expect(hasFixturePersona("naval")).toBe(false);
    expect(fixturePersona("naval", 10)).toBeNull();
  });

  it("holds a card that survives the real schema", () => {
    const persona = fixturePersona("testfounder", 40);
    expect(persona).not.toBeNull();
    const result = personaCardSchema.safeParse(persona!.card);
    expect(result.success).toBe(true);
  });

  it("only cites evidence ids that exist in its own tweets", () => {
    const persona = fixturePersona("testfounder", 100)!;
    const ids = new Set(persona.tweets.map((t) => t.id));
    for (const topic of persona.card.topics) {
      for (const evidenceId of topic.evidenceIds) {
        expect(ids.has(evidenceId)).toBe(true);
      }
    }
  });

  it("returns tweets newest first and respects the limit", () => {
    const persona = fixturePersona("testfounder", 5)!;
    expect(persona.tweets).toHaveLength(5);
    const dates = persona.tweets.map((t) => t.createdAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it("builds a usable prompt end to end", () => {
    const persona = fixturePersona("testfounder", 40)!;
    const { system, injectedTweetIds } = buildPrompt({
      card: persona.card,
      tweets: persona.tweets,
    });

    expect(system).toContain("@testfounder");
    expect(system).toContain("You are NOT that person");
    expect(injectedTweetIds.length).toBeGreaterThan(0);
  });

  it("records the documented contradiction with both dated sides", () => {
    const persona = fixturePersona("testfounder", 100)!;
    const [contradiction] = persona.card.contradictions;
    expect(contradiction.topic).toBe("usage-based pricing");
    expect(contradiction.olderId).toBeTruthy();
    expect(contradiction.newerId).toBeTruthy();
  });
});
