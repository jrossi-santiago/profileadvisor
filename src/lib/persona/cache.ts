/**
 * Compile cache policy. One compile per handle per 24h unless the user asks for
 * a refresh — an ingest costs real money per page and a timeline does not
 * change enough in a day to justify re-reading it on every visit.
 */

import type { EnvLike } from "@/types/env";

export const DEFAULT_CACHE_HOURS = 24;

export function cacheWindowMs(env: EnvLike = process.env): number {
  const raw = Number(env.COMPILE_CACHE_HOURS);
  const hours = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CACHE_HOURS;
  return hours * 60 * 60 * 1000;
}

export type CacheDecision =
  | { hit: true; compiledAt: string; ageMs: number }
  | { hit: false; reason: "no-card" | "stale" | "refresh-requested"; compiledAt?: string };

export function decideCache(input: {
  compiledAt?: string | null;
  refresh?: boolean;
  now?: Date;
  windowMs?: number;
}): CacheDecision {
  const { compiledAt, refresh = false } = input;
  const now = input.now ?? new Date();
  const windowMs = input.windowMs ?? cacheWindowMs();

  if (!compiledAt) return { hit: false, reason: "no-card" };
  if (refresh) return { hit: false, reason: "refresh-requested", compiledAt };

  const compiled = new Date(compiledAt);
  if (Number.isNaN(compiled.getTime())) return { hit: false, reason: "no-card" };

  const ageMs = now.getTime() - compiled.getTime();
  // A card dated in the future is a clock problem, not a fresh card; recompile.
  if (ageMs < 0) return { hit: false, reason: "stale", compiledAt };

  return ageMs < windowMs
    ? { hit: true, compiledAt, ageMs }
    : { hit: false, reason: "stale", compiledAt };
}
