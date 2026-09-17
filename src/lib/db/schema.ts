/**
 * Drizzle schema. Mirrors the target data model in BUILD.md; the vector column
 * on tweets arrives in Phase 3, auth columns in Phase 4.
 *
 * Handles are stored canonically (lowercase, no @) everywhere — see
 * canonicalHandle() in src/lib/x/handle.ts. Display casing lives on profiles.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PersonaCard, StoredTweet, TweetKind } from "@/types/persona";

export const profiles = pgTable(
  "profiles",
  {
    handle: text("handle").primaryKey(),
    userId: text("user_id").notNull(),
    displayName: text("display_name").notNull().default(""),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    isProtected: boolean("is_protected").notNull().default(false),
    followers: integer("followers").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("profiles_user_id_idx").on(table.userId)],
);

export const tweets = pgTable(
  "tweets",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    kind: text("kind").$type<TweetKind>().notNull(),
    isReply: boolean("is_reply").notNull().default(false),
    inReplyToId: text("in_reply_to_id"),
    conversationId: text("conversation_id"),
    quoteText: text("quote_text"),
    url: text("url").notNull(),
    metrics: jsonb("metrics").$type<StoredTweet["metrics"]>().notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Chat loads "newest N for this handle" on every turn; this index is that query.
  (table) => [index("tweets_handle_created_idx").on(table.handle, table.createdAt.desc())],
);

export const personaCards = pgTable("persona_cards", {
  handle: text("handle").primaryKey(),
  card: jsonb("card").$type<PersonaCard>().notNull(),
  compiledAt: timestamp("compiled_at", { withTimezone: true }).notNull().defaultNow(),
  tweetCountUsed: integer("tweet_count_used").notNull().default(0),
  thinRecord: boolean("thin_record").notNull().default(false),
  sourceTweetIds: jsonb("source_tweet_ids").$type<string[]>().notNull().default([]),
  compileError: text("compile_error"),
});

export const threads = pgTable(
  "threads",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    userId: text("user_id"),
    shareId: text("share_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("threads_handle_idx").on(table.handle)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    injectedTweetIds: jsonb("injected_tweet_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_thread_idx").on(table.threadId, table.createdAt)],
);

/**
 * Append-only cost ledger. `units` means pages for ingest, tokens for chat.
 * Phase 4 turns this into the cost dashboard; Phase 1 only needs it written.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<"ingest" | "compile" | "chat" | "jev">().notNull(),
    units: real("units").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    handle: text("handle"),
    userId: text("user_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_events_kind_idx").on(table.kind, table.createdAt)],
);

export const schema = {
  profiles,
  tweets,
  personaCards,
  threads,
  messages,
  usageEvents,
};
