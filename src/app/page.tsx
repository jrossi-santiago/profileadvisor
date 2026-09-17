import { HandleForm } from "@/components/handle-form";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Talk-To</h1>
        <p className="text-base text-[color:var(--color-muted)]">
          Paste a public X handle. Chat with an AI simulation of how that account posts —
          grounded in its public tweets, weighted toward what it has said recently.
        </p>
      </header>

      <HandleForm />

      <section className="rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] p-5 text-sm leading-relaxed text-[color:var(--color-muted)]">
        <h2 className="mb-2 text-sm font-semibold text-[color:var(--color-warn)]">
          What this is not
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Not the real person, and not affiliated with them.</li>
          <li>It never posts, replies, or sends DMs as anyone.</li>
          <li>It reads public posts only — no protected accounts, no private facts.</li>
          <li>When the account has not posted about something, it says so instead of inventing a take.</li>
        </ul>
      </section>

      <footer className="text-xs text-[color:var(--color-muted)]">
        Reads public posts through GetXAPI. It never posts, replies, or messages anyone.
      </footer>
    </main>
  );
}
