/**
 * Loads the synthetic @testfounder persona into the configured database, so the
 * full DB-backed path can be run locally without a GetXAPI key.
 *
 *   DATABASE_URL=postgres://... pnpm db:seed
 *
 * It only ever writes the fixture handle. It is a development convenience, not
 * a substitute for a real ingest.
 */

import { fixturePersona } from "@/lib/persona/fixture-store";
import { saveCard, saveProfile, saveTweets } from "@/lib/persona/store";
import { isDatabaseConfigured } from "@/lib/db";

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL is not set. Nothing to seed.");
    process.exit(1);
  }

  const persona = fixturePersona("testfounder", 1000);
  if (!persona) throw new Error("fixture persona missing");

  await saveProfile({
    id: "745273",
    handle: persona.card.handle,
    displayName: persona.card.displayName,
    bio: persona.card.bio,
    location: "",
    isProtected: false,
    isVerified: false,
    followers: 48211,
    following: 812,
    statusesCount: 14022,
    avatarUrl: null,
    profileUrl: persona.card.profileUrl,
    fetchedAt: new Date().toISOString(),
  });

  const count = await saveTweets(persona.tweets);
  await saveCard({
    card: persona.card,
    sourceTweetIds: persona.tweets.map((t) => t.id),
  });

  console.log(`Seeded @${persona.card.handle} with ${count} synthetic posts.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
