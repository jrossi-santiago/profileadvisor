import { describe, expect, it } from "vitest";
import { progressLabel, readProgress } from "@/lib/persona/progress";
import type { ProgressEvent } from "@/lib/persona/ingest";

/** Streams the given chunks as a body, so line-splitting can be tested. */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<ProgressEvent[]> {
  const events: ProgressEvent[] = [];
  for await (const event of readProgress(bodyOf(chunks))) events.push(event);
  return events;
}

describe("readProgress", () => {
  it("reads one event per line", async () => {
    const events = await collect([
      '{"state":"fetching","handle":"naval"}\n',
      '{"state":"compiling","handle":"naval","tweetCountUsed":400}\n',
    ]);
    expect(events.map((e) => e.state)).toEqual(["fetching", "compiling"]);
  });

  it("reassembles an event split across chunks", async () => {
    const events = await collect(['{"state":"fetch', 'ing","handle":"naval"}\n']);
    expect(events).toEqual([{ state: "fetching", handle: "naval" }]);
  });

  it("reads several events arriving in one chunk", async () => {
    const events = await collect([
      '{"state":"fetching","handle":"a"}\n{"state":"compiling","handle":"a","tweetCountUsed":2}\n',
    ]);
    expect(events).toHaveLength(2);
  });

  it("yields a final line with no trailing newline", async () => {
    const events = await collect(['{"state":"fetching","handle":"naval"}']);
    expect(events).toHaveLength(1);
  });

  it("skips a malformed line without dropping the rest", async () => {
    const events = await collect(['not json\n{"state":"fetching","handle":"naval"}\n']);
    expect(events).toEqual([{ state: "fetching", handle: "naval" }]);
  });

  it("ignores blank lines", async () => {
    const events = await collect(['\n\n{"state":"fetching","handle":"a"}\n\n']);
    expect(events).toHaveLength(1);
  });

  it("drops a truncated final line rather than throwing", async () => {
    const events = await collect(['{"state":"fetching","handle":"a"}\n{"state":"comp']);
    expect(events).toHaveLength(1);
  });
});

describe("progressLabel", () => {
  it("describes each state", () => {
    expect(progressLabel({ state: "fetching", handle: "naval" })).toContain("@naval");
    expect(
      progressLabel({ state: "compiling", handle: "naval", tweetCountUsed: 400 }),
    ).toContain("400");
    expect(progressLabel({ state: "failed", code: "protected", error: "locked" })).toBe("locked");
  });

  it("distinguishes a cached result from a fresh compile", () => {
    const base = {
      handle: "naval",
      displayName: "Naval",
      tweetCountUsed: 400,
      thinRecord: false,
      compiled: true,
      compileError: null,
      pagesFetched: 21,
      estimatedCostUsd: 0.022,
      persisted: true,
    };
    expect(progressLabel({ state: "ready", ...base, cached: false })).toContain("21 pages");
    expect(progressLabel({ state: "ready", ...base, cached: true })).toContain("cached");
  });
});
