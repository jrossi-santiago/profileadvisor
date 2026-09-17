/**
 * Client-side reader for the NDJSON progress stream from POST /api/personas.
 * Split out of the component so the framing logic is testable.
 */

import type { ProgressEvent } from "@/lib/persona/ingest";

/** Human-readable label per state, shown while an ingest runs. */
export function progressLabel(event: ProgressEvent): string {
  switch (event.state) {
    case "cached":
      return `Using the card compiled ${new Date(event.compiledAt).toLocaleString()}.`;
    case "fetching":
      return `Reading @${event.handle}'s public posts…`;
    case "compiling":
      return `Compiling a public-voice card from ${event.tweetCountUsed} posts…`;
    case "ready":
      return event.cached
        ? `Ready — cached card for @${event.handle}.`
        : `Ready — ${event.tweetCountUsed} posts across ${event.pagesFetched} pages.`;
    case "failed":
      return event.error;
  }
}

/**
 * Yields each complete NDJSON line as a parsed event. A partial line at the end
 * of a chunk is held until the rest arrives; a malformed line is skipped rather
 * than aborting a run that is otherwise fine.
 */
export async function* readProgress(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ProgressEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as ProgressEvent;
      } catch {
        continue;
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as ProgressEvent;
    } catch {
      // A truncated final line means the connection died; the caller's
      // "no ready event" path handles it.
    }
  }
}
