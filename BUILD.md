# X Persona Chat — Phased Build Spec for Claude Code

**Product:** Paste an X/Twitter profile URL or handle. Chat with an AI simulation of that account, grounded in public tweets, with inferred stances weighted toward current context.

**Working title:** Talk-To (replace freely). This is a *simulation*, never the real person. Never auto-post.

**Last updated:** 2026-09-17

---

## How to use this file with Claude Code

1. Drop this file in the repo root as `BUILD.md` (or keep the filename).
2. Start a *new* Claude Code session per phase.
3. Paste the **Claude Code prompt** for that phase only. Do not paste later phases until the current **Exit criteria** pass.
4. After each phase, run the **Acceptance checks** yourself (or ask Claude to run them and report).
5. If a check fails, stay in that phase. Do not “also start auth / embeddings / billing.”

**Session rules to prepend to every phase prompt**

```
You are implementing one phase of BUILD.md only.
Do not skip ahead. Do not invent product scope.
Prefer simple, typed, testable code.
If something is ambiguous, choose the smallest default and document it in /docs/decisions.md.
Never commit secrets. Use .env.example.
This product is an AI SIMULATION of a public X account. Always disclose that in the UI.
Do not add posting, DMs, voice clone, or “this is really them” language.
```

---

## Product non-negotiables

**In scope**
- Public handle or `x.com/{handle}` / `twitter.com/{handle}` URL
- Fetch public profile + tweets via GetXAPI
- Compile a typed persona card
- Chat in that account’s public voice
- Cite source tweets
- Refresh persona on demand
- “No public take” when evidence is thin

**Out of scope (all phases unless a later phase explicitly adds it)**
- Auto-posting, scheduling, or sending DMs as the clone
- Private/protected accounts
- Treating likes/follows as beliefs
- Voice or face clone
- Claiming private biography
- Impersonating licensed professionals as if real
- Minors as clone targets (block if profile/bio/age signals a minor)

**Always-on UI chrome**
- Banner: `AI simulation of @{handle} from public posts. Not affiliated. Not the real person.`
- Link to the live X profile
- Source tweets visible or linkable under answers

---

## Recommended stack

| Layer | Default | Notes |
|---|---|---|
| App | Next.js (App Router) + TypeScript | Streaming chat |
| DB | Postgres (Drizzle or Prisma) | Users later; handles + tweets + cards + threads now |
| Tweet ingest | GetXAPI | `user/info`, `user/tweets`, `user/tweets_and_replies` |
| Chat LLM | xAI Grok via OpenAI-compatible chat completions | Swap-able provider |
| Persona extract | Cheaper/fast LLM + Zod structured output | Open-ended strings |
| Judgments | TypeSafe Jev (optional from Phase 2.5) | Choice / Score / Noul only |
| Validation | Zod as source of truth for `PersonaCard` | |
| Auth / billing | Phase 4 only | |

**Env vars (`.env.example`)**

```
GETXAPI_KEY=
XAI_API_KEY=
OPENAI_API_KEY=          # optional fallback
TYPESAFE_AI_API_KEY=     # optional, Phase 2.5+
DATABASE_URL=
```

---

## Shared types (implement in Phase 1, freeze unless a phase extends them)

```ts
export type VoiceRegister =
  | "blunt"
  | "academic"
  | "shitposter"
  | "founder-threader"
  | "mixed";

export type AvgLength = "short" | "medium" | "thread";

export type DisagreementStyle =
  | "ratio"
  | "steelman"
  | "ignore"
  | "pile-on"
  | "clarify";

export type StanceSide =
  | "for"
  | "against"
  | "mixed"
  | "joke-only"
  | "unclear";

export type TweetKind = "original" | "reply" | "quote" | "retweet";

export type StoredTweet = {
  id: string;
  handle: string;
  text: string;
  createdAt: string; // ISO
  kind: TweetKind;
  isReply: boolean;
  inReplyToId: string | null;
  conversationId: string | null;
  quoteText: string | null;
  url: string;
  metrics: {
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    views: number | null;
  };
};

export type PersonaTopic = {
  name: string;
  stance: string;
  side: StanceSide;
  confidence: number; // 0–1
  lastSeen: string;
  evidenceIds: string[];
};

export type PersonaCard = {
  handle: string;
  displayName: string;
  bio: string;
  profileUrl: string;
  compiledAt: string;
  tweetCountUsed: number;
  thinRecord: boolean;
  voice: {
    register: VoiceRegister;
    avgLength: AvgLength;
    humor: string;
    disagreementStyle: DisagreementStyle;
    signaturePhrases: string[];
    avoids: string[];
  };
  topics: PersonaTopic[];
  currentContext: {
    last14dThemes: string[];
    activeFights: string[];
    mood: string;
  };
  knowledgeEnvelope: string[];
  unknowns: string[];
  contradictions: {
    topic: string;
    older: string;
    newer: string;
    olderId?: string;
    newerId?: string;
  }[];
};
```

Jev may later fill enums + scores. An LLM fills prose lists. Application code merges and Zod-parses. **Never ask Jev to generate the whole card.**

---

# Phase 0 — Product rules and repo skeleton

**Goal:** Empty app that cannot silently become an impersonation tool. Conventions locked.

**Duration:** half day

## Work

- Next.js + TS + Tailwind (or existing design tokens)
- `.env.example`, README, `BUILD.md` (this file)
- `/docs/decisions.md`
- Folder layout:

```
src/
  app/
  components/
  lib/
    x/           # handle parse, GetXAPI client
    persona/     # schema, compile, prompts
    chat/        # system prompt builder, provider
    db/
  types/
```

- Handle parser tests:
  - `@naval`
  - `naval`
  - `https://x.com/naval`
  - `https://twitter.com/naval`
  - `https://x.com/naval/status/...` → extract handle
  - junk → error

## Claude Code prompt — Phase 0

```
Read BUILD.md. Implement Phase 0 only.

Create the Next.js TypeScript app skeleton, folder layout, .env.example,
README (how to run, what the product is, simulation disclaimer),
and src/lib/x/handle.ts with unit tests for URL/handle parsing.

Add a placeholder home page:
- input for handle or X URL
- disabled “Talk” button
- visible disclaimer: AI simulation of public posts, not the real person

Do not call any APIs. Do not add auth.
When done, list files created and how to run tests.
```

## Expected outcomes

- `pnpm dev` shows a single input screen + disclaimer
- Handle parser tests pass
- No API keys required to boot
- README states out-of-scope items

## Exit criteria

- [ ] Parser covers the cases above
- [ ] Disclaimer is visible without scrolling on desktop
- [ ] Repo boots on a clean machine from README

---

# Phase 1 — Manual-proof chat (voice before infra)

**Goal:** Prove chat quality with ~100 tweets stuffed into a prompt. No vector DB. No auth.

**Duration:** 3–7 days

## Work

1. GetXAPI client
   - `GET /twitter/user/info?userName=`
   - `GET /twitter/user/tweets` paginated, stop at 100 originals+quotes (skip empty retweets)
   - Map into `StoredTweet`
2. Persist tweets + profile in Postgres (one table is fine)
3. Chat page `/t/[handle]`
4. Single system prompt builder (see prompts below)
5. Streaming chat via Grok (fallback OpenAI if key missing — document it)
6. Show last-compiled tweet count and “thin record” if `< 30` usable tweets

### Chat system prompt (v1)

```
You are a simulation of @{handle} ({displayName}) on X.
You are NOT that person. Never claim to be them, to have DMs, or to know private facts.
Speak in their public posting voice. Do not be a helpful assistant unless they post that way.

DISCLOSURE
If asked whether you are real, say you are an AI simulation based on public posts.

PROFILE
{bio}

VOICE
- register: {register}
- length: {avgLength}
- disagreement: {disagreementStyle}
- signature phrases (use sparingly, do not spam): {phrases}
- avoid: {avoids}

STATED POSITIONS (public posts only)
{topics as bullet list: name — stance — side — confidence — lastSeen}

CURRENT CONTEXT (weight this higher than old posts)
{last14dThemes, activeFights, mood}

RECENT PUBLIC POSTS (newest first; each line: [id] [date] [kind] text)
{tweets}

RULES
1. Prefer recent posts when they conflict with older ones. Say the view shifted if both exist.
2. If the question is outside posted topics, say you have no public take. Do not invent one.
3. Match energy: terse accounts stay terse. No corporate warmth unless they write that way.
4. Do not invent biography, jobs, relationships, or off-platform quotes.
5. If you lean on a post, mention it naturally or by date. Do not dump a source list unless asked.
```

### Persona compile prompt (v1 — can be crude)

If compile is too heavy, Phase 1 may hardcode a minimal card (register=mixed, empty topics) and still chat off raw tweets. Prefer a one-shot Zod extract:

```
Read these tweets from @{handle}. Return ONLY JSON matching the PersonaCard schema.

Extract voice from how they write, not from what would sound impressive.
Topics need evidenceIds that exist in the tweet list.
Mark thinRecord true if there is not enough to clone a real voice.
Unknowns = topics a user might ask that this account has not posted about.
Current context = last 14 days only.
If a joke and a sincere take collide, say so in contradictions.
Do not invent topics they did not post.
```

## Claude Code prompt — Phase 1

```
Read BUILD.md Phase 1 and the shared types. Implement Phase 1 only.

1. GetXAPI client in src/lib/x/getxapi.ts with typed responses and pagination.
2. Postgres tables: profiles, tweets (and a simple chats/messages table).
3. Server action or route: POST /api/personas  { handleOrUrl } → fetch profile + up to 100 tweets, store them.
4. Optional one-shot LLM compile into PersonaCard validated by Zod. If compile fails, store a thin fallback card and still allow chat on raw tweets.
5. Page /t/[handle] with streaming chat against Grok using the Phase 1 system prompt.
6. Always render the simulation banner.
7. Add a “Why this answer” collapsible that lists up to 3 tweet URLs you stuffed (even if the model did not cite them). For v1 it is fine to show the most recent tweets used in the prompt.

Write .env.example. Add a script or README section: “Talk to @x with local keys.”
Do not add embeddings, auth, billing, or Jev.
Include a fixture test that builds the system prompt from mock tweets and asserts the disclaimer + handle are present.
```

## Expected outcomes

- Enter `@handle` → wait → chat
- Elon-sim, Naval-sim, and a random mid-size founder-sim feel different within 5 messages
- Thin accounts show a warning, not a fake deep personality
- One conversation persists in the DB for that browser session (cookie or anonymous thread id is enough)

## Acceptance checks

- [ ] Protected/missing user returns a clear error
- [ ] Empty-retweet-only pages are not counted as substance
- [ ] Model says “no public take” on an off-topic question in at least one fixture account
- [ ] Banner cannot be hidden
- [ ] Cost of ingesting 100 tweets is logged (GetXAPI pages * $0.001)

## Exit criteria

You would screenshot a chat and send it to a friend. If voice is generic ChatGPT, **stay in Phase 1** and iterate prompt + tweet mix (add replies/quotes) before Phase 2.

**Tweet mix default:** originals + quotes + replies, drop plain retweets with no quote text.

---

# Phase 2 — Ingest + persona compiler

**Goal:** Type a handle, wait 10–30s, see a persona preview, then chat. Cache 24h.

**Duration:** 1–2 weeks

## Work

- Raise fetch cap to 300–500 tweets (max 25 GetXAPI pages unless configured)
- Also pull `user/tweets_and_replies` or equivalent so argument style is visible
- Dedicated compile job:
  1. LLM proposes topics, phrases, unknowns, mood prose
  2. Zod-validate
  3. Store `persona_cards` with `compiledAt`, `tweetCountUsed`
- Preview UI on `/t/[handle]`:
  - avatar, bio, thin-record flag
  - 6–8 bullets from card
  - topics with confidence
  - Refresh button (bypasses 24h cache)
- Rate limit: 1 compile per handle per 24h unless Refresh
- Fail closed on protected accounts

### Persona preview copy rules

- No “soul,” “clone of the real you,” or “indistinguishable”
- Use “public voice” / “simulated takes from posts”

## Claude Code prompt — Phase 2

```
Read BUILD.md Phase 2. Keep Phase 1 chat working.

Implement the compiler pipeline:
handle → normalize → GetXAPI profile + paginated tweets (cap from env, default 400)
→ store raw tweets → LLM compile to PersonaCard → Zod parse → upsert persona_cards.

Add:
- 24h cache unless refresh=true
- preview panel before/beside chat
- compile status states: fetching, compiling, ready, failed
- tweet cap and page-count logging
- /docs/decisions.md note on why replies/quotes are included

Improve the compile prompt so evidenceIds must be real tweet ids from the payload.
Reject topics with zero matching evidence.

No embeddings. No Jev required yet. No auth.
Add a unit test: compile parser rejects a topic whose evidenceIds are not in the tweet set.
```

## Expected outcomes

- New handle onboarded without code changes
- Preview is recognizable to someone who follows that account
- Recompile is explicit and logged
- Chat uses **card + last N tweets** (N=40 default), not an unbounded dump as accounts get larger

## Acceptance checks

- [ ] Same handle twice in 24h hits cache (verify via log or `compiledAt`)
- [ ] Refresh updates `compiledAt` and tweet snapshot
- [ ] Topic with fake evidence id cannot persist
- [ ] 0 usable tweets → error, not an empty clone

## Exit criteria

5 live handles compile without hand-editing JSON. Preview bullets do not contradict the last week of their timeline.

---

# Phase 2.5 — Optional Jev judgments (do not block Phase 3)

**Goal:** Use TypeSafe Jev for enums/scores only. Skip this phase if no API key.

## What Jev is for

- `register`, `avgLength`, `disagreementStyle` as Choice
- per-topic `side` as Choice
- `confidence` as Score
- Nouls: `onTopic`, `isCurrent`, `inEnvelope`, `contradictsOlder`

## What Jev is not for

- signature phrases
- topic names
- stance sentences
- mood paragraphs
- the chat reply itself

## Pipeline

1. LLM (or clustering) proposes topic names + stance sentences + phrase candidates
2. For each topic, pack supporting tweets into Jev `state`
3. Jev returns side + confidence + currentness
4. Code writes those fields onto `PersonaCard`

## Claude Code prompt — Phase 2.5

```
Read BUILD.md Phase 2.5.

Add an optional Jev adapter behind PERSONA_JUDGE=jev|off (default off).
When on, after LLM extraction, run Jev Choice/Score/Noul questions to fill
register, disagreementStyle, topic.side, topic.confidence.

If TYPESAFE_AI_API_KEY is missing, skip Jev and keep LLM enums.
Do not send the whole 400-tweet corpus as one state; cap state per question
to the top evidence tweets for that topic.

Document the question schemas in src/lib/persona/jev-questions.ts.
No chat-model changes except reading the richer card.
```

## Expected outcomes

- Confidence numbers are usable thresholds (`>= 0.7` = firm take)
- App runs identically with Jev off

## Exit criteria

Turning Jev off does not break compile. Turning it on changes enums/scores, not crash the job.

---

# Phase 3 — Retrieval + current-context brain

**Goal:** Specific old questions work without stuffing 500 tweets. Recency still wins.

**Duration:** 2–3 weeks

## Work

- Embed each tweet (`text + kind + date`)
- `pgvector` or equivalent
- On each user message:
  1. semantic top-k (8–15)
  2. force-include last 20–40 tweets as current context
  3. recency rerank: `score = semantic + λ * exp(-ageDays / 45)` (λ default 0.25)
  4. optional keyword boost if the user named a topic on the card
- Chat prompt receives **card + retrieved tweets only**
- Optional cheap grounding pass or strict instruction: if no retrieved tweet applies, refuse a firm opinion
- Thread memory = this conversation only

### Retrieval system prompt addendum

```
EVIDENCE
Only the posts below may ground a firm take. If they do not cover the question,
say you have no public take. If evidence conflicts by date, say the view shifted.

CURRENT CONTEXT POSTS
{recent}

RETRIEVED POSTS FOR THIS QUESTION
{retrieved}
```

## Claude Code prompt — Phase 3

```
Read BUILD.md Phase 3.

Add tweet embeddings and a retrieveTweets({ handle, query, recentN, k }) function
with recency rerank as specified.

Wire chat to:
- load PersonaCard
- retrieve evidence for the latest user message
- build the Phase 3 prompt
- stream the reply
- store which tweet ids were injected (for the citation UI)

Backfill embeddings for tweets missing them on compile and on chat if needed.
Add a test with frozen tweets:
- query about an old topic finds the old tweet
- a brand-new off-topic query returns no high-semantic hits and the prompt
  still includes recent tweets

Do not add auth or billing.
Keep λ and k in env.
```

## Expected outcomes

- “What did they think about Y last year vs now?” returns dated, sourced contrast
- Token usage per turn stays bounded as corpora grow
- Citations are the retrieved set, not a random recent dump

## Acceptance checks

- [ ] Fixture: two contradictory tweets years apart → answer mentions both dates
- [ ] Fixture: off-topic question → no-firm-take path
- [ ] Explain/Why panel shows the actual injected ids
- [ ] Embedding backfill is idempotent

## Exit criteria

Phase 1 “generic voice” is gone *and* mid-history questions work on a 400-tweet account.

---

# Phase 4 — Productize

**Goal:** Someone else can use it without your laptop.

**Duration:** 2–4 weeks

## Work

- Auth (Clerk / Auth.js — pick one and stick)
- Per-user rate limits: compiles/day, messages/day
- Anonymous try: 1 handle + N messages, then sign-in
- Saved threads, shareable read-only `/c/[id]`
- Background refresh for pinned/popular handles (queue)
- Cost dashboard: GetXAPI pages, LLM tokens, Jev calls
- Model picker later; ship one default
- Legal/UX pass:
  - ToS: simulation, no affiliation, no professional advice
  - Blocklist policy for minors / high-risk impersonation
- Still no auto-post

### Share page

- Read-only transcript
- Banner + profile link
- No “made by the real @{handle}”

## Claude Code prompt — Phase 4

```
Read BUILD.md Phase 4.

Add auth, rate limits, saved threads, and shareable read-only transcripts.
Anonymous users can compile one handle and send a small number of messages.
Document limits in env.

Add a simple admin or /settings cost log table (no fancy charts required).
Add ToS and Privacy pages with the simulation disclaimer.

Do not add posting-to-X, Stripe, or team workspaces unless BUILD.md is updated.
Preserve Phase 3 retrieval behavior.
```

## Expected outcomes

- Deployable to Vercel + managed Postgres
- Abuse path exists (rate limit) before launch screenshots go public
- Shared links are the growth loop

## Acceptance checks

- [ ] Logged-out user hits the cap with a clear upgrade/sign-in message
- [ ] Share link does not expose API keys or raw env
- [ ] Refresh job cannot stampede GetXAPI (concurrency cap)

## Exit criteria

A second person can compile a handle and share a transcript without you in the loop.

---

# Phase 5 — Differentiation (only after real usage)

Do not start because it is interesting. Start because Phase 4 users bounce on a specific failure.

| Bet | Build | Why |
|---|---|---|
| Confidence UI | High / Mixed / No public take from card + Jev | Stops fake certainty |
| Temporal slider | Answer as 2023 vs now using date-filtered retrieval | Unique vs OptimAI-style clones |
| Argument graph | Claims ↔ counter-claims ↔ frequent opponents | Better than a summary card |
| Headline mode | Paste URL; answer with low confidence if they have not posted | News-adjacent use |
| Reply-window mode | “What would they say under this tweet?” | Fits an X-native wedge |
| Eval harness | 20 frozen questions × fixture accounts | Prevents prompt rot |

## Eval harness (do this whenever you touch prompts)

Store under `/evals`:

```
evals/
  accounts/naval.tweets.json
  accounts/naval.expected.md
  questions.json
  runner.ts
```

Score each answer 0–2 on:

1. Voice match (not generic assistant)
2. Stance fidelity (agrees with evidence, or correctly abstains)
3. Hallucination (invented bio/take = automatic 0)

## Claude Code prompt — Phase 5 (pick one bet)

```
Read BUILD.md Phase 5. Implement ONLY the eval harness plus {CHOSEN_BET}.
Do not start multiple bets.
Add /evals fixtures for two accounts using checked-in mock tweets (no live network in CI).
Wire npm run eval and print a table: account, question, scores, fail reasons.
```

## Expected outcomes

- Prompt changes have a regression number
- One differentiator ships complete, not five half-features

## Exit criteria

`npm run eval` is red if you strip the disclaimer or make the bot “helpfully” invent takes.

---

# Prompts library (copy into `src/lib/persona/prompts.ts`)

Keep prompts in code, not only in this file. If they drift, this doc is wrong — update both.

## A. Compile (LLM → PersonaCard JSON)

```
You extract a public-voice card for @{handle} from tweets.

Return JSON only, matching the provided schema.

Rules:
- Use their diction, not a cleaned-up magazine version of them.
- Every topic.evidenceIds must be tweet ids from the input.
- confidence is how clearly the take is stated, not how famous they are.
- thinRecord=true if usable tweets < 30 or voice is generic/inconsistent.
- unknowns: plausible questions this corpus cannot answer.
- currentContext uses only tweets from the last 14 days.
- contradictions require two dated evidence points.
- Never infer private life, income, relationships, or off-platform beliefs.
```

## B. Chat (Grok)

Use Phase 1 prompt until Phase 3, then switch to card + retrieved evidence only.

## C. Abstain classifier (optional LLM or Jev Noul)

```
State: user question + list of retrieved tweet texts.
Question (Noul): Does this account have a clear public take on the user question in the retrieved posts?
If noul < 0.55, the chat model must abstain from a firm stance.
```

## D. Voice self-check (eval only, not production path)

```
Score 0–2: would a follower believe this reply could appear under @{handle}’s posts?
Penalize helpfulness, hedging, and LinkedIn cadence if they do not write that way.
```

---

# Data model (target)

```
profiles
  id, handle unique, userId, name, bio, avatarUrl, isProtected, fetchedAt

tweets
  id pk, handle, text, createdAt, kind, conversationId, quoteText, url, metrics jsonb
  embedding vector nullable

persona_cards
  handle pk, card jsonb, compiledAt, tweetCountUsed, thinRecord, sourceTweetIds

threads
  id, handle, userId nullable, createdAt, shareId unique nullable

messages
  id, threadId, role, content, injectedTweetIds jsonb, createdAt

usage_events
  id, kind (ingest|compile|chat|jev), units, handle, userId, createdAt
```

---

# Default limits

| Knob | v1 default |
|---|---|
| Tweets fetched | 400 |
| GetXAPI pages max | 25 |
| Chat stuffed recent (Phase 1–2) | 40 |
| Retrieve k (Phase 3) | 12 |
| Force-recent N | 30 |
| Recency λ | 0.25 |
| Recency half-life | 45 days |
| Cache compile | 24h |
| Thin record | < 30 usable tweets |
| Firm-take Jev/Noul threshold | 0.55–0.70 (tune) |

---

# Definition of done for the product

A stranger pastes `https://x.com/somehandle`, reads a preview that feels like that timeline, asks a question the account has posted about, gets an in-voice answer with a citation, asks something they have never posted about, and the sim declines to invent a take — with the banner visible the whole time.

If that loop works, ship. Everything else is optional.

---

# Suggested Claude Code sequence

| Session | Phase | Stop when |
|---|---|---|
| 1 | 0 | App boots, parser tests green |
| 2 | 1 | Live chat with 3 different handles feels distinct |
| 3 | 2 | Preview + 24h cache + Zod card |
| 4 | 2.5 optional | Jev off still works |
| 5 | 3 | Retrieval + contradiction fixture passes |
| 6 | 4 | Auth, caps, share links |
| 7 | 5 | Eval harness + one differentiator |

After each session have Claude write a short `PHASE_NOTES.md` append: what shipped, what broke, keys required, remaining bugs. Do not let notes replace this spec.
