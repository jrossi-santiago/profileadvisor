"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { personaBullets, relativeAge } from "@/lib/persona/bullets";
import { progressLabel, readProgress } from "@/lib/persona/progress";
import type { PersonaCard, StoredTweet } from "@/types/persona";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[color:var(--color-edge)] px-2.5 py-0.5 text-xs text-[color:var(--color-muted)]">
      {children}
    </span>
  );
}

/** Confidence >= 0.7 reads as a firm take; below that it is a leaning. */
function ConfidenceBar({ value }: { value: number }) {
  return (
    <span
      className="inline-flex h-1 w-10 overflow-hidden rounded-full bg-[color:var(--color-edge)] align-middle"
      title={`confidence ${value.toFixed(2)}`}
    >
      <span
        className={value >= 0.7 ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-muted)]"}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </span>
  );
}

export function PersonaPreview({
  card,
  tweetCount,
  compiledAt,
  avatarUrl,
  latestTweet,
}: {
  card: PersonaCard;
  tweetCount: number;
  compiledAt: string;
  avatarUrl?: string | null;
  latestTweet?: StoredTweet;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const bullets = personaBullets(card);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshStatus("Re-reading the timeline…");

    try {
      const response = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ handleOrUrl: card.handle, refresh: true }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        setRefreshStatus(payload.error ?? "Refresh failed.");
        return;
      }

      for await (const event of readProgress(response.body)) {
        if (event.state === "failed") {
          setRefreshStatus(event.error);
          return;
        }
        setRefreshStatus(progressLabel(event));
        if (event.state === "ready") {
          router.refresh();
          return;
        }
      }
    } catch (error) {
      setRefreshStatus(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] p-5">
      <div className="flex items-start gap-3">
        {avatarUrl ? (
          // Remote avatars come from X's CDN; a plain img avoids configuring
          // next/image remote patterns for a host we do not control.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full border border-[color:var(--color-edge)]"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--color-edge)] text-lg text-[color:var(--color-muted)]">
            {card.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{card.displayName}</h2>
          <a
            className="text-sm text-[color:var(--color-accent)] underline underline-offset-2"
            href={card.profileUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            @{card.handle} on X
          </a>
        </div>
      </div>

      {card.bio ? <p className="text-sm text-[color:var(--color-muted)]">{card.bio}</p> : null}

      {card.thinRecord ? (
        <p className="rounded-md border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 p-3 text-sm text-[color:var(--color-warn)]">
          Thin public record — only {tweetCount} usable posts. This simulation will abstain often
          rather than invent a personality.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Chip>{card.voice.register}</Chip>
        <Chip>{card.voice.avgLength} posts</Chip>
        <Chip>{tweetCount} posts read</Chip>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
          Public voice
        </h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-[color:var(--color-muted)]">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </div>

      {card.topics.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
            Simulated takes from posts
          </h3>
          <ul className="flex flex-col gap-2">
            {card.topics.slice(0, 6).map((topic) => (
              <li key={topic.name} className="text-sm">
                <span className="font-medium">{topic.name}</span>{" "}
                <ConfidenceBar value={topic.confidence} />
                <span className="text-[color:var(--color-muted)]"> — {topic.stance}</span>
                <span className="ml-1 text-xs text-[color:var(--color-muted)]">({topic.side})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.unknowns.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
            No public take on
          </h3>
          <p className="text-sm text-[color:var(--color-muted)]">{card.unknowns.join(" · ")}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-[color:var(--color-edge)] pt-3">
        <p className="text-xs text-[color:var(--color-muted)]">
          Compiled {relativeAge(compiledAt)} from {card.tweetCountUsed} public posts
          {latestTweet ? `, newest ${latestTweet.createdAt.slice(0, 10)}` : ""}. Cards are reused
          for 24 hours.
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="self-start rounded-md border border-[color:var(--color-edge)] px-3 py-1.5 text-xs text-[color:var(--color-muted)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh from X"}
        </button>
        {refreshStatus ? (
          <p className="text-xs text-[color:var(--color-accent)]">{refreshStatus}</p>
        ) : null}
      </div>
    </aside>
  );
}
