# Decisions

Smallest-default decisions taken while building. Append, do not rewrite.

## Phase 0

**2026-09-17 — Next.js 16 App Router, TypeScript strict, Tailwind v4.**
Matches BUILD.md's recommended stack. Tailwind v4 needs no `tailwind.config.js`; tokens live in
`@theme` inside `src/app/globals.css`.

**2026-09-17 — Vitest over Jest.** Fastest path to typed unit tests with no Babel config, and it
reuses the `@/*` path alias from `tsconfig.json`.

**2026-09-17 — No ESLint yet.** `next lint` is gone in Next 16, and a flat-config ESLint setup is
not needed to satisfy Phase 0 exit criteria. Revisit if churn justifies it.

**2026-09-17 — Handle parser never throws by default.** `parseHandleOrUrl` returns a discriminated
result (`{ ok: true, handle }` or `{ ok: false, code, message }`) so the UI can render a specific
error without a try/catch. `parseHandleOrThrow` wraps it for call sites that already have error
handling.

**2026-09-17 — Reserved-path blocklist.** X squats on route names, so `x.com/home`,
`x.com/i/user/123`, `x.com/settings` and similar are rejected with code `reserved` rather than
compiling a persona for a non-account. The list is deliberately short and covers only routes that
collide with the handle namespace.

**2026-09-17 — Handle casing preserved, canonicalized separately.** `parseHandleOrUrl` returns the
casing the user typed (X displays it); `canonicalHandle()` lowercases for storage and cache keys.
Phase 1 must key the DB on the canonical form.

**2026-09-17 — Bare input containing `.` or `/` is an error, not a handle.** `naval@example.com`
and `foo/bar` fail with `bad-host` instead of being silently trimmed into something that looks like
a handle. Failing loudly beats compiling the wrong account.

**2026-09-17 — Shared types land in Phase 0, not Phase 1.** BUILD.md schedules `PersonaCard` /
`StoredTweet` for Phase 1, but the Phase 0 folder layout requires `src/types/`. The file holds type
declarations only — no runtime code, no Zod, no compile logic — so the contract is frozen before
anyone writes against it. Zod schemas mirroring it still belong to Phase 1.

**2026-09-17 — The banner renders in the root layout.** Putting it in `layout.tsx` rather than in
each page means no route can ship without it, and there is no dismiss control to remove.

**2026-09-17 — The Phase 0 form validates but cannot submit.** The Talk button is disabled; the
form runs the parser live so the parser is exercised by hand on the real screen without any
network call.

## Phase 1 (pre-work)

**2026-09-17 — Drizzle over Prisma.** Confirmed by the product owner. Lighter runtime for
serverless invocations, and Phase 3's pgvector similarity queries are easier to express in
Drizzle's SQL-first API than through a Prisma extension.

**2026-09-17 — Two Postgres URLs, not one.** `DATABASE_URL` is the pooled runtime connection
(Supabase transaction pooler, port 6543) and `DIRECT_DATABASE_URL` is the migration connection
(session pooler or direct, port 5432). The transaction pooler drops session state between
statements, so drizzle-kit's transactional DDL and prepared statements cannot run over it; the
direct connection is IPv6-only on new Supabase projects, so app runtime cannot rely on it. The
postgres.js client must be constructed with `prepare: false` against the transaction pooler.
