import { describe, expect, it } from "vitest";
import {
  averageLength,
  compilePersona,
  extractJsonObject,
  mergeExtraction,
  pruneUngroundedTopics,
  thinFallbackCard,
  type CompileInput,
} from "@/lib/persona/compile";
import { personaCardSchema } from "@/lib/persona/schema";
import type { ProviderConfig } from "@/lib/chat/provider";
import { makeTweets } from "@/lib/persona/test-support";

const provider: ProviderConfig = {
  name: "xai",
  baseUrl: "https://example.invalid/v1",
  apiKey: "test",
  chatModel: "test-chat",
  compileModel: "test-compile",
};

function input(overrides: Partial<CompileInput> = {}): CompileInput {
  return {
    handle: "testfounder",
    displayName: "Test Founder",
    bio: "Building things.",
    profileUrl: "https://x.com/testfounder",
    tweets: makeTweets(40),
    ...overrides,
  };
}

/** Returns a fetch that answers one chat-completion with `content`. */
function providerReturning(content: string): typeof fetch {
  return (async () =>
    Response.json({ choices: [{ message: { content } }] })) as unknown as typeof fetch;
}

const goodExtraction = {
  thinRecord: false,
  voice: {
    register: "blunt",
    avgLength: "short",
    humor: "dry, punchline-last",
    disagreementStyle: "steelman",
    signaturePhrases: ["ship it"],
    avoids: ["engagement bait"],
  },
  topics: [
    {
      name: "pricing",
      stance: "Pricing pages are written for builders, not buyers.",
      side: "against",
      confidence: 0.82,
      lastSeen: "2026-09-15T00:00:00.000Z",
      evidenceIds: ["t-0", "t-1"],
    },
  ],
  currentContext: { last14dThemes: ["pricing"], activeFights: [], mood: "impatient" },
  knowledgeEnvelope: ["startup pricing"],
  unknowns: ["their view on monetary policy"],
  contradictions: [],
};

describe("helpers", () => {
  it("reads average post length", () => {
    expect(averageLength([])).toBe("short");
    expect(averageLength(makeTweets(3, { text: "short one" }))).toBe("short");
    expect(averageLength(makeTweets(3, { text: "x".repeat(300) }))).toBe("thread");
  });

  it("parses fenced JSON", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON with a chatty prefix", () => {
    expect(extractJsonObject('Sure! Here you go:\n{"a":1}')).toEqual({ a: 1 });
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("pruneUngroundedTopics", () => {
  it("drops a topic whose evidence ids are not in the corpus", () => {
    const { kept, dropped } = pruneUngroundedTopics(
      [
        { name: "real", evidenceIds: ["t-1"] },
        { name: "invented", evidenceIds: ["does-not-exist"] },
      ],
      new Set(["t-1"]),
    );

    expect(dropped).toBe(1);
    expect(kept.map((t) => t.name)).toEqual(["real"]);
  });

  it("keeps a topic but strips its invented ids", () => {
    const { kept } = pruneUngroundedTopics(
      [{ name: "mixed", evidenceIds: ["t-1", "fake"] }],
      new Set(["t-1"]),
    );
    expect(kept[0].evidenceIds).toEqual(["t-1"]);
  });
});

describe("mergeExtraction", () => {
  it("takes identity and counts from the app, not the model", () => {
    const card = mergeExtraction(input(), {
      ...goodExtraction,
      voice: { ...goodExtraction.voice },
    } as never);

    expect(card.handle).toBe("testfounder");
    expect(card.tweetCountUsed).toBe(40);
    expect(personaCardSchema.safeParse(card).success).toBe(true);
  });

  it("forces thinRecord on a short corpus even when the model says otherwise", () => {
    const card = mergeExtraction(input({ tweets: makeTweets(12) }), {
      ...goodExtraction,
      thinRecord: false,
      topics: [],
    } as never);

    expect(card.thinRecord).toBe(true);
  });
});

describe("compilePersona", () => {
  it("produces a schema-valid card from a good extraction", async () => {
    const outcome = await compilePersona(input(), {
      provider,
      fetchImpl: providerReturning(JSON.stringify(goodExtraction)),
    });

    expect(outcome.compiled).toBe(true);
    expect(outcome.card.voice.register).toBe("blunt");
    expect(outcome.card.topics).toHaveLength(1);
    expect(personaCardSchema.safeParse(outcome.card).success).toBe(true);
  });

  it("falls back to a thin card when the model returns junk", async () => {
    const outcome = await compilePersona(input(), {
      provider,
      fetchImpl: providerReturning("I'm afraid I can't do that."),
    });

    expect(outcome.compiled).toBe(false);
    expect(outcome.card.thinRecord).toBe(true);
    expect(outcome.error).toBeTruthy();
    expect(personaCardSchema.safeParse(outcome.card).success).toBe(true);
  });

  it("falls back when the extraction fails validation", async () => {
    const bad = { ...goodExtraction, voice: { ...goodExtraction.voice, register: "wizard" } };
    const outcome = await compilePersona(input(), {
      provider,
      fetchImpl: providerReturning(JSON.stringify(bad)),
    });

    expect(outcome.compiled).toBe(false);
    expect(outcome.error).toContain("validation");
  });

  it("falls back when the provider errors", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const outcome = await compilePersona(input(), { provider, fetchImpl: failing });

    expect(outcome.compiled).toBe(false);
    expect(outcome.card.topics).toEqual([]);
  });

  it("refuses to compile an empty corpus without calling the model", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return Response.json({});
    }) as unknown as typeof fetch;

    const outcome = await compilePersona(input({ tweets: [] }), { provider, fetchImpl: spy });

    expect(called).toBe(false);
    expect(outcome.compiled).toBe(false);
    expect(outcome.error).toContain("No usable tweets");
  });

  it("drops a topic citing a tweet that is not in the corpus", async () => {
    const hallucinated = {
      ...goodExtraction,
      topics: [{ ...goodExtraction.topics[0], evidenceIds: ["not-a-real-id"] }],
    };
    const outcome = await compilePersona(input(), {
      provider,
      fetchImpl: providerReturning(JSON.stringify(hallucinated)),
    });

    expect(outcome.compiled).toBe(true);
    expect(outcome.card.topics).toHaveLength(0);
  });

  it("always returns a card that survives the card schema", async () => {
    const outcome = await compilePersona(input({ tweets: makeTweets(1) }), {
      provider,
      fetchImpl: providerReturning("{}"),
    });
    expect(personaCardSchema.safeParse(outcome.card).success).toBe(true);
  });
});

describe("thinFallbackCard", () => {
  it("claims no topics and admits it is thin", () => {
    const card = thinFallbackCard(input());
    expect(card.thinRecord).toBe(true);
    expect(card.topics).toEqual([]);
    expect(card.unknowns).toEqual([]);
  });
});
