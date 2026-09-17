"use client";

import { usePathname } from "next/navigation";

/**
 * Always-on chrome, rendered once from the root layout so no route can ship
 * without it and there is no dismiss control.
 *
 * It reads the handle from the path rather than taking a prop, because a
 * per-page copy would stack a second sticky bar over this one and leave both
 * unreadable — which is worse than no banner at all.
 */
export function SimulationBanner() {
  const pathname = usePathname();
  const match = pathname?.match(/^\/t\/([A-Za-z0-9_]{1,15})/);
  const handle = match?.[1];

  return (
    <div
      role="note"
      className="sticky top-0 z-50 w-full border-b border-[color:var(--color-warn)]/40 bg-[color:var(--color-ink)]/95 px-4 py-2 text-center text-sm text-[color:var(--color-warn)] backdrop-blur"
    >
      AI simulation of {handle ? `@${handle}` : "a public X account"} from public posts. Not
      affiliated. Not the real person.
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
