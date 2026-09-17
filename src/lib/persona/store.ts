/**
 * Persistence for profiles, tweets, cards, threads, and the cost ledger.
 *
 * When DATABASE_URL is absent the store falls back to checked-in fixtures so
 * the UI can be developed and screenshotted without a database. The fallback is
 * read-only and only ever serves fixture handles — it can never mask a broken
 * write path for a real account.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { messages, personaCards, profiles, threads, tweets, usageEvents } from "@/lib/db/schema";
import { canonicalHandle } from "@/lib/x/handle";
import { fixturePersona, hasFixturePersona } from "@/lib/persona/fixture-store";
import type { PersonaCard, StoredTweet } from "@/types/persona";
import type { XProfile } from "@/lib/x/getxapi";

export type StoredPersona = {
  card: PersonaCard;
  tweets: StoredTweet[];
  compiledAt: string;
  tweetCountUsed: number;
  source: "database" | "fixture";
};

function rowToTweet(row: typeof tweets.$inferSelect): StoredTweet {
  return {
    id: row.id,
    handle: row.handle,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    kind: row.kind,
    isReply: row.isReply,
    inReplyToId: row.inReplyToId,
    conversationId: row.conversationId,
    quoteText: row.quoteText,
    url: row.url,
    metrics: row.metrics,
  };
}

export async function saveProfile(profile: XProfile): Promise<void> {
  const db = getDb();
  const handle = canonicalHandle(profile.handle);

  await db
    .insert(profiles)
    .values({
      handle,
      userId: profile.id,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      isProtected: profile.isProtected,
      followers: profile.followers,
      fetchedAt: new Date(profile.fetchedAt),
    })
    .onConflictDoUpdate({
      target: profiles.handle,
      set: {
        userId: profile.id,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        isProtected: profile.isProtected,
        followers: profile.followers,
        fetchedAt: new Date(profile.fetchedAt),
      },
    });
}

export async function saveTweets(incoming: StoredTweet[]): Promise<number> {
  if (incoming.length === 0) return 0;
  const db = getDb();

  // Metrics drift as a post ages, so a re-ingest refreshes them rather than
  // skipping a row it has seen before.
  await db
    .insert(tweets)
    .values(
      incoming.map((tweet) => ({
        id: tweet.id,
        handle: tweet.handle,
        text: tweet.text,
        createdAt: new Date(tweet.createdAt),
        kind: tweet.kind,
        isReply: tweet.isReply,
        inReplyToId: tweet.inReplyToId,
        conversationId: tweet.conversationId,
        quoteText: tweet.quoteText,
        url: tweet.url,
        metrics: tweet.metrics,
      })),
    )
    .onConflictDoUpdate({
      target: tweets.id,
      set: { metrics: sql`excluded.metrics`, text: sql`excluded.text` },
    });

  return incoming.length;
}

export async function saveCard(input: {
  card: PersonaCard;
  sourceTweetIds: string[];
  compileError?: string;
}): Promise<void> {
  const db = getDb();
  const handle = canonicalHandle(input.card.handle);
  const row = {
    handle,
    card: input.card,
    compiledAt: new Date(input.card.compiledAt),
    tweetCountUsed: input.card.tweetCountUsed,
    thinRecord: input.card.thinRecord,
    sourceTweetIds: input.sourceTweetIds,
    compileError: input.compileError ?? null,
  };

  await db.insert(personaCards).values(row).onConflictDoUpdate({
    target: personaCards.handle,
    set: row,
  });
}

export async function loadPersona(
  handleInput: string,
  recentN: number,
): Promise<StoredPersona | null> {
  const handle = canonicalHandle(handleInput);

  if (!isDatabaseConfigured()) {
    return hasFixturePersona(handle) ? fixturePersona(handle, recentN) : null;
  }

  const db = getDb();
  const [cardRow] = await db
    .select()
    .from(personaCards)
    .where(eq(personaCards.handle, handle))
    .limit(1);

  if (!cardRow) return null;

  const tweetRows = await db
    .select()
    .from(tweets)
    .where(eq(tweets.handle, handle))
    .orderBy(desc(tweets.createdAt))
    .limit(recentN);

  return {
    card: cardRow.card,
    tweets: tweetRows.map(rowToTweet),
    compiledAt: cardRow.compiledAt.toISOString(),
    tweetCountUsed: cardRow.tweetCountUsed,
    source: "database",
  };
}

export async function recordUsage(event: {
  kind: "ingest" | "compile" | "chat" | "jev";
  units: number;
  costUsd: number;
  handle?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  // The cost log is always printed: it is the number BUILD.md asks to watch,
  // and it must survive a session with no database configured.
  console.info(
    `[usage] kind=${event.kind} handle=${event.handle ?? "-"} units=${event.units} cost=$${event.costUsd.toFixed(4)}`,
  );

  if (!isDatabaseConfigured()) return;

  await getDb()
    .insert(usageEvents)
    .values({
      id: crypto.randomUUID(),
      kind: event.kind,
      units: event.units,
      costUsd: event.costUsd,
      handle: event.handle ? canonicalHandle(event.handle) : null,
      detail: event.detail ?? null,
    });
}

// --- threads -----------------------------------------------------------------

export async function ensureThread(threadId: string, handle: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await getDb()
    .insert(threads)
    .values({ id: threadId, handle: canonicalHandle(handle) })
    .onConflictDoNothing();
}

export async function saveMessage(input: {
  threadId: string;
  role: "user" | "assistant";
  content: string;
  injectedTweetIds?: string[];
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await getDb()
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      injectedTweetIds: input.injectedTweetIds ?? [],
    });
}

export async function loadThreadMessages(threadId: string, handle: string) {
  if (!isDatabaseConfigured()) return [];
  const db = getDb();
  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.handle, canonicalHandle(handle))))
    .limit(1);

  if (!thread) return [];

  return db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
}
