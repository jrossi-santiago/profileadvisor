/**
 * Ingest pipeline: handle in, stored profile + tweets + compiled card out.
 *
 * Every failure mode here is a user-facing message, not a stack trace: the
 * handle does not exist, the account is protected, or it has nothing public to
 * build a voice from. An empty clone is never an acceptable result.
 */

import type { EnvLike } from "@/types/env";
import { GetXApiClient, GetXApiError, readConfigFromEnv } from "@/lib/x/getxapi";
import { parseHandleOrUrl } from "@/lib/x/handle";
import { compilePersona } from "@/lib/persona/compile";
import { loadCard, recordUsage, saveCard, saveProfile, saveTweets } from "@/lib/persona/store";
import { decideCache } from "@/lib/persona/cache";
import { backfillEmbeddings } from "@/lib/persona/embed";
import { isDatabaseConfigured } from "@/lib/db";
import type { PersonaCard } from "@/types/persona";

/** Phase 2 cap. BUILD.md's default target is 300–500. */
export const DEFAULT_TWEET_CAP = 400;
export const DEFAULT_MAX_PAGES = 25;

/** Progress states surfaced to the UI while an ingest runs. */
export type CompileState = "cached" | "fetching" | "compiling" | "ready" | "failed";

/**
 * The wire contract for streamed progress. `ready` carries the summary rather
 * than the whole card so the streamed and plain-JSON responses agree.
 */
export type ProgressEvent =
  | { state: "cached"; handle: string; compiledAt: string }
  | { state: "fetching"; handle: string }
  | { state: "compiling"; handle: string; tweetCountUsed: number }
  | ({ state: "ready" } & PersonaSummaryWire)
  | { state: "failed"; code: IngestFailure["code"]; error: string };

export type PersonaSummaryWire = {
  handle: string;
  displayName: string;
  tweetCountUsed: number;
  thinRecord: boolean;
  compiled: boolean;
  compileError: string | null;
  pagesFetched: number;
  estimatedCostUsd: number;
  persisted: boolean;
  cached: boolean;
};

/** Drops the card, which no caller of the HTTP API needs. */
export function toWireSummary(summary: IngestSummary): PersonaSummaryWire {
  return {
    handle: summary.handle,
    displayName: summary.displayName,
    tweetCountUsed: summary.tweetCountUsed,
    thinRecord: summary.thinRecord,
    compiled: summary.compiled,
    compileError: summary.compileError ?? null,
    pagesFetched: summary.pagesFetched,
    estimatedCostUsd: summary.estimatedCostUsd,
    persisted: summary.persisted,
    cached: summary.cached,
  };
}

export type IngestSummary = {
  handle: string;
  displayName: string;
  card: PersonaCard;
  tweetCountUsed: number;
  droppedRetweets: number;
  thinRecord: boolean;
  compiled: boolean;
  compileError?: string;
  pagesFetched: number;
  estimatedCostUsd: number;
  persisted: boolean;
  /** True when the 24h cache served this and no upstream call was made. */
  cached: boolean;
};

export type IngestFailure = {
  code: "invalid-handle" | "not-found" | "protected" | "no-substance" | "upstream" | "not-configured";
  message: string;
};

export class IngestError extends Error {
  readonly code: IngestFailure["code"];
  constructor(failure: IngestFailure) {
    super(failure.message);
    this.name = "IngestError";
    this.code = failure.code;
  }
}

export function tweetCap(env: EnvLike = process.env): number {
  const raw = Number(env.X_TWEET_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TWEET_CAP;
}

export function maxPages(env: EnvLike = process.env): number {
  const raw = Number(env.X_MAX_PAGES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_PAGES;
}

/** Replies are read unless explicitly turned off. */
export function includeReplies(env: EnvLike = process.env): boolean {
  return env.X_INCLUDE_REPLIES?.trim().toLowerCase() !== "false";
}

export async function ingestAndCompile(
  handleOrUrl: string,
  options: { refresh?: boolean; onProgress?: (event: ProgressEvent) => void } = {},
): Promise<IngestSummary> {
  const emit = options.onProgress ?? (() => {});
  const parsed = parseHandleOrUrl(handleOrUrl);
  if (!parsed.ok) {
    throw new IngestError({ code: "invalid-handle", message: parsed.message });
  }

  // Check the cache before touching a paid endpoint.
  const existing = await loadCard(parsed.handle).catch(() => null);
  const decision = decideCache({
    compiledAt: existing?.compiledAt,
    refresh: options.refresh,
  });

  if (decision.hit && existing) {
    console.info(
      `[compile] cache hit handle=${parsed.handle} compiledAt=${decision.compiledAt} ageH=${(decision.ageMs / 3_600_000).toFixed(1)}`,
    );
    emit({ state: "cached", handle: existing.card.handle, compiledAt: decision.compiledAt });

    return {
      handle: existing.card.handle,
      displayName: existing.card.displayName,
      card: existing.card,
      tweetCountUsed: existing.tweetCountUsed,
      droppedRetweets: 0,
      thinRecord: existing.thinRecord,
      compiled: true,
      pagesFetched: 0,
      estimatedCostUsd: 0,
      persisted: true,
      cached: true,
    };
  }

  // decision.hit with no stored card means the row vanished between the two
  // reads; treat it as a miss with no card.
  const missReason = decision.hit ? "no-card" : decision.reason;
  console.info(
    `[compile] cache miss handle=${parsed.handle} reason=${missReason} cap=${tweetCap()} maxPages=${maxPages()}`,
  );
  emit({ state: "fetching", handle: parsed.handle });

  let client: GetXApiClient;
  try {
    client = new GetXApiClient(readConfigFromEnv());
  } catch (error) {
    throw new IngestError({
      code: "not-configured",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let result: Awaited<ReturnType<GetXApiClient["ingest"]>>;
  try {
    result = await client.ingest(parsed.handle, {
      cap: tweetCap(),
      maxPages: maxPages(),
      includeReplies: includeReplies(),
    });
  } catch (error) {
    if (error instanceof GetXApiError) {
      const code =
        error.code === "not-found" || error.code === "protected" ? error.code : "upstream";
      throw new IngestError({ code, message: error.message });
    }
    throw error;
  }

  await recordUsage({
    kind: "ingest",
    units: result.pagesFetched,
    costUsd: result.estimatedCostUsd,
    handle: result.profile.handle,
    detail: {
      usableTweets: result.usableCount,
      droppedRetweets: result.droppedRetweets,
      apiCalls: result.apiCalls,
      cap: tweetCap(),
      maxPages: maxPages(),
      fromTimeline: result.bySource.tweets,
      fromReplies: result.bySource.tweets_and_replies,
    },
  });

  if (result.usableCount === 0) {
    throw new IngestError({
      code: "no-substance",
      message: `@${result.profile.handle} has no public posts of their own to build a voice from${
        result.droppedRetweets > 0 ? " — the timeline is retweets only." : "."
      }`,
    });
  }

  const persisted = isDatabaseConfigured();
  if (persisted) {
    await saveProfile(result.profile);
    await saveTweets(result.tweets);
  }

  emit({
    state: "compiling",
    handle: result.profile.handle,
    tweetCountUsed: result.usableCount,
  });

  const outcome = await compilePersona({
    handle: result.profile.handle,
    displayName: result.profile.displayName,
    bio: result.profile.bio,
    profileUrl: result.profile.profileUrl,
    tweets: result.tweets,
  });

  await recordUsage({
    kind: "compile",
    units: 1,
    costUsd: 0,
    handle: result.profile.handle,
    detail: { compiled: outcome.compiled, error: outcome.error ?? null },
  });

  if (persisted) {
    await saveCard({
      card: outcome.card,
      sourceTweetIds: outcome.sourceTweetIds,
      compileError: outcome.error,
    });

    // Embed the new corpus so the first chat turn already has evidence to
    // retrieve. Failure here is not fatal: retrieval degrades to recency.
    const embedded = await backfillEmbeddings(result.profile.handle).catch((error) => {
      console.warn("[ingest] embedding backfill failed", error);
      return null;
    });
    if (embedded && !embedded.skipped && embedded.embedded > 0) {
      await recordUsage({
        kind: "embed",
        units: embedded.embedded,
        costUsd: 0,
        handle: result.profile.handle,
        detail: { batches: embedded.batches, remaining: embedded.remaining },
      });
    }
  }

  return {
    handle: result.profile.handle,
    displayName: result.profile.displayName,
    card: outcome.card,
    tweetCountUsed: result.usableCount,
    droppedRetweets: result.droppedRetweets,
    thinRecord: outcome.card.thinRecord,
    compiled: outcome.compiled,
    compileError: outcome.error,
    pagesFetched: result.pagesFetched,
    estimatedCostUsd: result.estimatedCostUsd,
    persisted,
    cached: false,
  };
}
