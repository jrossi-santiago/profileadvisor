/**
 * Postgres client for the app runtime.
 *
 * `prepare: false` is mandatory: DATABASE_URL points at a transaction pooler,
 * which hands the connection back after every statement and therefore cannot
 * keep a prepared statement alive between them. drizzle-kit uses
 * DIRECT_DATABASE_URL instead — see drizzle.config.ts.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "@/lib/db/schema";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    this.name = "DatabaseNotConfiguredError";
  }
}

type Db = ReturnType<typeof createDb>;

function createDb(url: string) {
  const client = postgres(url, {
    prepare: false,
    // Serverless invocations are short-lived; a large pool per instance just
    // exhausts the pooler's client slots.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return drizzle(client, { schema });
}

let cached: Db | undefined;

/** Lazily built so importing this module never requires a configured database. */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseNotConfiguredError();
  cached = createDb(url);
  return cached;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export { schema };
export * from "@/lib/db/schema";
