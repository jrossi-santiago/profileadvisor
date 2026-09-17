import type { PersonaCard, StoredTweet } from "@/types/persona";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[color:var(--color-edge)] px-2.5 py-0.5 text-xs text-[color:var(--color-muted)]">
      {children}
    </span>
  );
}

/**
 * Copy rules from BUILD.md: "public voice" and "simulated takes from posts".
 * Never "soul", "clone of the real you", or "indistinguishable".
 */
export function PersonaPreview({
  card,
  tweetCount,
  latestTweet,
}: {
  card: PersonaCard;
  tweetCount: number;
  latestTweet?: StoredTweet;
}) {
  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] p-5">
      <div>
        <h2 className="text-lg font-semibold">{card.displayName}</h2>
        <a
          className="text-sm text-[color:var(--color-accent)] underline underline-offset-2"
          href={card.profileUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          @{card.handle} on X
        </a>
        {card.bio ? (
          <p className="mt-2 text-sm text-[color:var(--color-muted)]">{card.bio}</p>
        ) : null}
      </div>

      {card.thinRecord ? (
        <p className="rounded-md border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 p-3 text-sm text-[color:var(--color-warn)]">
          Thin public record — only {tweetCount} usable posts. This simulation will abstain often
          rather than invent a personality.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Chip>{card.voice.register}</Chip>
        <Chip>{card.voice.avgLength} posts</Chip>
        <Chip>disagrees by {card.voice.disagreementStyle}</Chip>
        <Chip>{tweetCount} posts read</Chip>
      </div>

      {card.topics.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
            Simulated takes from posts
          </h3>
          <ul className="flex flex-col gap-2">
            {card.topics.slice(0, 6).map((topic) => (
              <li key={topic.name} className="text-sm">
                <span className="font-medium">{topic.name}</span>
                <span className="text-[color:var(--color-muted)]"> — {topic.stance}</span>
                <span className="ml-1 text-xs text-[color:var(--color-muted)]">
                  ({topic.side}, confidence {topic.confidence.toFixed(2)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.currentContext.last14dThemes.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]">
            Last 14 days
          </h3>
          <p className="text-sm text-[color:var(--color-muted)]">
            {card.currentContext.last14dThemes.join(" · ")}
            {card.currentContext.mood ? ` — reads as ${card.currentContext.mood}` : ""}
          </p>
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

      <p className="text-xs text-[color:var(--color-muted)]">
        Compiled {new Date(card.compiledAt).toLocaleString()} from {card.tweetCountUsed} public
        posts
        {latestTweet ? `, newest ${latestTweet.createdAt.slice(0, 10)}` : ""}.
      </p>
    </aside>
  );
}
