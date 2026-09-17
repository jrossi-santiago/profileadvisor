/**
 * GetXAPI client — public profile and public tweet reads only.
 *
 * Response shapes follow https://docs.getxapi.com/docs/users/user-info and
 * .../user-tweets. Every field beyond `id` and `text` is treated as optional:
 * the upstream is an unofficial X reader and adds or drops keys without notice,
 * so a missing `viewCount` must never fail an ingest.
 *
 * This module never writes to X. There is no POST path here by design.
 */

import { z } from "zod";
import type { StoredTweet, TweetKind } from "@/types/persona";
import { canonicalHandle } from "@/lib/x/handle";
import type { EnvLike } from "@/types/env";

const DEFAULT_BASE_URL = "https://api.getxapi.com";

/** $0.001 per call, per GetXAPI pricing. Used for the cost log. */
export const COST_PER_CALL_USD = 0.001;

export type GetXApiErrorCode =
  | "missing-key"
  | "not-found"
  | "protected"
  | "rate-limited"
  | "upstream"
  | "malformed";

export class GetXApiError extends Error {
  readonly code: GetXApiErrorCode;
  readonly status?: number;

  constructor(code: GetXApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GetXApiError";
    this.code = code;
    this.status = status;
  }
}

// --- wire schemas ------------------------------------------------------------

const profilePayload = z.object({
  id: z.string(),
  name: z.string().default(""),
  userName: z.string(),
  description: z.string().default(""),
  location: z.string().default(""),
  protected: z.boolean().default(false),
  isVerified: z.boolean().default(false),
  isBlueVerified: z.boolean().default(false),
  followers: z.number().default(0),
  following: z.number().default(0),
  statusesCount: z.number().default(0),
  createdAt: z.string().optional(),
  profilePicture: z.string().nullish(),
  coverPicture: z.string().nullish(),
});

const profileResponse = z.object({
  status: z.string().optional(),
  msg: z.string().optional(),
  data: profilePayload,
});

/** A quoted or retweeted tweet, kept shallow — we only read its text. */
const nestedTweet = z
  .object({ id: z.string().optional(), text: z.string().default("") })
  .loose();

const tweetPayload = z
  .object({
    id: z.string(),
    text: z.string().default(""),
    url: z.string().optional(),
    twitterUrl: z.string().optional(),
    createdAt: z.string().optional(),
    lang: z.string().optional(),
    isReply: z.boolean().default(false),
    inReplyToId: z.string().nullish(),
    conversationId: z.string().nullish(),
    retweetCount: z.number().default(0),
    replyCount: z.number().default(0),
    likeCount: z.number().default(0),
    quoteCount: z.number().default(0),
    viewCount: z.number().nullish(),
    quoted_tweet: nestedTweet.nullish(),
    retweeted_tweet: nestedTweet.nullish(),
  })
  .loose();

const tweetsResponse = z.object({
  userName: z.string().optional(),
  userId: z.string().optional(),
  tweet_count: z.number().optional(),
  has_more: z.boolean().default(false),
  next_cursor: z.string().nullish(),
  tweets: z.array(tweetPayload).default([]),
});

/** Which timeline to walk. Replies are where argument style actually shows. */
export type TimelineSource = "tweets" | "tweets_and_replies";

const TIMELINE_PATHS: Record<TimelineSource, string> = {
  tweets: "/twitter/user/tweets",
  tweets_and_replies: "/twitter/user/tweets_and_replies",
};

export type TimelinePage = {
  tweets: StoredTweet[];
  pagesFetched: number;
  droppedRetweets: number;
  duplicates: number;
};

export type XProfile = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  location: string;
  isProtected: boolean;
  isVerified: boolean;
  followers: number;
  following: number;
  statusesCount: number;
  avatarUrl: string | null;
  profileUrl: string;
  fetchedAt: string;
};

// --- mapping -----------------------------------------------------------------

/**
 * X appends a t.co link for media and quoted posts. It is noise in a prompt and
 * burns tokens, so it comes off the tail. Links inside the body are kept —
 * those are part of what the account said.
 */
export function cleanTweetText(text: string): string {
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "").trim();
}

/**
 * GetXAPI returns X's legacy timestamp ("Mon Jan 12 13:44:55 +0000 2026").
 * Date parses it, but an unparseable value must not poison recency ordering.
 */
export function parseTweetDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type RawTweet = z.infer<typeof tweetPayload>;

export function classifyTweet(raw: RawTweet): TweetKind {
  if (raw.retweeted_tweet || /^RT @\w+:/.test(raw.text)) return "retweet";
  if (raw.quoted_tweet) return "quote";
  if (raw.isReply) return "reply";
  return "original";
}

function toStoredTweet(raw: RawTweet, handle: string): StoredTweet | null {
  const createdAt = parseTweetDate(raw.createdAt);
  if (!createdAt) return null;

  const text = cleanTweetText(raw.text);
  const quoteText = raw.quoted_tweet ? cleanTweetText(raw.quoted_tweet.text) : null;

  return {
    id: raw.id,
    handle: canonicalHandle(handle),
    text,
    createdAt,
    kind: classifyTweet(raw),
    isReply: raw.isReply,
    inReplyToId: raw.inReplyToId ?? null,
    conversationId: raw.conversationId ?? null,
    quoteText: quoteText && quoteText.length > 0 ? quoteText : null,
    url: raw.url ?? raw.twitterUrl ?? `https://x.com/${handle}/status/${raw.id}`,
    metrics: {
      likes: raw.likeCount,
      replies: raw.replyCount,
      reposts: raw.retweetCount,
      quotes: raw.quoteCount,
      views: raw.viewCount ?? null,
    },
  };
}

/**
 * A tweet counts as substance if the account actually wrote something. Plain
 * retweets carry no words of their own, so an account that only retweets reads
 * as a thin record rather than a deep personality.
 */
export function isUsableTweet(tweet: StoredTweet): boolean {
  if (tweet.kind === "retweet") return false;
  return tweet.text.length > 0;
}

// --- client ------------------------------------------------------------------

export type GetXApiConfig = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type IngestResult = {
  profile: XProfile;
  tweets: StoredTweet[];
  usableCount: number;
  droppedRetweets: number;
  pagesFetched: number;
  /** How many usable tweets each timeline contributed. */
  bySource: Record<TimelineSource, number>;
  apiCalls: number;
  estimatedCostUsd: number;
};

export function readConfigFromEnv(env: EnvLike = process.env): GetXApiConfig {
  const apiKey = env.GETXAPI_KEY?.trim();
  if (!apiKey) {
    throw new GetXApiError("missing-key", "GETXAPI_KEY is not set. Copy .env.example to .env.local.");
  }
  return { apiKey, baseUrl: env.GETXAPI_BASE_URL?.trim() || DEFAULT_BASE_URL };
}

export class GetXApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  /** Counts every billable call this client has made, for the cost log. */
  apiCalls = 0;

  constructor(config: GetXApiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response: Response;
    this.apiCalls += 1;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      });
    } catch (cause) {
      throw new GetXApiError("upstream", `Could not reach GetXAPI: ${String(cause)}`);
    }

    if (response.status === 404) {
      throw new GetXApiError("not-found", "That account does not exist on X.", 404);
    }
    if (response.status === 429) {
      throw new GetXApiError("rate-limited", "GetXAPI rate limit hit. Try again shortly.", 429);
    }
    if (!response.ok) {
      throw new GetXApiError("upstream", `GetXAPI returned ${response.status}.`, response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new GetXApiError("malformed", "GetXAPI returned a body that was not JSON.");
    }
  }

  async fetchProfile(handle: string): Promise<XProfile> {
    const body = await this.get("/twitter/user/info", { userName: handle });

    // A 200 carrying an `error` key is how GetXAPI reports a missing account.
    if (body && typeof body === "object" && "error" in body) {
      throw new GetXApiError("not-found", String((body as { error: unknown }).error));
    }

    const parsed = profileResponse.safeParse(body);
    if (!parsed.success) {
      throw new GetXApiError("malformed", "GetXAPI profile response did not match the expected shape.");
    }

    const data = parsed.data.data;
    if (data.protected) {
      throw new GetXApiError(
        "protected",
        `@${data.userName} is a protected account. This product reads public posts only.`,
      );
    }

    return {
      id: data.id,
      handle: data.userName,
      displayName: data.name,
      bio: data.description,
      location: data.location,
      isProtected: false,
      isVerified: data.isVerified || data.isBlueVerified,
      followers: data.followers,
      following: data.following,
      statusesCount: data.statusesCount,
      avatarUrl: data.profilePicture ?? null,
      profileUrl: `https://x.com/${data.userName}`,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Walks one timeline until `cap` usable tweets are collected, the cursor runs
   * out, or `maxPages` is reached — whichever comes first. Plain retweets are
   * dropped and do not count toward the cap.
   *
   * `seen` is shared across sources so the replies timeline does not re-collect
   * what the main timeline already returned.
   */
  async fetchTimeline(options: {
    handle: string;
    userId?: string;
    cap: number;
    maxPages: number;
    source?: TimelineSource;
    seen?: Set<string>;
  }): Promise<TimelinePage> {
    const { handle, userId, cap, maxPages, source = "tweets" } = options;
    const path = TIMELINE_PATHS[source];
    const collected: StoredTweet[] = [];
    const seen = options.seen ?? new Set<string>();
    let droppedRetweets = 0;
    let duplicates = 0;
    let cursor: string | undefined;
    let pagesFetched = 0;

    while (pagesFetched < maxPages && collected.length < cap) {
      // tweets_and_replies is documented as userName-only; the main timeline
      // accepts userId, which the docs call the faster path.
      const params: Record<string, string> =
        userId && source === "tweets" ? { userId } : { userName: handle };
      if (cursor) params.cursor = cursor;

      const parsed = tweetsResponse.safeParse(await this.get(path, params));
      if (!parsed.success) {
        throw new GetXApiError("malformed", `GetXAPI ${source} response did not match the expected shape.`);
      }
      pagesFetched += 1;

      const page = parsed.data;
      for (const raw of page.tweets) {
        if (seen.has(raw.id)) {
          duplicates += 1;
          continue;
        }
        seen.add(raw.id);

        const tweet = toStoredTweet(raw, handle);
        if (!tweet) continue;
        if (!isUsableTweet(tweet)) {
          if (tweet.kind === "retweet") droppedRetweets += 1;
          continue;
        }

        collected.push(tweet);
        if (collected.length >= cap) break;
      }

      if (!page.has_more || !page.next_cursor) break;
      cursor = page.next_cursor;
    }

    return { tweets: collected, pagesFetched, droppedRetweets, duplicates };
  }

  /** Back-compat alias for the main timeline. */
  async fetchTweets(options: {
    handle: string;
    userId?: string;
    cap: number;
    maxPages: number;
  }): Promise<TimelinePage> {
    return this.fetchTimeline(options);
  }

  /**
   * Profile + timelines in one call, with the cost of the run attached.
   *
   * Both the main timeline and the replies tab are walked under a single page
   * budget, sharing a `seen` set so a post returned by both is stored once.
   * Replies are included because argument style — how this account disagrees —
   * is mostly invisible in originals alone.
   */
  async ingest(
    handle: string,
    options: { cap: number; maxPages: number; includeReplies?: boolean },
  ): Promise<IngestResult> {
    const includeReplies = options.includeReplies ?? true;
    const profile = await this.fetchProfile(handle);
    const seen = new Set<string>();

    const main = await this.fetchTimeline({
      handle: profile.handle,
      userId: profile.id,
      cap: options.cap,
      maxPages: options.maxPages,
      source: "tweets",
      seen,
    });

    const tweets = [...main.tweets];
    let pagesFetched = main.pagesFetched;
    let droppedRetweets = main.droppedRetweets;
    const bySource: Record<TimelineSource, number> = {
      tweets: main.tweets.length,
      tweets_and_replies: 0,
    };

    const pageBudgetLeft = options.maxPages - pagesFetched;
    const capLeft = options.cap - tweets.length;

    if (includeReplies && pageBudgetLeft > 0 && capLeft > 0) {
      const replies = await this.fetchTimeline({
        handle: profile.handle,
        cap: capLeft,
        maxPages: pageBudgetLeft,
        source: "tweets_and_replies",
        seen,
      });

      tweets.push(...replies.tweets);
      pagesFetched += replies.pagesFetched;
      droppedRetweets += replies.droppedRetweets;
      bySource.tweets_and_replies = replies.tweets.length;
    }

    tweets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      profile,
      tweets,
      usableCount: tweets.length,
      droppedRetweets,
      pagesFetched,
      bySource,
      apiCalls: this.apiCalls,
      estimatedCostUsd: Number((this.apiCalls * COST_PER_CALL_USD).toFixed(4)),
    };
  }
}
