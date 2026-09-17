import { describe, expect, it } from "vitest";
import {
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_LAMBDA,
  ageInDays,
  matchedTopics,
  recencyBonus,
  rerank,
  retrievalSettings,
} from "@/lib/chat/retrieval";
import { cosineSimilarity } from "@/lib/chat/embeddings";
import { fakeEmbedding } from "@/lib/chat/test-support";
import { makeTweet } from "@/lib/persona/test-support";
import { fixturePersona } from "@/lib/persona/fixture-store";

const now = new Date("2026-09-17T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("recency scoring", () => {
  it("measures age in days", () => {
    expect(ageInDays(daysAgo(10), now)).toBeCloseTo(10, 5);
  });

  it("never returns a negative age for a future post", () => {
    expect(ageInDays(daysAgo(-5), now)).toBe(0);
  });

  it("gives ~1.0 today and ~0.37 at one half-life", () => {
    expect(recencyBonus(daysAgo(0), DEFAULT_HALF_LIFE_DAYS, now)).toBeCloseTo(1, 3);
    expect(recencyBonus(daysAgo(DEFAULT_HALF_LIFE_DAYS), DEFAULT_HALF_LIFE_DAYS, now)).toBeCloseTo(
      Math.exp(-1),
      3,
    );
  });

  it("decays toward zero for very old posts", () => {
    expect(recencyBonus(daysAgo(1000), DEFAULT_HALF_LIFE_DAYS, now)).toBeLessThan(0.001);
  });
});

describe("rerank", () => {
  const options = {
    lambda: DEFAULT_LAMBDA,
    halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
    keywordBoost: 0.05,
    topics: [] as string[],
    now,
  };

  it("lets a slightly weaker but much newer post outrank a stale match", () => {
    const ranked = rerank(
      [
        { tweet: makeTweet({ id: "old", createdAt: daysAgo(900) }), semantic: 0.80 },
        { tweet: makeTweet({ id: "new", createdAt: daysAgo(1) }), semantic: 0.70 },
      ],
      options,
    );
    expect(ranked[0].tweet.id).toBe("new");
  });

  it("still ranks a clearly better old match above a weak new one", () => {
    const ranked = rerank(
      [
        { tweet: makeTweet({ id: "old", createdAt: daysAgo(900) }), semantic: 0.95 },
        { tweet: makeTweet({ id: "new", createdAt: daysAgo(1) }), semantic: 0.30 },
      ],
      options,
    );
    expect(ranked[0].tweet.id).toBe("old");
  });

  it("collapses to pure semantic order when lambda is zero", () => {
    const ranked = rerank(
      [
        { tweet: makeTweet({ id: "old", createdAt: daysAgo(900) }), semantic: 0.8 },
        { tweet: makeTweet({ id: "new", createdAt: daysAgo(1) }), semantic: 0.7 },
      ],
      { ...options, lambda: 0 },
    );
    expect(ranked.map((r) => r.tweet.id)).toEqual(["old", "new"]);
  });

  it("applies the keyword boost only to posts mentioning a card topic", () => {
    const ranked = rerank(
      [
        { tweet: makeTweet({ id: "mentions", text: "pricing is the bug" }), semantic: 0.5 },
        { tweet: makeTweet({ id: "silent", text: "unrelated musing" }), semantic: 0.5 },
      ],
      { ...options, topics: ["pricing"] },
    );
    expect(ranked[0].tweet.id).toBe("mentions");
    expect(ranked[0].keyword).toBeGreaterThan(0);
    expect(ranked[1].keyword).toBe(0);
  });

  it("reports the component scores that produced the ranking", () => {
    const [top] = rerank([{ tweet: makeTweet({ createdAt: daysAgo(0) }), semantic: 0.6 }], options);
    expect(top.semantic).toBe(0.6);
    expect(top.recency).toBeCloseTo(1, 3);
    expect(top.score).toBeCloseTo(0.6 + DEFAULT_LAMBDA, 3);
  });

  it("handles an empty candidate list", () => {
    expect(rerank([], options)).toEqual([]);
  });
});

describe("matchedTopics", () => {
  const card = fixturePersona("testfounder", 10)!.card;

  it("finds a card topic named in the question", () => {
    expect(matchedTopics("what do you think about pricing now?", card)).toContain("pricing");
  });

  it("returns nothing for a question about something off the card", () => {
    expect(matchedTopics("thoughts on the offside rule?", card)).toEqual([]);
  });

  it("is case insensitive", () => {
    expect(matchedTopics("PRICING thoughts?", card)).toContain("pricing");
  });

  it("returns nothing without a card", () => {
    expect(matchedTopics("pricing", null)).toEqual([]);
  });
});

describe("retrievalSettings", () => {
  it("uses BUILD.md defaults", () => {
    const settings = retrievalSettings({});
    expect(settings.k).toBe(12);
    expect(settings.recentN).toBe(30);
    expect(settings.lambda).toBe(0.25);
    expect(settings.halfLifeDays).toBe(45);
  });

  it("reads overrides from env", () => {
    const settings = retrievalSettings({
      RETRIEVAL_K: "8",
      RETRIEVAL_LAMBDA: "0.5",
      RETRIEVAL_HALF_LIFE_DAYS: "90",
    });
    expect(settings.k).toBe(8);
    expect(settings.lambda).toBe(0.5);
    expect(settings.halfLifeDays).toBe(90);
  });

  it("allows lambda 0 but not k 0", () => {
    expect(retrievalSettings({ RETRIEVAL_LAMBDA: "0" }).lambda).toBe(0);
    expect(retrievalSettings({ RETRIEVAL_K: "0" }).k).toBe(12);
  });

  it("ignores nonsense", () => {
    expect(retrievalSettings({ RETRIEVAL_K: "lots" }).k).toBe(12);
    expect(retrievalSettings({ RETRIEVAL_LAMBDA: "-1" }).lambda).toBe(0.25);
  });
});

describe("the deterministic test embedder", () => {
  it("scores shared vocabulary above unrelated text", () => {
    const query = fakeEmbedding("what do you think about usage-based pricing");
    const near = fakeEmbedding("usage-based pricing punishes your best customers");
    const far = fakeEmbedding("hiring ahead of revenue is a bet most founders lose");

    expect(cosineSimilarity(query, near)).toBeGreaterThan(cosineSimilarity(query, far));
  });

  it("is deterministic", () => {
    expect(fakeEmbedding("pricing")).toEqual(fakeEmbedding("pricing"));
  });

  it("returns a unit vector even for an all-stopword string", () => {
    const vector = fakeEmbedding("the and of to");
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });
});
