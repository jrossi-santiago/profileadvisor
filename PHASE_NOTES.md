# Phase notes

Append one section per phase: what shipped, what broke, keys required, remaining bugs.

## Phase 0 — Product rules and repo skeleton (2026-09-17)

**Shipped**
- Next.js 16 App Router + TypeScript (strict) + Tailwind v4 skeleton, Vitest wired
- Folder layout from BUILD.md: `src/app`, `src/components`, `src/lib/{x,persona,chat,db}`, `src/types`
- `src/lib/x/handle.ts` — handle/URL parser with a typed result union, reserved-route blocklist,
  and `canonicalHandle` / `profileUrl` helpers
- 33 parser unit tests covering every case in BUILD.md plus whitespace, `www.`/`mobile.`
  subdomains, query strings, fragments, protocol-relative URLs, length and charset limits
- Home page: handle input with live parse feedback, **disabled** Talk button, out-of-scope list
- `SimulationBanner` rendered from the root layout — no route can ship without it, no dismiss control
- `BUILD.md`, `README.md`, `docs/decisions.md`, `.env.example`, `.gitignore`

**Verified**
- `pnpm test` → 33/33 green
- `pnpm typecheck` → clean
- `pnpm build` → clean, both routes static
- Dev server screenshotted at 1280×800: banner is above the fold, `https://x.com/naval/status/…`
  resolves to `@naval` in the form

**Keys required** — none. Phase 0 makes no network calls.

**Known gaps / carried into Phase 1**
- `src/lib/{persona,chat,db}` are empty placeholders
- No `/t/[handle]` route yet
- `src/types/persona.ts` has types but no Zod schemas
- Next 16 rewrote `tsconfig.json` on first build (`jsx: react-jsx`, added `.next/dev/types`)

## Phase 1 — Manual-proof chat (2026-09-17)

**Shipped**
- `src/lib/x/getxapi.ts` — typed GetXAPI client: profile + cursor-paginated timeline, Zod-validated
  against the published response shapes, retweets dropped, legacy X timestamps normalized to ISO,
  cap and page limits from env, per-run cost attached
- `src/lib/db` — Drizzle schema for profiles, tweets, persona_cards, threads, messages,
  usage_events; postgres.js client with `prepare: false`; `drizzle/0000_*.sql` generated
- `src/lib/persona` — Zod `PersonaCard`, compile prompt, one-shot LLM compile with a thin fallback,
  ungrounded-topic pruning, store, and the ingest pipeline
- `src/lib/chat` — Grok/OpenAI provider with hand-rolled SSE streaming, system prompt builder
- `POST /api/personas`, `POST /api/chat` (streaming), `/t/[handle]` with preview + chat
- "Why this answer" panel listing up to 3 injected source posts
- Read-only fixture persona (@testfounder) so the UI runs with no database

**Verified**
- `pnpm test` → 96/96 green, no network
- `pnpm typecheck` → clean; `pnpm build` → clean, 5 routes
- Live error paths, checked against the running server:
  - missing `GETXAPI_KEY` → 503 with the key name
  - missing chat provider → 503 naming both env vars
  - `https://x.com/home` → 400, "is an X site route, not an account"
- Protected account → `protected` error (fixture test, fails closed before any timeline call)
- Retweet-only timeline → 0 usable tweets → `no-substance`, not an empty clone
- Fixture: a topic citing a tweet id outside the corpus is dropped from the card
- Screenshotted `/t/testfounder` at 1440×950; fixed a real bug found there — two stacked sticky
  banners had made the disclosure unreadable

**Keys required** — `GETXAPI_KEY`, `XAI_API_KEY` (or `OPENAI_API_KEY`), `DATABASE_URL` +
`DIRECT_DATABASE_URL`.

**Database path verified (2026-09-17, local Postgres 16)**
- `pnpm db:migrate` applies `0000_thin_microbe.sql` cleanly: 6 tables, 11 indexes
- 9 integration tests in `store.integration.test.ts` pass against real Postgres — handle
  canonicalization, idempotent profile re-ingest, metrics refresh on tweet conflict, PersonaCard
  jsonb round-trip, newest-first ordering with limit, thread + injected-id persistence, cost ledger
- `pnpm db:seed` then `/t/testfounder` renders from the database with no fixture fallback
- Full suite with a database: 105 passed. Without one: 96 passed, 9 skipped.

**Still not verified — needs API keys**
- Any real ingest. The client matches the documented shapes but has never seen a live response.
- Model ids (`grok-4`, `grok-4-fast`) are placeholder defaults, not confirmed against an account.
- The three BUILD.md acceptance checks that need a live model: do three handles feel distinct
  within 5 messages; does the model say "no public take" off-topic; is the voice non-generic.

**Sandbox reachability (checked 2026-09-17)**
- `api.getxapi.com` and `api.x.ai` both return 401 to an unauthenticated request, so HTTPS egress
  works and only the keys are missing — a live ingest and a live chat could run from here.
- Raw Postgres TCP to a Supabase pooler host is blocked from this sandbox. That does not affect
  Vercel; it only means local runs here must use a local Postgres.

**Known gaps / carried into Phase 2**
- Tweet cap is 100 and `user/tweets_and_replies` is not pulled yet
- No 24h compile cache — every POST re-ingests
- No compile status states in the UI beyond a spinner label
- Thread history is persisted but not reloaded into the UI on refresh

## Phase 2 — Ingest + persona compiler (2026-09-17)

**Shipped**
- `/twitter/user/tweets_and_replies` added to the client; both timelines walk under one shared page
  budget and one `seen` set, so a post on both tabs is stored once
- Tweet cap raised to 400 (`X_TWEET_CAP`), page cap 25 (`X_MAX_PAGES`), replies toggleable with
  `X_INCLUDE_REPLIES`; cap, page count, and per-timeline contribution all logged per ingest
- 24h compile cache (`src/lib/persona/cache.ts`), checked before the API client is constructed, so
  a hit costs nothing and needs no key. `refresh: true` bypasses it.
- `POST /api/personas` streams NDJSON progress (`fetching` → `compiling` → `ready`/`failed`) when
  sent `Accept: application/x-ndjson`; plain JSON otherwise
- Preview panel: avatar, bio, thin-record flag, 6–8 priority-ordered bullets, topics with
  confidence bars, compile freshness, and a Refresh button that bypasses the cache

**Verified**
- `pnpm test` → 137 passed / 9 skipped offline; **151 passed** with a database
- `pnpm typecheck`, `pnpm build` → clean
- Live over HTTP against local Postgres:
  - same handle twice inside 24h → `cached: true`, `pagesFetched: 0`, `[compile] cache hit … ageH=0.0`
  - `refresh: true` → `[compile] cache miss … reason=refresh-requested cap=400 maxPages=25`, then
    proceeds to fetch
  - NDJSON stream emits `cached` then `ready`; a mid-stream failure arrives as a `failed` event
- Fixture tests: a topic citing an id outside the corpus is dropped; 0 usable tweets → error, not
  an empty clone; protected accounts fail closed before any timeline call
- Screenshotted the preview at 1440×1100

**Bug found by a test:** the 8-bullet cap was cutting "No public take on …" and "Has publicly
changed position on …" in favour of humour and catchphrases. Bullets are now priority-ordered and
a test asserts those two survive.

**Still needs API keys** — every acceptance check that requires a live model or a live ingest:
whether 5 live handles compile without hand-editing JSON, whether preview bullets contradict the
last week of a real timeline, and the Phase 1 voice checks.

**Carried into Phase 3**
- No embeddings or retrieval; chat still stuffs the newest 40 posts
- No Jev (Phase 2.5, optional)
- Refresh re-reads the whole timeline rather than fetching only what is new
