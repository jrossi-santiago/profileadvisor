"use client";

import { useMemo, useState } from "react";
import { parseHandleOrUrl, profileUrl } from "@/lib/x/handle";

/**
 * Phase 0: validates input locally and shows what would be compiled.
 * The Talk button stays disabled until Phase 1 wires ingest + chat.
 */
export function HandleForm() {
  const [input, setInput] = useState("");

  const result = useMemo(() => (input.trim() ? parseHandleOrUrl(input) : null), [input]);

  return (
    <form
      className="w-full max-w-xl"
      onSubmit={(event) => event.preventDefault()}
      aria-describedby="handle-help"
    >
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
          onChange={(event) => setInput(event.target.value)}
          className="w-full rounded-md border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] px-3 py-2 text-base outline-none placeholder:text-[color:var(--color-muted)]/60 focus:border-[color:var(--color-accent)]"
        />
        <button
          type="submit"
          disabled
          title="Chat arrives in Phase 1"
          className="shrink-0 rounded-md border border-[color:var(--color-edge)] bg-[color:var(--color-surface)] px-5 py-2 text-base font-medium text-[color:var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Talk
        </button>
      </div>

      <p id="handle-help" className="mt-3 min-h-6 text-sm" aria-live="polite">
        {result === null ? (
          <span className="text-[color:var(--color-muted)]">
            Public accounts only. Protected accounts and minors are out of scope.
          </span>
        ) : result.ok ? (
          <span className="text-[color:var(--color-accent)]">
            Reads as{" "}
            <a
              className="underline underline-offset-2"
              href={profileUrl(result.handle)}
              target="_blank"
              rel="noreferrer noopener"
            >
              @{result.handle}
            </a>
            . Ingest and chat arrive in Phase 1.
          </span>
        ) : (
          <span className="text-[color:var(--color-warn)]">{result.message}</span>
        )}
      </p>
    </form>
  );
}
