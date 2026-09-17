import { loadTweetsByIds } from "@/lib/persona/store";
import { canonicalHandle } from "@/lib/x/handle";

export const runtime = "nodejs";

/** Caps one lookup, so a long id list cannot be used to dump a whole corpus. */
const MAX_IDS = 25;

/**
 * Resolves tweet ids to their stored records for the "Why this answer" panel.
 * Retrieved evidence can be years old, so the client cannot always find these
 * in the recent posts the page was rendered with.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = canonicalHandle(url.searchParams.get("handle") ?? "");
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (!handle) return Response.json({ error: "Missing handle." }, { status: 400 });
  if (ids.length === 0) return Response.json({ tweets: [] });

  try {
    return Response.json({ tweets: await loadTweetsByIds(handle, ids) });
  } catch (error) {
    console.error("[tweets] lookup failed", error);
    return Response.json({ error: "Could not load those posts." }, { status: 500 });
  }
}
