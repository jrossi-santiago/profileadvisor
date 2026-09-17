import Link from "next/link";
import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { PersonaPreview } from "@/components/persona-preview";
import { recentTweetLimit } from "@/lib/chat/system-prompt";
import { loadPersona } from "@/lib/persona/store";
import { canonicalHandle, parseHandleOrUrl } from "@/lib/x/handle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return {
    title: `AI simulation of @${handle} — Talk-To`,
    description: `Chat with an AI simulation of @${handle} built from their public X posts. Not the real person.`,
  };
}

export default async function PersonaPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const parsed = parseHandleOrUrl(raw);
  if (!parsed.ok) notFound();

  const handle = canonicalHandle(parsed.handle);
  const persona = await loadPersona(handle, recentTweetLimit());

  if (!persona) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold">No simulation for @{handle} yet</h1>
        <p className="text-[color:var(--color-muted)]">
          This account has not been compiled. Go back and enter the handle to read its public posts
          first.
        </p>
        <Link className="text-[color:var(--color-accent)] underline underline-offset-2" href="/">
          Back to start
        </Link>
      </main>
    );
  }

  return (
    <>
      <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-4">
          <Link
            className="text-sm text-[color:var(--color-muted)] hover:text-[color:var(--color-accent)]"
            href="/"
          >
            ← another account
          </Link>
          <PersonaPreview
            card={persona.card}
            tweetCount={persona.tweetCountUsed}
            latestTweet={persona.tweets[0]}
          />
          {persona.source === "fixture" ? (
            <p className="rounded-md border border-[color:var(--color-edge)] p-3 text-xs text-[color:var(--color-muted)]">
              Development fixture: no database is configured, so this is synthetic data for a
              made-up account, not a real timeline.
            </p>
          ) : null}
        </div>

        <Chat
          handle={persona.card.handle}
          displayName={persona.card.displayName}
          recentTweets={persona.tweets}
        />
      </main>
    </>
  );
}
