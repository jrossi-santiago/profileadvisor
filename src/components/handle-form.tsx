"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { parseHandleOrUrl, profileUrl } from "@/lib/x/handle";

type Status =
  | { state: "idle" }
  | { state: "working"; message: string }
  | { state: "error"; message: string };

export function HandleForm() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const parsed = useMemo(() => (input.trim() ? parseHandleOrUrl(input) : null), [input]);
  const busy = status.state === "working";

  async function compile(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed?.ok || busy) return;

    setStatus({ state: "working", message: `Reading @${parsed.handle}'s public posts…` });

    try {
      const response = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handleOrUrl: input.trim() }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setStatus({ state: "error", message: payload.error ?? "Could not compile that account." });
        return;
      }

      setStatus({ state: "working", message: "Compiling a public-voice card…" });
      router.push(`/t/${payload.handle}`);
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Could not reach the server.",
      });
    }
  }

  return (
    <form className="w-full max-w-xl" onSubmit={compile} aria-describedby="handle-help">
      <label htmlFor="handle" className="block text-sm font-medium text-[color:var(--color-muted)]">
        Public X handle or profile link
      </label>

      <div className="mt-2 flex gap-2">
        <input
          id="handle"
          name="handle"
          autoComplete="off"
          spellCheck={false}
          placeholder="@naval or https://x.com/naval"
          value={input}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          className="w-full rounded-md border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] px-3 py-2 text-base outline-none placeholder:text-[color:var(--color-muted)]/60 focus:border-[color:var(--color-accent)] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!parsed?.ok || busy}
          className="shrink-0 rounded-md border border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/10 px-5 py-2 text-base font-medium text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:border-[color:var(--color-edge)] disabled:bg-[color:var(--color-surface)] disabled:text-[color:var(--color-muted)] disabled:opacity-60"
        >
          {busy ? "…" : "Talk"}
        </button>
      </div>

      <p id="handle-help" className="mt-3 min-h-6 text-sm" aria-live="polite">
        {status.state === "working" ? (
          <span className="text-[color:var(--color-accent)]">{status.message}</span>
        ) : status.state === "error" ? (
          <span className="text-[color:var(--color-warn)]">{status.message}</span>
        ) : parsed === null ? (
          <span className="text-[color:var(--color-muted)]">
            Public accounts only. Protected accounts and minors are out of scope.
          </span>
        ) : parsed.ok ? (
          <span className="text-[color:var(--color-accent)]">
            Reads as{" "}
            <a
              className="underline underline-offset-2"
              href={profileUrl(parsed.handle)}
              target="_blank"
              rel="noreferrer noopener"
            >
              @{parsed.handle}
            </a>
            . Reading ~100 recent posts takes a few seconds.
          </span>
        ) : (
          <span className="text-[color:var(--color-warn)]">{parsed.message}</span>
        )}
      </p>
    </form>
  );
}
