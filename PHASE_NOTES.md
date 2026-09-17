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
