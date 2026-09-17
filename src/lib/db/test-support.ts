/**
 * Cleanup helpers for database integration tests.
 *
 * Deletes are scoped to one handle rather than truncating the schema: two test
 * files share a database, and a global truncate in one wipes the fixtures the
 * other is mid-way through using. Scoped deletes let them coexist even if the
 * runner ever parallelizes them again.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { messages, personaCards, profiles, threads, tweets, usageEvents } from "@/lib/db/schema";
import { canonicalHandle } from "@/lib/x/handle";

export async function resetHandle(handleInput: string): Promise<void> {
  const handle = canonicalHandle(handleInput);
  const db = getDb();

  const owned = await db.select({ id: threads.id }).from(threads).where(eq(threads.handle, handle));
  if (owned.length > 0) {
    await db.delete(messages).where(
      inArray(
        messages.threadId,
        owned.map((row) => row.id),
      ),
    );
  }

  await db.delete(threads).where(eq(threads.handle, handle));
  await db.delete(personaCards).where(eq(personaCards.handle, handle));
  await db.delete(tweets).where(eq(tweets.handle, handle));
  await db.delete(profiles).where(eq(profiles.handle, handle));
  await db.delete(usageEvents).where(eq(usageEvents.handle, handle));
}

/** Usage rows carry no handle when recorded outside an ingest; clear those too. */
export async function clearOrphanUsage(): Promise<void> {
  await getDb().delete(usageEvents).where(sql`${usageEvents.handle} is null`);
}
