/**
 * Exercises the real store against a real Postgres. Skipped unless
 * DATABASE_URL is set, so the default suite stays offline.
 *
 *   createdb talkto && DATABASE_URL=postgres://... pnpm db:migrate
 *   DATABASE_URL=postgres://... pnpm test
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages, personaCards, profiles, threads, tweets, usageEvents } from "@/lib/db/schema";
import { decideCache } from "@/lib/persona/cache";
import {
  ensureThread,
  loadCard,
  loadPersona,
  loadThreadMessages,
  recordUsage,
  saveCard,
  saveMessage,
  saveProfile,
  saveTweets,
} from "@/lib/persona/store";
import { fixturePersona } from "@/lib/persona/fixture-store";
import { buildPrompt } from "@/lib/chat/system-prompt";
import type { XProfile } from "@/lib/x/getxapi";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

const profile: XProfile = {
  id: "745273",
  // Deliberately mixed case: the store must canonicalize it.
  handle: "TestFounder",
  displayName: "Test Founder",
  bio: "Building things. Opinions are posts, not advice.",
  location: "SF",
  isProtected: false,
  isVerified: true,
  followers: 48211,
  following: 812,
  statusesCount: 14022,
  avatarUrl: "https://example.com/a.jpg",
  profileUrl: "https://x.com/testfounder",
  fetchedAt: new Date().toISOString(),
};

describe.skipIf(!hasDatabase)("store against a real database", () => {
  const persona = fixturePersona("testfounder", 100)!;

  async function truncateAll() {
    const db = getDb();
    await db.execute(
      sql`truncate ${messages}, ${threads}, ${personaCards}, ${tweets}, ${profiles}, ${usageEvents}`,
    );
  }

  beforeAll(truncateAll);
  afterAll(truncateAll);

  it("saves a profile and canonicalizes the handle", async () => {
    await saveProfile(profile);
    const rows = await getDb().select().from(profiles);
    expect(rows).toHaveLength(1);
    expect(rows[0].handle).toBe("testfounder");
    expect(rows[0].displayName).toBe("Test Founder");
  });

  it("is idempotent on a re-ingest of the same profile", async () => {
    await saveProfile({ ...profile, followers: 50000 });
    const rows = await getDb().select().from(profiles);
    expect(rows).toHaveLength(1);
    expect(rows[0].followers).toBe(50000);
  });

  it("stores tweets and refreshes metrics on conflict", async () => {
    expect(await saveTweets(persona.tweets)).toBe(persona.tweets.length);

    const bumped = persona.tweets.map((t) => ({
      ...t,
      metrics: { ...t.metrics, likes: t.metrics.likes + 1000 },
    }));
    await saveTweets(bumped);

    const rows = await getDb().select().from(tweets);
    expect(rows).toHaveLength(persona.tweets.length);
    const first = rows.find((r) => r.id === persona.tweets[0].id);
    expect(first?.metrics.likes).toBe(persona.tweets[0].metrics.likes + 1000);
  });

  it("round-trips a persona card through jsonb", async () => {
    await saveCard({ card: persona.card, sourceTweetIds: persona.tweets.map((t) => t.id) });

    const loaded = await loadPersona("TestFounder", 40);
    expect(loaded).not.toBeNull();
    expect(loaded!.source).toBe("database");
    expect(loaded!.card.handle).toBe("testfounder");
    expect(loaded!.card.topics[0].name).toBe(persona.card.topics[0].name);
    expect(loaded!.card.contradictions[0].olderId).toBe(persona.card.contradictions[0].olderId);
  });

  it("returns tweets newest-first and honours the limit", async () => {
    const loaded = await loadPersona("testfounder", 5);
    expect(loaded!.tweets).toHaveLength(5);
    const dates = loaded!.tweets.map((t) => t.createdAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it("builds a grounded prompt from what came back out of the database", async () => {
    const loaded = await loadPersona("testfounder", 40);
    const { system, injectedTweetIds } = buildPrompt({
      card: loaded!.card,
      tweets: loaded!.tweets,
    });

    expect(system).toContain("@testfounder");
    expect(system).toContain("You are NOT that person");
    expect(injectedTweetIds.length).toBeGreaterThan(0);
    for (const id of injectedTweetIds) expect(system).toContain(`[${id}]`);
  });

  it("returns null for a handle that was never compiled", async () => {
    expect(await loadPersona("someoneelse", 40)).toBeNull();
  });

  it("persists a thread with its injected tweet ids", async () => {
    const threadId = crypto.randomUUID();
    await ensureThread(threadId, "TestFounder");
    await ensureThread(threadId, "TestFounder"); // must not conflict
    await saveMessage({ threadId, role: "user", content: "did your view change?" });
    await saveMessage({
      threadId,
      role: "assistant",
      content: "Yes. Capped now.",
      injectedTweetIds: ["fix-017", "fix-018"],
    });

    const history = await loadThreadMessages(threadId, "testfounder");
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history[1].injectedTweetIds).toEqual(["fix-017", "fix-018"]);
  });

  it("writes the cost ledger", async () => {
    await recordUsage({
      kind: "ingest",
      units: 3,
      costUsd: 0.004,
      handle: "TestFounder",
      detail: { pages: 3 },
    });

    const rows = await getDb().select().from(usageEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("ingest");
    expect(rows[0].handle).toBe("testfounder");
    expect(rows[0].costUsd).toBeCloseTo(0.004, 5);
  });
});

describe.skipIf(!hasDatabase)("compile cache against a real database", () => {
  const persona = fixturePersona("testfounder", 100)!;

  beforeAll(async () => {
    await getDb().execute(
      sql`truncate ${messages}, ${threads}, ${personaCards}, ${tweets}, ${profiles}, ${usageEvents}`,
    );
    await saveProfile(profile);
    await saveTweets(persona.tweets);
  });

  it("reports no card before anything is compiled", async () => {
    expect(await loadCard("testfounder")).toBeNull();
    expect(decideCache({ compiledAt: null }).hit).toBe(false);
  });

  it("hits the cache for a card compiled just now", async () => {
    await saveCard({
      card: { ...persona.card, compiledAt: new Date().toISOString() },
      sourceTweetIds: persona.tweets.map((t) => t.id),
    });

    const stored = await loadCard("testfounder");
    expect(stored).not.toBeNull();
    expect(decideCache({ compiledAt: stored!.compiledAt }).hit).toBe(true);
  });

  it("misses for a card compiled 25 hours ago", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await saveCard({
      card: { ...persona.card, compiledAt: stale },
      sourceTweetIds: persona.tweets.map((t) => t.id),
    });

    const stored = await loadCard("testfounder");
    const decision = decideCache({ compiledAt: stored!.compiledAt });
    expect(decision.hit).toBe(false);
    if (!decision.hit) expect(decision.reason).toBe("stale");
  });

  it("misses when refresh is requested on a fresh card", async () => {
    await saveCard({
      card: { ...persona.card, compiledAt: new Date().toISOString() },
      sourceTweetIds: persona.tweets.map((t) => t.id),
    });

    const stored = await loadCard("testfounder");
    const decision = decideCache({ compiledAt: stored!.compiledAt, refresh: true });
    expect(decision.hit).toBe(false);
    if (!decision.hit) expect(decision.reason).toBe("refresh-requested");
  });

  it("moves compiledAt forward on a recompile", async () => {
    const before = (await loadCard("testfounder"))!.compiledAt;
    await new Promise((resolve) => setTimeout(resolve, 10));

    await saveCard({
      card: { ...persona.card, compiledAt: new Date().toISOString() },
      sourceTweetIds: persona.tweets.map((t) => t.id),
    });

    const after = (await loadCard("testfounder"))!.compiledAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());

    // A recompile replaces the row rather than accumulating cards.
    const rows = await getDb().select().from(personaCards);
    expect(rows).toHaveLength(1);
  });
});
