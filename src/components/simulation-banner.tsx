/**
 * Always-on chrome. Rendered by the root layout so it cannot be dismissed or
 * routed around: every screen in this product says what it is.
 */
export function SimulationBanner({ handle }: { handle?: string }) {
  const target = handle ? `@${handle}` : "a public X account";
  return (
    <div
      role="note"
      className="sticky top-0 z-50 w-full border-b border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 px-4 py-2 text-center text-sm text-[color:var(--color-warn)]"
    >
      AI simulation of {target} from public posts. Not affiliated. Not the real person.
      {handle ? (
        <>
          {" "}
          <a
            className="underline underline-offset-2 hover:text-[color:var(--color-accent)]"
            href={`https://x.com/${handle}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            View the real profile on X
          </a>
        </>
      ) : null}
    </div>
  );
}
