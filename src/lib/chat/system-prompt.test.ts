import { describe, expect, it } from "vitest";
import { buildPrompt, recentTweetLimit, DEFAULT_RECENT_TWEETS } from "@/lib/chat/system-prompt";
import { makeTweet, makeTweets } from "@/lib/persona/test-support";
import { thinFallbackCard } from "@/lib/persona/compile";
import type { PersonaCard } from "@/types/persona";

function card(overrides: Partial<PersonaCard> = {}): PersonaCard {
  const base = thinFallbackCard({
    handle: "testfounder",
    displayName: "Test Founder",
    bio: "Building things. Opinions are posts, not advice.",
    profileUrl: "https://x.com/testfounder",
    tweets: [],
  });

  return {
    ...base,
    thinRecord: false,
    voice: {
      register: "blunt",
      avgLength: "short",
      humor: "dry",
      disagreementStyle: "steelman",
      signaturePhrases: ["ship it"],
      avoids: ["engagement bait"],
    },
    topics: [
      {
        name: "pricing",
        stance: "Pricing pages are written for builders, not buyers.",
        side: "against",
        confidence: 0.82,
        lastSeen: "2026-09-15T00:00:00.000Z",
        evidenceIds: ["t-0"],
      },
    ],
    currentContext: {
      last14dThemes: ["pricing"],
      activeFights: ["the seed round discourse"],
      mood: "impatient",
    },
    unknowns: ["their view on monetary policy"],
    ...overrides,
  };
}

describe("buildPrompt — required disclosures", () => {
  it("names the handle and the display name", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(5) });
    expect(system).toContain("@testfounder");
    expect(system).toContain("Test Founder");
  });

  it("states that this is a simulation and not the person", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(5) });
    expect(system).toContain("You are NOT that person");
    expect(system).toMatch(/AI simulation based on public posts/);
  });

  it("carries the no-invention and abstain rules", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(5) });
    expect(system).toContain("no public take");
    expect(system).toContain("Do not invent biography");
    expect(system).toContain("Never claim to be them");
  });

  it("tells the model to prefer recent posts over old ones", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(5) });
    expect(system).toContain("Prefer recent posts");
    expect(system).toContain("CURRENT CONTEXT");
  });
});

describe("buildPrompt — content", () => {
  it("includes the card's stated positions with confidence", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(3) });
    expect(system).toContain("pricing");
    expect(system).toContain("0.82");
    expect(system).toContain("against");
  });

  it("lists known unknowns so the model can abstain by name", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(3) });
    expect(system).toContain("their view on monetary policy");
  });

  it("formats each tweet as [id] [date] [kind] text", () => {
    const tweets = [makeTweet({ id: "t-9", createdAt: "2026-09-15T13:44:55.000Z" })];
    const { system } = buildPrompt({ card: card(), tweets });
    expect(system).toContain("[t-9] [2026-09-15] [original]");
  });

  it("shows the quoted post's text alongside a quote tweet", () => {
    const tweets = [makeTweet({ kind: "quote", quoteText: "Seed rounds are a tax on impatience" })];
    const { system } = buildPrompt({ card: card(), tweets });
    expect(system).toContain("quoting:");
    expect(system).toContain("Seed rounds are a tax on impatience");
  });

  it("warns the model when the record is thin", () => {
    const { system } = buildPrompt({ card: card({ thinRecord: true }), tweets: makeTweets(4) });
    expect(system).toContain("THIN RECORD");
    expect(system).toContain("do not manufacture a personality");
  });

  it("omits the thin-record warning for a full corpus", () => {
    const { system } = buildPrompt({ card: card(), tweets: makeTweets(40) });
    expect(system).not.toContain("THIN RECORD");
  });

  it("tells a model with no extracted topics to lean on the posts and abstain", () => {
    const { system } = buildPrompt({ card: card({ topics: [] }), tweets: makeTweets(4) });
    expect(system).toContain("no clear positions extracted");
  });
});

describe("buildPrompt — tweet selection", () => {
  it("injects only the newest N and reports their ids", () => {
    const { injectedTweetIds } = buildPrompt({
      card: card(),
      tweets: makeTweets(100),
      recentN: 40,
    });

    expect(injectedTweetIds).toHaveLength(40);
    expect(injectedTweetIds[0]).toBe("t-0");
    expect(injectedTweetIds).not.toContain("t-40");
  });

  it("sorts newest-first even when handed tweets out of order", () => {
    const shuffled = [...makeTweets(10)].reverse();
    const { injectedTweets } = buildPrompt({ card: card(), tweets: shuffled, recentN: 3 });

    const dates = injectedTweets.map((t) => t.createdAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
    expect(injectedTweets[0].id).toBe("t-0");
  });

  it("reports ids that match the tweets actually in the prompt", () => {
    const { system, injectedTweetIds } = buildPrompt({
      card: card(),
      tweets: makeTweets(50),
      recentN: 5,
    });

    for (const id of injectedTweetIds) expect(system).toContain(`[${id}]`);
    expect(system).not.toContain("[t-20]");
  });

  it("handles an empty corpus without throwing", () => {
    const { system, injectedTweetIds } = buildPrompt({ card: card(), tweets: [] });
    expect(injectedTweetIds).toEqual([]);
    expect(system).toContain("@testfounder");
  });
});

describe("recentTweetLimit", () => {
  it("defaults to 40", () => {
    expect(recentTweetLimit({})).toBe(DEFAULT_RECENT_TWEETS);
  });

  it("reads an override from env", () => {
    expect(recentTweetLimit({ CHAT_RECENT_TWEETS: "12" })).toBe(12);
  });

  it("ignores nonsense values", () => {
    expect(recentTweetLimit({ CHAT_RECENT_TWEETS: "banana" })).toBe(40);
    expect(recentTweetLimit({ CHAT_RECENT_TWEETS: "-5" })).toBe(40);
  });
});
