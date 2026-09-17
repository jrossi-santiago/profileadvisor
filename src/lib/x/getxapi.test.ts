import { describe, expect, it } from "vitest";
import {
  COST_PER_CALL_USD,
  GetXApiClient,
  GetXApiError,
  classifyTweet,
  cleanTweetText,
  isUsableTweet,
  parseTweetDate,
} from "@/lib/x/getxapi";
import profileFixture from "@/lib/x/fixtures/profile.json";
import protectedFixture from "@/lib/x/fixtures/profile-protected.json";
import page1 from "@/lib/x/fixtures/tweets-page-1.json";
import page2 from "@/lib/x/fixtures/tweets-page-2.json";
import retweetsOnly from "@/lib/x/fixtures/tweets-retweets-only.json";
import repliesPage from "@/lib/x/fixtures/tweets-replies-page-1.json";

/** Serves fixtures by URL so no test touches the network. */
function mockFetch(routes: {
  info?: unknown;
  pages?: unknown[];
  replyPages?: unknown[];
  status?: number;
}) {
  const pages = routes.pages ?? [];
  const replyPages = routes.replyPages ?? [];
  let pageIndex = 0;
  let replyIndex = 0;
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];

  const impl = (async (input: string, init?: RequestInit) => {
    calls.push(input);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    if (routes.status && routes.status !== 200) {
      return new Response("upstream said no", { status: routes.status });
    }
    if (input.includes("/twitter/user/info")) {
      return Response.json(routes.info);
    }
    if (input.includes("/twitter/user/tweets_and_replies")) {
      const body = replyPages.length
        ? replyPages[Math.min(replyIndex, replyPages.length - 1)]
        : { tweets: [], has_more: false, next_cursor: null };
      replyIndex += 1;
      return Response.json(body);
    }
    const body = pages[Math.min(pageIndex, pages.length - 1)];
    pageIndex += 1;
    return Response.json(body);
  }) as unknown as typeof fetch;

  return { impl, calls, headers };
}

function client(routes: Parameters<typeof mockFetch>[0]) {
  const { impl, calls, headers } = mockFetch(routes);
  return {
    api: new GetXApiClient({ apiKey: "test-key", fetchImpl: impl }),
    calls,
    headers,
  };
}

describe("text and date helpers", () => {
  it("strips a trailing t.co link but keeps inline links", () => {
    expect(cleanTweetText("a take https://t.co/abc123")).toBe("a take");
    expect(cleanTweetText("read https://t.co/abc123 then think")).toBe(
      "read https://t.co/abc123 then think",
    );
  });

  it("parses X's legacy timestamp into ISO", () => {
    expect(parseTweetDate("Mon Sep 15 13:44:55 +0000 2026")).toBe("2026-09-15T13:44:55.000Z");
  });

  it("returns null for an unparseable or missing date", () => {
    expect(parseTweetDate("not a date at all")).toBeNull();
    expect(parseTweetDate(undefined)).toBeNull();
  });
});

describe("classifyTweet", () => {
  const base = {
    id: "1",
    text: "hello",
    isReply: false,
    retweetCount: 0,
    replyCount: 0,
    likeCount: 0,
    quoteCount: 0,
  };

  it("detects a retweet from the RT prefix", () => {
    expect(classifyTweet({ ...base, text: "RT @someone: not mine" })).toBe("retweet");
  });

  it("detects a retweet from the nested payload", () => {
    expect(classifyTweet({ ...base, retweeted_tweet: { text: "not mine" } })).toBe("retweet");
  });

  it("detects a quote", () => {
    expect(classifyTweet({ ...base, quoted_tweet: { text: "their take" } })).toBe("quote");
  });

  it("detects a reply", () => {
    expect(classifyTweet({ ...base, isReply: true })).toBe("reply");
  });

  it("falls through to original", () => {
    expect(classifyTweet(base)).toBe("original");
  });
});

describe("fetchProfile", () => {
  it("maps a public profile", async () => {
    const { api } = client({ info: profileFixture });
    const profile = await api.fetchProfile("testfounder");

    expect(profile.handle).toBe("testfounder");
    expect(profile.displayName).toBe("Test Founder");
    expect(profile.isProtected).toBe(false);
    expect(profile.profileUrl).toBe("https://x.com/testfounder");
    expect(profile.followers).toBe(48211);
  });

  it("fails closed on a protected account", async () => {
    const { api } = client({ info: protectedFixture });
    await expect(api.fetchProfile("lockedaccount")).rejects.toMatchObject({
      name: "GetXApiError",
      code: "protected",
    });
  });

  it("reports a missing account clearly", async () => {
    const { api } = client({ info: { error: "Could not find user @nope" } });
    const error = await api.fetchProfile("nope").catch((e: GetXApiError) => e);
    expect(error).toBeInstanceOf(GetXApiError);
    expect((error as GetXApiError).code).toBe("not-found");
  });

  it("reports a 404 from the upstream", async () => {
    const { api } = client({ info: profileFixture, status: 404 });
    await expect(api.fetchProfile("nope")).rejects.toMatchObject({ code: "not-found" });
  });

  it("reports a rate limit", async () => {
    const { api } = client({ info: profileFixture, status: 429 });
    await expect(api.fetchProfile("x")).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("rejects a response that does not match the documented shape", async () => {
    const { api } = client({ info: { status: "success", data: { nonsense: true } } });
    await expect(api.fetchProfile("x")).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("fetchTweets", () => {
  it("drops plain retweets and skips unparseable dates", async () => {
    const { api } = client({ info: profileFixture, pages: [page1, page2] });
    const result = await api.fetchTweets({ handle: "testfounder", cap: 100, maxPages: 25 });

    const ids = result.tweets.map((t) => t.id);
    expect(ids).not.toContain("1900000000000000002"); // the RT
    expect(ids).not.toContain("1900000000000000006"); // the bad date
    expect(result.droppedRetweets).toBe(1);
  });

  it("deduplicates a tweet repeated across pages", async () => {
    const { api } = client({ info: profileFixture, pages: [page1, page2] });
    const result = await api.fetchTweets({ handle: "testfounder", cap: 100, maxPages: 25 });

    const repeated = result.tweets.filter((t) => t.id === "1900000000000000004");
    expect(repeated).toHaveLength(1);
    expect(result.pagesFetched).toBe(2);
  });

  it("maps a quote tweet's quoted text and a reply's parent", async () => {
    const { api } = client({ info: profileFixture, pages: [page1, page2] });
    const { tweets } = await api.fetchTweets({ handle: "testfounder", cap: 100, maxPages: 25 });

    const quote = tweets.find((t) => t.id === "1900000000000000004");
    expect(quote?.kind).toBe("quote");
    expect(quote?.quoteText).toBe("Seed rounds are now just a tax on impatience");

    const reply = tweets.find((t) => t.id === "1900000000000000003");
    expect(reply?.kind).toBe("reply");
    expect(reply?.inReplyToId).toBe("1899999999999999999");
  });

  it("normalizes handle casing on stored tweets", async () => {
    const { api } = client({ info: profileFixture, pages: [page1] });
    const { tweets } = await api.fetchTweets({ handle: "TestFounder", cap: 100, maxPages: 1 });
    expect(tweets.every((t) => t.handle === "testfounder")).toBe(true);
  });

  it("stops at the cap without burning more pages", async () => {
    const { api, calls } = client({ info: profileFixture, pages: [page1, page2] });
    const result = await api.fetchTweets({ handle: "testfounder", cap: 2, maxPages: 25 });

    expect(result.tweets).toHaveLength(2);
    expect(result.pagesFetched).toBe(1);
    expect(calls.filter((c) => c.includes("user/tweets"))).toHaveLength(1);
  });

  it("stops at maxPages even when the cursor continues", async () => {
    const alwaysMore = { ...page1, has_more: true, next_cursor: "more" };
    const { api } = client({ info: profileFixture, pages: [alwaysMore] });
    const result = await api.fetchTweets({ handle: "testfounder", cap: 10_000, maxPages: 3 });
    expect(result.pagesFetched).toBe(3);
  });

  it("treats a retweet-only timeline as zero substance", async () => {
    const { api } = client({ info: profileFixture, pages: [retweetsOnly] });
    const result = await api.fetchTweets({ handle: "amplifier", cap: 100, maxPages: 25 });

    expect(result.tweets).toHaveLength(0);
    expect(result.droppedRetweets).toBe(2);
    expect(result.tweets.filter(isUsableTweet)).toHaveLength(0);
  });
});

describe("ingest", () => {
  it("returns newest-first tweets and logs the cost of the run", async () => {
    const { api, calls } = client({ info: profileFixture, pages: [page1, page2] });
    const result = await api.ingest("testfounder", { cap: 100, maxPages: 25 });

    const dates = result.tweets.map((t) => t.createdAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);

    expect(result.apiCalls).toBe(calls.length);
    expect(result.estimatedCostUsd).toBeCloseTo(calls.length * COST_PER_CALL_USD, 5);
    expect(result.usableCount).toBe(result.tweets.length);
  });

  it("sends the bearer token and prefers userId for the main timeline", async () => {
    const { api, calls, headers } = client({ info: profileFixture, pages: [page1, page2] });
    await api.ingest("testfounder", { cap: 100, maxPages: 25 });

    expect(headers[0].Authorization).toBe("Bearer test-key");
    expect(headers.every((h) => h.Authorization === "Bearer test-key")).toBe(true);
    expect(calls[0]).toContain("userName=testfounder");
    expect(calls[1]).toContain("userId=745273");
  });

  it("also walks the replies timeline and merges it in", async () => {
    const { api, calls } = client({
      info: profileFixture,
      pages: [page1, page2],
      replyPages: [repliesPage],
    });
    const result = await api.ingest("testfounder", { cap: 100, maxPages: 25 });

    expect(calls.some((c) => c.includes("/twitter/user/tweets_and_replies"))).toBe(true);
    expect(result.bySource.tweets_and_replies).toBe(2);

    const ids = result.tweets.map((t) => t.id);
    expect(ids).toContain("1900000000000000010"); // reply only on the replies tab
    expect(ids).toContain("1900000000000000011");
  });

  it("stores a post returned by both timelines exactly once", async () => {
    const { api } = client({
      info: profileFixture,
      pages: [page1, page2],
      replyPages: [repliesPage],
    });
    const result = await api.ingest("testfounder", { cap: 100, maxPages: 25 });

    // 1900000000000000001 appears in both fixtures.
    const repeated = result.tweets.filter((t) => t.id === "1900000000000000001");
    expect(repeated).toHaveLength(1);
  });

  it("queries the replies timeline by userName, which is all it accepts", async () => {
    const { api, calls } = client({
      info: profileFixture,
      pages: [page1, page2],
      replyPages: [repliesPage],
    });
    await api.ingest("testfounder", { cap: 100, maxPages: 25 });

    const replyCall = calls.find((c) => c.includes("tweets_and_replies"))!;
    expect(replyCall).toContain("userName=testfounder");
    expect(replyCall).not.toContain("userId=");
  });

  it("skips the replies timeline when the cap is already met", async () => {
    const { api, calls } = client({
      info: profileFixture,
      pages: [page1],
      replyPages: [repliesPage],
    });
    await api.ingest("testfounder", { cap: 2, maxPages: 25 });

    expect(calls.some((c) => c.includes("tweets_and_replies"))).toBe(false);
  });

  it("skips the replies timeline when the page budget is spent", async () => {
    const alwaysMore = { ...page1, has_more: true, next_cursor: "more" };
    const { api, calls } = client({
      info: profileFixture,
      pages: [alwaysMore],
      replyPages: [repliesPage],
    });
    await api.ingest("testfounder", { cap: 10_000, maxPages: 2 });

    expect(calls.some((c) => c.includes("tweets_and_replies"))).toBe(false);
  });

  it("can be told not to read replies", async () => {
    const { api, calls } = client({
      info: profileFixture,
      pages: [page1, page2],
      replyPages: [repliesPage],
    });
    const result = await api.ingest("testfounder", {
      cap: 100,
      maxPages: 25,
      includeReplies: false,
    });

    expect(calls.some((c) => c.includes("tweets_and_replies"))).toBe(false);
    expect(result.bySource.tweets_and_replies).toBe(0);
  });
});
