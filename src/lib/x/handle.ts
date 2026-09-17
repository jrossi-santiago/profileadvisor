/**
 * Parsing and normalization for X/Twitter handles and profile URLs.
 *
 * Accepts: `naval`, `@naval`, `x.com/naval`, `https://twitter.com/naval`,
 * `https://x.com/naval/status/123`. Everything else is an error — this is the
 * only door into the product, so it fails loudly rather than guessing.
 */

export type HandleParseErrorCode =
  | "empty"
  | "bad-host"
  | "no-handle"
  | "reserved"
  | "invalid-handle";

export type HandleParseResult =
  | { ok: true; handle: string }
  | { ok: false; code: HandleParseErrorCode; message: string };

export class HandleParseError extends Error {
  readonly code: HandleParseErrorCode;

  constructor(code: HandleParseErrorCode, message: string) {
    super(message);
    this.name = "HandleParseError";
    this.code = code;
  }
}

/** Hosts we treat as X profile URLs. */
const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"]);

/**
 * First path segments that are site routes, not accounts. X itself squats on
 * these, so `x.com/home` must not compile a persona for @home.
 */
const RESERVED_HANDLES = new Set([
  "i",
  "home",
  "explore",
  "search",
  "notifications",
  "messages",
  "settings",
  "compose",
  "intent",
  "hashtag",
  "share",
  "login",
  "logout",
  "signup",
  "account",
  "about",
  "privacy",
  "tos",
  "help",
  "download",
  "jobs",
  "status",
  "notices",
]);

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function fail(code: HandleParseErrorCode, message: string): HandleParseResult {
  return { ok: false, code, message };
}

/** Strips `@`, whitespace, and a trailing `/`; does not validate. */
function stripDecoration(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/\/+$/, "");
}

function validate(candidate: string): HandleParseResult {
  if (!candidate) return fail("no-handle", "No handle found in that input.");
  if (!HANDLE_RE.test(candidate)) {
    return fail(
      "invalid-handle",
      "X handles are 1–15 characters of letters, numbers, or underscores.",
    );
  }
  if (RESERVED_HANDLES.has(candidate.toLowerCase())) {
    return fail("reserved", `"${candidate}" is an X site route, not an account.`);
  }
  return { ok: true, handle: candidate };
}

function looksLikeUrl(input: string): boolean {
  return /^(https?:)?\/\//i.test(input) || /^(www\.|mobile\.)?(x|twitter)\.com\//i.test(input);
}

function parseUrl(input: string): HandleParseResult {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input.replace(/^\/\//, "")}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return fail("bad-host", "That does not look like an X profile URL.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!X_HOSTS.has(host)) {
    return fail("bad-host", "Only x.com and twitter.com profile links are supported.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return fail("no-handle", "That link points at X, but not at an account.");
  }

  // `x.com/i/user/123` and friends carry no handle we can use.
  return validate(decodeURIComponent(segments[0]));
}

/**
 * Parses a handle or X profile URL. Never throws — inspect `ok`.
 * The returned handle preserves the casing the user typed; compare
 * case-insensitively or use {@link canonicalHandle} for storage keys.
 */
export function parseHandleOrUrl(input: string): HandleParseResult {
  if (typeof input !== "string" || input.trim() === "") {
    return fail("empty", "Enter an X handle or profile link.");
  }

  const trimmed = input.trim();
  if (looksLikeUrl(trimmed)) return parseUrl(trimmed);

  // A bare `x.com/naval` with no slash left, or anything with a slash, is still
  // URL-shaped enough that we should not treat it as a handle.
  if (trimmed.includes("/") || trimmed.includes(".")) {
    return fail("bad-host", "That does not look like a handle or an X profile link.");
  }

  return validate(stripDecoration(trimmed));
}

/** Throwing variant for call sites that already handle errors. */
export function parseHandleOrThrow(input: string): string {
  const result = parseHandleOrUrl(input);
  if (!result.ok) throw new HandleParseError(result.code, result.message);
  return result.handle;
}

/** Storage / cache key form: lowercase, no `@`. */
export function canonicalHandle(handle: string): string {
  return handle.toLowerCase();
}

/** Canonical public profile URL for a parsed handle. */
export function profileUrl(handle: string): string {
  return `https://x.com/${handle}`;
}
