import { defineConfig } from "drizzle-kit";

/**
 * Migrations run over DIRECT_DATABASE_URL (session pooler or direct connection).
 * The transaction pooler in DATABASE_URL cannot run drizzle-kit's transactional
 * DDL, so it is deliberately not the preferred value here.
 *
 * `drizzle-kit generate` only diffs the schema and never connects, so the
 * placeholder keeps SQL generation working on a machine with no database.
 * `migrate` and `push` will fail loudly against it, which is the intent.
 */
const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
