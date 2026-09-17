/**
 * Retrieval against real pgvector. Skipped unless DATABASE_URL is set.
 * Uses the deterministic test embedder, so it needs no API key.
 *
 *   DATABASE_URL=postgres://... pnpm db:migrate && DATABASE_URL=... pnpm test
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetHandle } from "@/lib/db/test-support";
import { saveCard, saveProfile, saveTweets } from "@/lib/persona/store";
import { backfillEmbeddings, countTweetsMissingEmbeddings } from "@/lib/persona/embed";
import { retrieveTweets } from "@/lib/chat/retrieval";
import { buildPrompt } from "@/lib/chat/system-prompt";
import { fakeEmbeddingFetch, fakeEmbeddingProvider } from "@/lib/chat/test-support";
import { fixturePersona } from "@/lib/persona/fixture-store";
import type { StoredTweet } from "@/types/persona";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const HANDLE = "frozen";
const now = new Date("2026-09-17T12:00:00.000Z");

function tweet(
  id: string,
  text: string,
  ageDays: number,
  overrides: Partial<StoredTweet> = {},
): StoredTweet {
  return {
    id,
    handle: HANDLE,
    text,
    createdAt: new Date(now.getTime() - ageDays * 86_400_000).toISOString(),
    kind: "original",
    isReply: false,
    inReplyToId: null,
    conversationId: null,
    quoteText: null,
    url: `https://x.com/${HANDLE}/status/${id}`,
    metrics: { likes: 1, replies: 0, reposts: 0, quotes: 0, views: 10 },
    ...overrides,
  };
}

/**
 * Frozen corpus. The two remote-work posts are three years apart and contradict
 * each other — that pair is BUILD.md's contradiction fixture. Everything else
 * is filler so recency has something to compete against.
 */
const corpus: StoredTweet[] = [
  tweet("old-remote", "Remote work is strictly better than any office. Nobody should commute.", 1100),
  tweet("new-remote", "Changed my mind on remote work. Junior engineers learn far slower without an office.", 20),
  tweet("old-database", "Postgres is the only database worth defaulting to for a new product.", 800),
  tweet("recent-pricing", "Pricing pages are written for the builder, not the buyer.", 2),
  tweet("recent-hiring", "Hiring ahead of revenue is a bet most founders lose badly.", 4),
  tweet("recent-onboarding", "If onboarding needs a loom video, onboarding needs a rewrite.", 6),
  tweet("recent-support", "Support tickets are free product research nobody reads.", 8),
  tweet("recent-churn", "Churn is a symptom. Activation is the disease.", 10),
];

describe.skipIf(!hasDatabase)("retrieval against pgvector", () => {
  afterAll(() => resetHandle(HANDLE));

  beforeAll(async () => {
    await resetHandle(HANDLE);

    await saveProfile({
      id: "999",
      handle: HANDLE,
      displayName: "Frozen Account",
      bio: "fixture",
      location: "",
      isProtected: false,
      isVerified: false,
      followers: 1,
      following: 1,
      statusesCount: corpus.length,
      avatarUrl: null,
      profileUrl: `https://x.com/${HANDLE}`,
      fetchedAt: now.toISOString(),
    });
    await saveTweets(corpus);

    const card = fixturePersona("testfounder", 1)!.card;
    await saveCard({
      card: { ...card, handle: HANDLE, topics: [] },
      sourceTweetIds: corpus.map((t) => t.id),
    });

    const result = await backfillEmbeddings(HANDLE, {
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });
    expect(result.embedded).toBe(corpus.length);
  });

  it("embeds every tweet exactly once and is idempotent on a second run", async () => {
    expect(await countTweetsMissingEmbeddings(HANDLE)).toBe(0);

    let calls = 0;
    const again = await backfillEmbeddings(HANDLE, {
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch({ onCall: () => (calls += 1) }),
    });

    expect(again.embedded).toBe(0);
    expect(calls).toBe(0);
  });

  it("finds an old post about an old topic", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "what is your view on remote work and the office?",
      recentN: 3,
      k: 6,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    expect(result.semanticUsed).toBe(true);
    const ids = result.retrieved.map((r) => r.tweet.id);
    // The 3-year-old post is outside the recent window and only reachable
    // semantically — this is the whole point of Phase 3.
    expect(ids).toContain("old-remote");
  });

  it("surfaces both sides of a dated contradiction", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "have you changed your mind about remote work?",
      recentN: 3,
      k: 8,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    const injected = new Set(result.injectedTweetIds);
    expect(injected.has("old-remote")).toBe(true);
    expect(injected.has("new-remote")).toBe(true);

    // Both dates must reach the prompt, or the model cannot say the view shifted.
    const { system } = buildPrompt({
      card: fixturePersona("testfounder", 1)!.card,
      tweets: result.recent,
      retrieved: result.retrieved.map((r) => r.tweet),
      recentN: 3,
    });
    expect(system).toContain(corpus[0].createdAt.slice(0, 10));
    expect(system).toContain(corpus[1].createdAt.slice(0, 10));
  });

  it("finds an old database post that recency alone would never surface", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "which database should I default to?",
      recentN: 2,
      k: 5,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    expect(result.retrieved.map((r) => r.tweet.id)).toContain("old-database");
  });

  it("returns no strong match for a question the account never posted about", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "what did you think of the offside decision in the cup final?",
      recentN: 4,
      k: 6,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    // Nothing in the corpus shares vocabulary with the question.
    const best = result.retrieved[0]?.semantic ?? 0;
    expect(best).toBeLessThan(0.2);

    // Recent posts still reach the prompt, so the reply stays in voice while
    // abstaining on substance.
    expect(result.recent).toHaveLength(4);
    expect(result.injectedTweetIds.length).toBeGreaterThanOrEqual(4);
  });

  it("never returns a recent post twice as retrieved evidence", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "pricing pages and buyers",
      recentN: 5,
      k: 8,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    const recentIds = new Set(result.recent.map((t) => t.id));
    for (const scored of result.retrieved) {
      expect(recentIds.has(scored.tweet.id)).toBe(false);
    }
    expect(new Set(result.injectedTweetIds).size).toBe(result.injectedTweetIds.length);
  });

  it("injects exactly the ids that appear in the prompt", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "remote work",
      recentN: 3,
      k: 4,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    const { system, injectedTweetIds } = buildPrompt({
      card: fixturePersona("testfounder", 1)!.card,
      tweets: result.recent,
      retrieved: result.retrieved.map((r) => r.tweet),
      recentN: 3,
    });

    for (const id of injectedTweetIds) expect(system).toContain(`[${id}]`);
    expect(injectedTweetIds.length).toBeLessThanOrEqual(3 + 4);
  });

  it("reports recency-only when the whole corpus is already current context", async () => {
    // recentN covers every post, so the vector search has nothing left to add.
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "remote work",
      recentN: corpus.length,
      k: 5,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch(),
    });

    expect(result.semanticUsed).toBe(false);
    expect(result.reason).toBe("all-candidates-already-recent");
    expect(result.recent).toHaveLength(corpus.length);
  });

  it("falls back to recency when the embeddings provider errors", async () => {
    const result = await retrieveTweets({
      handle: HANDLE,
      query: "remote work",
      recentN: 3,
      k: 4,
      now,
      provider: fakeEmbeddingProvider,
      fetchImpl: fakeEmbeddingFetch({ failWith: 500 }),
    });

    expect(result.semanticUsed).toBe(false);
    expect(result.reason).toBe("query-embedding-failed");
    expect(result.recent).toHaveLength(3);
    expect(result.retrieved).toEqual([]);
  });

  it("builds a Phase 1 shaped prompt when nothing was retrieved", async () => {
    const { system } = buildPrompt({
      card: fixturePersona("testfounder", 1)!.card,
      tweets: corpus.slice(0, 3),
      retrieved: [],
    });

    expect(system).toContain("RECENT PUBLIC POSTS");
    expect(system).not.toContain("RETRIEVED POSTS FOR THIS QUESTION");
  });

  it("adds the evidence rules once retrieval has something to show", async () => {
    const { system } = buildPrompt({
      card: fixturePersona("testfounder", 1)!.card,
      tweets: corpus.slice(0, 2),
      retrieved: [corpus[0], corpus[2]],
      recentN: 2,
    });

    expect(system).toContain("EVIDENCE");
    expect(system).toContain("CURRENT CONTEXT POSTS");
    expect(system).toContain("RETRIEVED POSTS FOR THIS QUESTION");
    expect(system).toContain("say you have no public take");
  });
});
