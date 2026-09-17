# Talk-To

Paste a public X/Twitter handle or profile URL and chat with an **AI simulation** of how that
account posts — grounded in its public tweets, weighted toward what it has said recently.

> **This is a simulation, never the real person.** Every screen carries the banner:
> *AI simulation of @{handle} from public posts. Not affiliated. Not the real person.*

Build plan and phase gates live in [`BUILD.md`](./BUILD.md). Decisions made along the way live in
[`docs/decisions.md`](./docs/decisions.md). Per-phase shipping notes live in
[`PHASE_NOTES.md`](./PHASE_NOTES.md).

## Status: Phase 1 (manual-proof chat)

Ingest, persona compile, and streaming chat are wired end to end. Every unit is covered by tests
that run with no network and no keys.

## Run it

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env.local
pnpm dev                     # http://localhost:3000
```

The app boots with an empty `.env.local`. Without keys: the UI renders, the handle parser works,
`/t/testfounder` serves a synthetic development fixture, and the ingest and chat routes return a
clear 503 telling you which key is missing.

Other scripts:

```bash
pnpm test         # vitest — 96 unit tests, no network
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
pnpm db:generate  # drizzle-kit: regenerate SQL from src/lib/db/schema.ts
pnpm db:migrate   # drizzle-kit: apply migrations (uses DIRECT_DATABASE_URL)
```

## Talk to @x with local keys

1. **Database.** Set `DATABASE_URL` (Supabase transaction pooler, port 6543) and
   `DIRECT_DATABASE_URL` (session pooler, port 5432). Then `pnpm db:migrate`.
2. **Tweet ingest.** Set `GETXAPI_KEY` from https://docs.getxapi.com.
3. **Chat model.** Set `XAI_API_KEY`, or `OPENAI_API_KEY` to use the fallback. Set
   `XAI_CHAT_MODEL` to a model id your key can actually reach.
4. `pnpm dev`, enter a handle, wait for the ingest, and you land on `/t/{handle}`.

Or drive it without the UI:

```bash
curl -X POST localhost:3000/api/personas \
  -H 'Content-Type: application/json' \
  -d '{"handleOrUrl":"https://x.com/naval"}'
```

Each ingest logs its cost: `[usage] kind=ingest handle=naval units=5 cost=$0.0060`
(one profile call plus one call per timeline page, at $0.001 each).

## What it does

- Accepts `naval`, `@naval`, `x.com/naval`, `https://twitter.com/naval`, or a status URL and
  resolves the handle from it
- Fetches the public profile and public tweets (Phase 1+)
- Compiles a typed persona card: voice, stated positions, current context, unknowns (Phase 2+)
- Chats in that account's public posting voice, citing the posts it leaned on
- Says **"no public take"** when the evidence is thin, instead of inventing one

## What it does not do — in any phase

- **No posting, scheduling, replying, or DMs** as the simulated account. Ever.
- No protected or private accounts.
- No treating likes or follows as beliefs.
- No voice clone, no face clone.
- No claims about private biography, income, relationships, or off-platform beliefs.
- No impersonating licensed professionals as though the advice were real.
- No minors as clone targets — blocked when profile, bio, or age signals a minor.
- No "this is really them" language anywhere in the UI or marketing.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) + TypeScript + Tailwind v4 |
| Tests | Vitest |
| DB | Postgres + Drizzle |
| Tweet ingest | GetXAPI |
| Chat model | xAI Grok via OpenAI-compatible completions, OpenAI fallback |
| Validation | Zod — `PersonaCard` is only a card if it parses |
| Auth / billing | Phase 4 only |

## Layout

```
src/
  app/
    api/personas/   # POST: handle -> fetch, store, compile
    api/chat/       # POST: streaming reply, returns injected tweet ids
    t/[handle]/     # persona preview + chat
  components/       # banner, handle form, preview, chat
  lib/
    x/              # handle parsing, GetXAPI client, response fixtures
    persona/        # Zod schema, prompts, compile, store, ingest
    chat/           # provider (Grok/OpenAI), system prompt builder
    db/             # Drizzle schema + pooled client
  types/            # shared PersonaCard / StoredTweet contracts
drizzle/            # generated migration SQL
```

## How a turn is grounded

`POST /api/personas` reads up to `X_TWEET_CAP` usable posts (retweets dropped), stores them, and
compiles a `PersonaCard` — voice, stated positions with confidence, current context, and known
unknowns. If the compile fails or returns junk, a **thin card** is stored instead and chat still
works off the raw posts.

Each chat turn builds a system prompt from the card plus the newest `CHAT_RECENT_TWEETS` posts,
and returns the ids it actually injected on `X-Injected-Tweet-Ids`. The "Why this answer" panel
shows those posts — what was in context, not what the model claims it quoted.

## Environment

Copy `.env.example` to `.env.local`. Nothing in it is required until Phase 1.
Never commit a real key — `.env*.local` is gitignored.
