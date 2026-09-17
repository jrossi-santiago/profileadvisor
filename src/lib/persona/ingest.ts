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
import { recordUsage, saveCard, saveProfile, saveTweets } from "@/lib/persona/store";
import { isDatabaseConfigured } from "@/lib/db";
import type { PersonaCard } from "@/types/persona";

/** Phase 1 cap. Phase 2 raises this to 400 via the same env var. */
export const DEFAULT_TWEET_CAP = 100;
export const DEFAULT_MAX_PAGES = 25;

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

export async function ingestAndCompile(handleOrUrl: string): Promise<IngestSummary> {
  const parsed = parseHandleOrUrl(handleOrUrl);
  if (!parsed.ok) {
    throw new IngestError({ code: "invalid-handle", message: parsed.message });
  }

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
    result = await client.ingest(parsed.handle, { cap: tweetCap(), maxPages: maxPages() });
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
  };
}
