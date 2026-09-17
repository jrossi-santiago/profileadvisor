/**
 * Evidence retrieval for a chat turn.
 *
 * Two sets go into the prompt and they do different jobs:
 *   - current context: the newest N posts, always included, so the simulation
 *     knows what this account is on about *now* even when the question is old
 *   - retrieved: semantic matches for this question, so a specific question
 *     about 2023 finds the 2023 post without stuffing the whole corpus
 *
 * Retrieved candidates are reranked with a recency bonus:
 *
 *   score = semantic + lambda * exp(-ageDays / halfLife)
 *
 * so a slightly weaker but much newer post can outrank a stale exact match —
 * which is what "prefer recent posts" means in practice. A keyword boost is
 * added when the question names a topic the card already knows about.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { tweets } from "@/lib/db/schema";
import { canonicalHandle } from "@/lib/x/handle";
import {
  embedOne,
  isEmbeddingsConfigured,
  resolveEmbeddingProvider,
  type EmbeddingConfig,
} from "@/lib/chat/embeddings";
import type { EnvLike } from "@/types/env";
import type { PersonaCard, StoredTweet } from "@/types/persona";

export const DEFAULT_K = 12;
export const DEFAULT_RECENT_N = 30;
export const DEFAULT_LAMBDA = 0.25;
export const DEFAULT_HALF_LIFE_DAYS = 45;
export const DEFAULT_KEYWORD_BOOST = 0.05;

function numberFromEnv(raw: string | undefined, fallback: number, allowZero = true): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return fallback;
  if (value === 0 && !allowZero) return fallback;
  return value;
}

export function retrievalSettings(env: EnvLike = process.env) {
  return {
    k: Math.floor(numberFromEnv(env.RETRIEVAL_K, DEFAULT_K, false)),
    recentN: Math.floor(numberFromEnv(env.RETRIEVAL_RECENT_N, DEFAULT_RECENT_N, false)),
    lambda: numberFromEnv(env.RETRIEVAL_LAMBDA, DEFAULT_LAMBDA),
    halfLifeDays: numberFromEnv(
      env.RETRIEVAL_HALF_LIFE_DAYS,
      DEFAULT_HALF_LIFE_DAYS,
      false,
    ),
    keywordBoost: numberFromEnv(env.RETRIEVAL_KEYWORD_BOOST, DEFAULT_KEYWORD_BOOST),
  };
}

export function ageInDays(createdAt: string, now: Date): number {
  const ms = now.getTime() - new Date(createdAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86_400_000) : 0;
}

/** exp(-ageDays / halfLife): 1.0 today, ~0.37 at one half-life, →0 after. */
export function recencyBonus(createdAt: string, halfLifeDays: number, now: Date): number {
  return Math.exp(-ageInDays(createdAt, now) / halfLifeDays);
}

/**
 * Topics from the card that the question names. Used for the keyword boost —
 * it only ever fires on topics the account actually posted about, so it cannot
 * invent relevance for something outside the corpus.
 */
export function matchedTopics(query: string, card?: PersonaCard | null): string[] {
  if (!card) return [];
  const haystack = query.toLowerCase();
  return card.topics
    .map((topic) => topic.name)
    .filter((name) => name.length >= 3 && haystack.includes(name.toLowerCase()));
}

export type ScoredTweet = {
  tweet: StoredTweet;
  semantic: number;
  recency: number;
  keyword: number;
  score: number;
};

export function rerank(
  candidates: Array<{ tweet: StoredTweet; semantic: number }>,
  options: {
    lambda: number;
    halfLifeDays: number;
    keywordBoost: number;
    topics: string[];
    now: Date;
  },
): ScoredTweet[] {
  const topics = options.topics.map((t) => t.toLowerCase());

  return candidates
    .map(({ tweet, semantic }) => {
      const recency = recencyBonus(tweet.createdAt, options.halfLifeDays, options.now);
      const text = `${tweet.text} ${tweet.quoteText ?? ""}`.toLowerCase();
      const hits = topics.filter((topic) => text.includes(topic)).length;
      const keyword = hits > 0 ? options.keywordBoost : 0;

      return {
        tweet,
        semantic,
        recency,
        keyword,
        score: semantic + options.lambda * recency + keyword,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export type RetrievalResult = {
  /** Newest posts, always in the prompt. */
  recent: StoredTweet[];
  /** Semantic matches for this question, reranked, excluding `recent`. */
  retrieved: ScoredTweet[];
  /** Every tweet id put into the prompt, recent first. */
  injectedTweetIds: string[];
  /**
   * True only when retrieved evidence actually reached the caller. A vector
   * search that ran but found nothing outside the recent window is not
   * "semantic" in any way the prompt can use.
   */
  semanticUsed: boolean;
  reason?: string;
};

function rowToTweet(row: {
  id: string;
  handle: string;
  text: string;
  createdAt: Date;
  kind: StoredTweet["kind"];
  isReply: boolean;
  inReplyToId: string | null;
  conversationId: string | null;
  quoteText: string | null;
  url: string;
  metrics: StoredTweet["metrics"];
}): StoredTweet {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

const TWEET_COLUMNS = {
  id: tweets.id,
  handle: tweets.handle,
  text: tweets.text,
  createdAt: tweets.createdAt,
  kind: tweets.kind,
  isReply: tweets.isReply,
  inReplyToId: tweets.inReplyToId,
  conversationId: tweets.conversationId,
  quoteText: tweets.quoteText,
  url: tweets.url,
  metrics: tweets.metrics,
};

/**
 * Retrieves evidence for one user message.
 *
 * With no embeddings configured, or no vectors stored yet, this returns recent
 * posts only and says so via `semanticUsed: false`. The caller keeps working —
 * that is exactly the Phase 1–2 behaviour, not an error.
 */
export async function retrieveTweets(input: {
  handle: string;
  query: string;
  card?: PersonaCard | null;
  k?: number;
  recentN?: number;
  now?: Date;
  provider?: EmbeddingConfig;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<RetrievalResult> {
  const handle = canonicalHandle(input.handle);
  const settings = retrievalSettings();
  const k = input.k ?? settings.k;
  const recentN = input.recentN ?? settings.recentN;
  const now = input.now ?? new Date();

  if (!isDatabaseConfigured()) {
    return { recent: [], retrieved: [], injectedTweetIds: [], semanticUsed: false, reason: "no-database" };
  }

  const db = getDb();

  const recentRows = await db
    .select(TWEET_COLUMNS)
    .from(tweets)
    .where(eq(tweets.handle, handle))
    .orderBy(sql`${tweets.createdAt} desc`)
    .limit(recentN);

  const recent = recentRows.map(rowToTweet);
  const recentIds = new Set(recent.map((t) => t.id));

  const fallback = (reason: string): RetrievalResult => ({
    recent,
    retrieved: [],
    injectedTweetIds: recent.map((t) => t.id),
    semanticUsed: false,
    reason,
  });

  if (!input.provider && !isEmbeddingsConfigured()) return fallback("no-embeddings-provider");
  if (!input.query.trim()) return fallback("empty-query");

  let queryVector: number[];
  try {
    const provider = input.provider ?? resolveEmbeddingProvider();
    queryVector = await embedOne(provider, input.query, {
      fetchImpl: input.fetchImpl,
      signal: input.signal,
    });
  } catch (error) {
    console.warn("[retrieval] embedding the query failed; falling back to recency", error);
    return fallback("query-embedding-failed");
  }

  // Over-fetch so the rerank has room to reorder, and so posts already in the
  // recent set do not crowd out the semantic slots.
  const candidateLimit = Math.max(k * 3, k + recentN);
  const literal = `[${queryVector.join(",")}]`;

  const candidateRows = await db
    .select({
      ...TWEET_COLUMNS,
      distance: sql<number>`${tweets.embedding} <=> ${literal}::vector`,
    })
    .from(tweets)
    .where(and(eq(tweets.handle, handle), isNotNull(tweets.embedding)))
    .orderBy(sql`${tweets.embedding} <=> ${literal}::vector`)
    .limit(candidateLimit);

  if (candidateRows.length === 0) return fallback("no-embeddings-stored");

  const candidates = candidateRows
    .filter((row) => !recentIds.has(row.id))
    .map((row) => ({
      tweet: rowToTweet(row),
      // pgvector cosine distance is 1 - cosine similarity.
      semantic: 1 - Number(row.distance),
    }));

  const retrieved = rerank(candidates, {
    lambda: settings.lambda,
    halfLifeDays: settings.halfLifeDays,
    keywordBoost: settings.keywordBoost,
    topics: matchedTopics(input.query, input.card),
    now,
  }).slice(0, k);

  // A small corpus can sit entirely inside the recent window, leaving the
  // vector search with nothing to add. That is recency-only in practice.
  if (retrieved.length === 0) return fallback("all-candidates-already-recent");

  return {
    recent,
    retrieved,
    injectedTweetIds: [...recent.map((t) => t.id), ...retrieved.map((r) => r.tweet.id)],
    semanticUsed: true,
  };
}
