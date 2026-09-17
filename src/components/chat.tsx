"use client";

import { useRef, useState } from "react";
import type { StoredTweet } from "@/types/persona";

type Turn = {
  role: "user" | "assistant";
  content: string;
  /** Posts that were in the prompt for this reply. */
  sources?: StoredTweet[];
};

function WhyThisAnswer({ sources }: { sources: StoredTweet[] }) {
  if (sources.length === 0) return null;

  return (
    <details className="mt-2 text-xs text-[color:var(--color-muted)]">
      <summary className="cursor-pointer select-none hover:text-[color:var(--color-accent)]">
        Why this answer
      </summary>
      <ul className="mt-2 flex flex-col gap-1 border-l border-[color:var(--color-edge)] pl-3">
        {sources.map((tweet) => (
          <li key={tweet.id}>
            <a
              className="underline underline-offset-2 hover:text-[color:var(--color-accent)]"
              href={tweet.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {tweet.createdAt.slice(0, 10)}
            </a>{" "}
            — {tweet.text.slice(0, 110)}
            {tweet.text.length > 110 ? "…" : ""}
          </li>
        ))}
      </ul>
      <p className="mt-2 italic">
        These posts were in the prompt for this reply. They are not necessarily what the simulation
        quoted.
      </p>
    </details>
  );
}

export function Chat({
  handle,
  displayName,
  recentTweets,
}: {
  handle: string;
  displayName: string;
  recentTweets: StoredTweet[];
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadId = useRef<string | undefined>(undefined);

  const byId = new Map(recentTweets.map((tweet) => [tweet.id, tweet]));

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    const history: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(history);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle,
          threadId: threadId.current,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({ error: "Chat failed." }));
        setError(detail.error ?? "Chat failed.");
        setBusy(false);
        return;
      }

      threadId.current = response.headers.get("X-Thread-Id") ?? threadId.current;
      const sources = (response.headers.get("X-Injected-Tweet-Ids") ?? "")
        .split(",")
        .filter(Boolean)
        .map((id) => byId.get(id))
        .filter((tweet): tweet is StoredTweet => Boolean(tweet))
        .slice(0, 3);

      setTurns((current) => [...current, { role: "assistant", content: "", sources }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTurns((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + chunk };
          return next;
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chat failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-[28rem] flex-col gap-4">
      <div className="flex flex-1 flex-col gap-4">
        {turns.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">
            Ask about something {displayName} has posted about. If they have not posted about it,
            the simulation will say it has no public take rather than invent one.
          </p>
        ) : null}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === "user"
                ? "self-end rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] px-4 py-2 text-sm"
                : "rounded-lg border border-[color:var(--color-edge)] px-4 py-3 text-sm"
            }
          >
            {turn.role === "assistant" ? (
              <div className="mb-1 text-xs text-[color:var(--color-muted)]">
                @{handle} — simulated
              </div>
            ) : null}
            <div className="whitespace-pre-wrap">
              {turn.content || (busy ? "…" : "")}
            </div>
            {turn.role === "assistant" && turn.sources ? (
              <WhyThisAnswer sources={turn.sources} />
            ) : null}
          </div>
        ))}

        {error ? (
          <p className="rounded-md border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 p-3 text-sm text-[color:var(--color-warn)]">
            {error}
          </p>
        ) : null}
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Ask the @${handle} simulation something`}
          disabled={busy}
          className="w-full rounded-md border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] px-3 py-2 text-base outline-none placeholder:text-[color:var(--color-muted)]/60 focus:border-[color:var(--color-accent)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="shrink-0 rounded-md border border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/10 px-5 py-2 text-base font-medium text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
