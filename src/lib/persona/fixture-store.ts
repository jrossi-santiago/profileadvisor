/**
 * Read-only fixture persona, used only when DATABASE_URL is absent so the chat
 * UI can be run and reviewed without a database. It serves exactly one handle
 * and never pretends to hold a real account: @testfounder is synthetic.
 */

import type { PersonaCard, StoredTweet } from "@/types/persona";
import type { StoredPersona } from "@/lib/persona/store";
import fixtureTweets from "@/lib/persona/fixtures/testfounder.tweets.json";
import fixtureCard from "@/lib/persona/fixtures/testfounder.card.json";

const FIXTURE_HANDLE = "testfounder";

export function hasFixturePersona(handle: string): boolean {
  return handle === FIXTURE_HANDLE;
}

export function fixturePersona(handle: string, recentN: number): StoredPersona | null {
  if (!hasFixturePersona(handle)) return null;

  const card = fixtureCard as PersonaCard;
  const tweets = (fixtureTweets as StoredTweet[])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, recentN);

  return {
    card,
    tweets,
    compiledAt: card.compiledAt,
    tweetCountUsed: card.tweetCountUsed,
    source: "fixture",
  };
}
