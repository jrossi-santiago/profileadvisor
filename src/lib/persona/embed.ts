/**
 * Embedding backfill. Idempotent by construction: it only ever selects rows
 * whose `embedding` is null, so re-running it is a no-op and a partial failure
 * simply leaves work for the next run.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { tweets } from "@/lib/db/schema";
import {
  embedBatch,
  embeddingInput,
  isEmbeddingsConfigured,
  resolveEmbeddingProvider,
  type EmbeddingConfig,
} from "@/lib/chat/embeddings";
import { canonicalHandle } from "@/lib/x/handle";
import type { EnvLike } from "@/types/env";

/** Inputs per embeddings request. Providers cap both count and total tokens. */
export const DEFAULT_EMBED_BATCH = 96;

export function embedBatchSize(env: EnvLike = process.env): number {
  const raw = Number(env.EMBEDDING_BATCH_SIZE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_EMBED_BATCH;
}

export type BackfillResult = {
  embedded: number;
  remaining: number;
  batches: number;
  skipped: boolean;
  error?: string;
};

/**
 * Embeds tweets for one handle that do not yet have a vector.
 *
 * Never throws for a missing provider — retrieval degrades to recency-only, and
 * a chat turn must not fail because embeddings are unconfigured.
 */
export async function backfillEmbeddings(
  handleInput: string,
  options: {
    limit?: number;
    provider?: EmbeddingConfig;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<BackfillResult> {
  const handle = canonicalHandle(handleInput);

  if (!isDatabaseConfigured()) {
    return { embedded: 0, remaining: 0, batches: 0, skipped: true, error: "No database." };
  }
  if (!options.provider && !isEmbeddingsConfigured()) {
    return {
      embedded: 0,
      remaining: await countMissing(handle),
      batches: 0,
      skipped: true,
      error: "No embeddings provider.",
    };
  }

  const provider = options.provider ?? resolveEmbeddingProvider();
  const db = getDb();
  const batchSize = embedBatchSize();
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  let embedded = 0;
  let batches = 0;

  while (embedded < limit) {
    const take = Math.min(batchSize, limit - embedded);
    const pending = await db
      .select({
        id: tweets.id,
        text: tweets.text,
        kind: tweets.kind,
        createdAt: tweets.createdAt,
        quoteText: tweets.quoteText,
      })
      .from(tweets)
      .where(and(eq(tweets.handle, handle), isNull(tweets.embedding)))
      .limit(take);

    if (pending.length === 0) break;

    let vectors: number[][];
    try {
      vectors = await embedBatch(
        provider,
        pending.map((row) =>
          embeddingInput({
            text: row.text,
            kind: row.kind,
            createdAt: row.createdAt.toISOString(),
            quoteText: row.quoteText,
          }),
        ),
        { fetchImpl: options.fetchImpl, signal: options.signal },
      );
    } catch (error) {
      // Partial progress is kept; the next run picks up what is still null.
      return {
        embedded,
        remaining: await countMissing(handle),
        batches,
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const embeddedAt = new Date();
    for (let i = 0; i < pending.length; i += 1) {
      await db
        .update(tweets)
        .set({ embedding: vectors[i], embeddedAt })
        .where(eq(tweets.id, pending[i].id));
    }

    embedded += pending.length;
    batches += 1;
    if (pending.length < take) break;
  }

  const remaining = await countMissing(handle);
  console.info(
    `[embed] handle=${handle} embedded=${embedded} batches=${batches} remaining=${remaining}`,
  );

  return { embedded, remaining, batches, skipped: false };
}

async function countMissing(handle: string): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(tweets)
    .where(and(eq(tweets.handle, handle), isNull(tweets.embedding)));
  return row?.count ?? 0;
}

export { countMissing as countTweetsMissingEmbeddings };
