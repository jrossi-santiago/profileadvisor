/**
 * Assembles the chat system prompt and reports which tweets it injected, so the
 * "Why this answer" panel shows the posts that were actually in context rather
 * than a plausible-looking guess.
 *
 * Phase 3 replaces the newest-N slice with retrieval; the returned shape stays.
 */

import { buildChatSystemPrompt } from "@/lib/persona/prompts";
import type { PersonaCard, StoredTweet } from "@/types/persona";
import type { EnvLike } from "@/types/env";

/** Newest-N posts stuffed into a Phase 1–2 prompt. */
export const DEFAULT_RECENT_TWEETS = 40;

export function recentTweetLimit(env: EnvLike = process.env): number {
  const raw = Number(env.CHAT_RECENT_TWEETS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RECENT_TWEETS;
}

export type BuiltPrompt = {
  system: string;
  injectedTweetIds: string[];
  injectedTweets: StoredTweet[];
};

export function buildPrompt(input: {
  card: PersonaCard;
  tweets: StoredTweet[];
  recentN?: number;
}): BuiltPrompt {
  const limit = input.recentN ?? recentTweetLimit();

  // Sort defensively: callers should hand us newest-first, but the prompt's
  // recency rules are worthless if the order is wrong.
  const newestFirst = [...input.tweets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const injectedTweets = newestFirst.slice(0, limit);

  return {
    system: buildChatSystemPrompt({ card: input.card, tweets: injectedTweets }),
    injectedTweetIds: injectedTweets.map((t) => t.id),
    injectedTweets,
  };
}
