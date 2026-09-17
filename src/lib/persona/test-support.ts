/**
 * Shared fixture builders for persona and chat tests. Kept out of the fixtures
 * directory because these are synthetic, not captured API responses.
 */

import type { StoredTweet } from "@/types/persona";

export function makeTweet(overrides: Partial<StoredTweet> = {}): StoredTweet {
  return {
    id: "t-0",
    handle: "testfounder",
    text: "Most pricing pages are written for the builder, not the buyer.",
    createdAt: "2026-09-15T13:44:55.000Z",
    kind: "original",
    isReply: false,
    inReplyToId: null,
    conversationId: null,
    quoteText: null,
    url: "https://x.com/testfounder/status/t-0",
    metrics: { likes: 10, replies: 1, reposts: 2, quotes: 0, views: 100 },
    ...overrides,
  };
}

/** `count` tweets, newest first, with ids t-0 … t-(count-1). */
export function makeTweets(count: number, overrides: Partial<StoredTweet> = {}): StoredTweet[] {
  return Array.from({ length: count }, (_, index) =>
    makeTweet({
      id: `t-${index}`,
      createdAt: new Date(Date.UTC(2026, 8, 15) - index * 86_400_000).toISOString(),
      ...overrides,
    }),
  );
}
