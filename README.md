# Talk-To

Paste a public X/Twitter handle or profile URL and chat with an **AI simulation** of how that
account posts — grounded in its public tweets, weighted toward what it has said recently.

> **This is a simulation, never the real person.** Every screen carries the banner:
> *AI simulation of @{handle} from public posts. Not affiliated. Not the real person.*

Build plan and phase gates live in [`BUILD.md`](./BUILD.md). Decisions made along the way live in
[`docs/decisions.md`](./docs/decisions.md). Per-phase shipping notes live in
[`PHASE_NOTES.md`](./PHASE_NOTES.md).

## Status: Phase 0 (skeleton)

The app boots, parses handles, and refuses to become anything else yet. It makes **no network
calls** and needs **no API keys** to run.

## Run it

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env.local   # every value may stay blank in Phase 0
pnpm dev                     # http://localhost:3000
```

Other scripts:

```bash
pnpm test        # vitest — handle parser unit tests
pnpm typecheck   # tsc --noEmit
pnpm build       # production build
```

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
| DB | Postgres (Phase 1) |
| Tweet ingest | GetXAPI (Phase 1) |
| Chat model | xAI Grok via OpenAI-compatible completions, OpenAI fallback (Phase 1) |
| Auth / billing | Phase 4 only |

## Layout

```
src/
  app/          # routes: / (handle entry). /t/[handle] arrives in Phase 1
  components/   # simulation banner, handle form
  lib/
    x/          # handle parsing; GetXAPI client (Phase 1)
    persona/    # schema, compile, prompts (Phase 1–2)
    chat/       # system prompt builder, model provider (Phase 1)
    db/         # Postgres access (Phase 1)
  types/        # shared PersonaCard / StoredTweet contracts
```

## Environment

Copy `.env.example` to `.env.local`. Nothing in it is required until Phase 1.
Never commit a real key — `.env*.local` is gitignored.
