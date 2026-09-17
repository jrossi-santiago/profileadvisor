import { describe, expect, it } from "vitest";
import {
  HandleParseError,
  canonicalHandle,
  parseHandleOrThrow,
  parseHandleOrUrl,
  profileUrl,
} from "@/lib/x/handle";

function handleOf(input: string): string {
  const result = parseHandleOrUrl(input);
  if (!result.ok) throw new Error(`expected ${input} to parse, got ${result.code}`);
  return result.handle;
}

describe("parseHandleOrUrl — accepted forms", () => {
  it("accepts a bare handle", () => {
    expect(handleOf("naval")).toBe("naval");
  });

  it("accepts an @handle", () => {
    expect(handleOf("@naval")).toBe("naval");
  });

  it("accepts an x.com profile URL", () => {
    expect(handleOf("https://x.com/naval")).toBe("naval");
  });

  it("accepts a twitter.com profile URL", () => {
    expect(handleOf("https://twitter.com/naval")).toBe("naval");
  });

  it("extracts the handle from a status URL", () => {
    expect(handleOf("https://x.com/naval/status/1002103360646823936")).toBe("naval");
  });

  it.each([
    ["surrounding whitespace", "  @naval  "],
    ["a trailing slash", "https://x.com/naval/"],
    ["no protocol", "x.com/naval"],
    ["a www subdomain", "https://www.x.com/naval"],
    ["a mobile subdomain", "https://mobile.twitter.com/naval"],
    ["a query string", "https://x.com/naval?lang=en"],
    ["a fragment", "https://x.com/naval#posts"],
    ["a protocol-relative URL", "//x.com/naval"],
    ["a with_replies path", "https://x.com/naval/with_replies"],
    ["http rather than https", "http://twitter.com/naval"],
  ])("tolerates %s", (_label, input) => {
    expect(handleOf(input)).toBe("naval");
  });

  it("keeps handles with underscores, digits, and mixed case", () => {
    expect(handleOf("@Naval_R2")).toBe("Naval_R2");
  });

  it("accepts a 15-character handle", () => {
    expect(handleOf("a".repeat(15))).toBe("a".repeat(15));
  });
});

describe("parseHandleOrUrl — rejected forms", () => {
  it.each([
    ["empty string", "", "empty"],
    ["whitespace only", "   ", "empty"],
    ["junk prose", "this is not a handle", "invalid-handle"],
    ["a non-X URL", "https://example.com/naval", "bad-host"],
    ["a LinkedIn URL", "https://linkedin.com/in/naval", "bad-host"],
    ["x.com with no account", "https://x.com/", "no-handle"],
    ["an email address", "naval@example.com", "bad-host"],
    ["a handle over 15 chars", "a".repeat(16), "invalid-handle"],
    ["illegal characters", "@nav-al", "invalid-handle"],
    ["a site route", "https://x.com/home", "reserved"],
    ["the /i/ namespace", "https://x.com/i/user/12345", "reserved"],
  ] as const)("rejects %s", (_label, input, code) => {
    const result = parseHandleOrUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-string input", () => {
    // Guards the untyped edge: form values arrive as unknown.
    const result = parseHandleOrUrl(undefined as unknown as string);
    expect(result.ok).toBe(false);
  });
});

describe("parseHandleOrThrow", () => {
  it("returns the handle when valid", () => {
    expect(parseHandleOrThrow("https://x.com/naval")).toBe("naval");
  });

  it("throws a typed error when invalid", () => {
    expect(() => parseHandleOrThrow("!!!")).toThrow(HandleParseError);
    try {
      parseHandleOrThrow("");
    } catch (error) {
      expect((error as HandleParseError).code).toBe("empty");
    }
  });
});

describe("helpers", () => {
  it("canonicalizes for storage keys", () => {
    expect(canonicalHandle("Naval_R2")).toBe("naval_r2");
  });

  it("builds a public profile URL", () => {
    expect(profileUrl("naval")).toBe("https://x.com/naval");
  });
});
