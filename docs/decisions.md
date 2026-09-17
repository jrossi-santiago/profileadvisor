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

## Phase 1

**2026-09-17 — Response shapes taken from the published GetXAPI docs.** `/twitter/user/info`
returns `{status, msg, data}`; `/twitter/user/tweets` returns `{tweets, has_more, next_cursor}`
with X's legacy `createdAt` ("Mon Jan 12 13:44:55 +0000 2026"). Every field beyond `id` and `text`
is optional in the Zod schema: the upstream is an unofficial reader and a missing `viewCount` must
not fail an ingest.

**2026-09-17 — A tweet with an unparseable date is dropped, not defaulted.** Defaulting to "now"
would put an undated post at the top of a prompt whose entire recency rule depends on ordering.

**2026-09-17 — Retweets are dropped; replies and quotes are kept.** BUILD.md's tweet mix. A plain
retweet carries none of the account's own words, so an account that only retweets reads as zero
usable tweets and is rejected with `no-substance` rather than compiled into an empty clone.
Replies are where argument style actually shows, and quotes carry the quoted text for context.

**2026-09-17 — A trailing t.co link is stripped from tweet text.** X appends one for media and
quotes. It is pure token cost in a prompt. Links inside the body are kept — those are part of what
the account said.

**2026-09-17 — The model never supplies identity or counts.** `personaExtractionSchema` is the
card minus handle, displayName, bio, profileUrl, compiledAt, and tweetCountUsed. The application
merges those in. A model cannot rename the account it is describing or inflate how much it read.

**2026-09-17 — A topic whose evidenceIds are not in the corpus is dropped.** A citation to a tweet
that does not exist is a hallucination wearing a footnote. BUILD.md schedules this test for Phase
2; it was cheap to enforce now and there is no reason to ship the weaker version first.

**2026-09-17 — Compile failure degrades to a thin card rather than an error.** A model that times
out or returns prose still leaves a usable product: chat runs off raw posts with no extracted
positions, and the thin-record warning tells the user why the answers are cautious. The failure
reason is stored in `persona_cards.compile_error`.

**2026-09-17 — No LLM SDK.** Grok and OpenAI both speak the OpenAI chat-completions shape, so the
provider is ~150 lines of fetch plus a hand-rolled SSE parse. One fewer dependency to track, and
swapping providers is an env change.

**2026-09-17 — Model ids live in env with placeholder defaults.** `XAI_CHAT_MODEL` defaults to
`grok-4`. These have not been verified against a live account; set them to ids the key actually
has access to.

**2026-09-17 — "Why this answer" shows the injected posts, not model citations.** `buildPrompt`
returns the ids it actually put in the prompt, and the route passes them back on
`X-Injected-Tweet-Ids`. The panel says plainly that these were in context rather than claiming the
model quoted them.

**2026-09-17 — The simulation banner is a client component reading the pathname.** The first
version took a handle prop and was rendered a second time by the persona page; two `sticky top-0`
bars stacked and left both unreadable. One banner in the root layout, deriving the handle from
`/t/{handle}`, keeps the disclosure legible and still impossible to route around.

**2026-09-17 — A read-only fixture persona serves @testfounder when DATABASE_URL is absent.** It
exists so the chat UI can be developed and reviewed without a database. It serves exactly one
synthetic handle, is clearly labelled as a development fixture in the UI, and can never mask a
broken write path for a real account.

**2026-09-17 — Database tests are checked in but skip without `DATABASE_URL`.** `describe.skipIf`
keeps the default suite offline and fast while making the persistence layer verifiable on demand.
The suite truncates before and after itself, so it must only ever be pointed at a throwaway
database.

**2026-09-17 — `pnpm db:seed` loads the fixture persona into Postgres.** It lets the full
database-backed path be run without a GetXAPI key. It writes only the synthetic handle.

## Phase 2

**2026-09-17 — Replies and quotes are ingested; plain retweets still are not.** BUILD.md asks for
this note. Three reasons. Argument style — how this account disagrees, which the card records as
`disagreementStyle` — is almost invisible in originals alone; it shows in replies. Quotes carry
the quoted text, so a take that only makes sense as a response to something stays legible. A plain
retweet contains none of the account's own words, so counting it as substance would let a pure
amplifier account compile into a confident voice it never wrote. Replies are also where a thin
originals-only timeline becomes a usable corpus.

**2026-09-17 — Both timelines share one page budget and one `seen` set.** `X_MAX_PAGES` caps the
whole ingest, not each endpoint, so cost stays bounded at ~$0.025 per compile regardless of how
the posts are split. The shared `seen` set means a post the two tabs both return is stored once;
the replies pass is skipped entirely when the cap or the page budget is already spent.

**2026-09-17 — The cache is checked before the client is constructed.** A cache hit costs no
upstream call and does not even require `GETXAPI_KEY` to be set. That also makes the cache path
verifiable without credentials.

**2026-09-17 — A card dated in the future is treated as stale.** It means a clock problem
somewhere, and trusting it would pin a handle to a card that never expires.

**2026-09-17 — Progress is NDJSON, opt-in via `Accept`.** A compile takes 10–30s and an opaque
spinner for that long reads as broken. Streaming `fetching` → `compiling` → `ready` states needs
no polling endpoint and no job table. Plain JSON stays the default so curl and any other client
keep working. A failure that happens mid-stream arrives as a `failed` event inside a 200, because
a status code cannot be revised once the body has started.

**2026-09-17 — Preview bullets are ordered by priority, not by card layout.** The 8-bullet cap
truncates the tail, and the first version buried "No public take on …" and "Has publicly changed
position on …" behind humour and catchphrases. Those two are the bullets that stop a reader
trusting an answer the account never earned, so they now rank directly after voice basics. A test
asserts they survive the cap.

**2026-09-17 — Avatars render with a plain `img`.** They come from X's CDN, and configuring
`next/image` remote patterns for a host we do not control buys nothing here.
