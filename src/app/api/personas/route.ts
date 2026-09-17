import { NextResponse } from "next/server";
import {
  IngestError,
  ingestAndCompile,
  toWireSummary,
  type ProgressEvent,
} from "@/lib/persona/ingest";

export const runtime = "nodejs";
/** Ingest walks up to 25 upstream pages then compiles; the default budget is not enough. */
export const maxDuration = 300;

const STATUS_BY_CODE: Record<IngestError["code"], number> = {
  "invalid-handle": 400,
  "not-found": 404,
  protected: 403,
  "no-substance": 422,
  upstream: 502,
  "not-configured": 503,
};

type Parsed = { handleOrUrl: string; refresh: boolean };

function parseBody(body: unknown): Parsed {
  if (typeof body !== "object" || body === null) return { handleOrUrl: "", refresh: false };
  const record = body as Record<string, unknown>;
  return {
    handleOrUrl: typeof record.handleOrUrl === "string" ? record.handleOrUrl : "",
    refresh: record.refresh === true,
  };
}

/**
 * Streams newline-delimited progress when the caller asks for it
 * (`Accept: application/x-ndjson`), so the UI can show fetching → compiling →
 * ready rather than an opaque spinner. Plain JSON otherwise, which keeps curl
 * and any other client simple.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { handleOrUrl, refresh } = parseBody(raw);
  if (!handleOrUrl) {
    return NextResponse.json({ error: "Provide a handle or X profile URL." }, { status: 400 });
  }

  const wantsStream = (request.headers.get("accept") ?? "").includes("application/x-ndjson");

  if (!wantsStream) {
    try {
      return NextResponse.json(toWireSummary(await ingestAndCompile(handleOrUrl, { refresh })));
    } catch (error) {
      if (error instanceof IngestError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: STATUS_BY_CODE[error.code] },
        );
      }
      console.error("[personas] unexpected failure", error);
      return NextResponse.json(
        { error: "Something went wrong compiling that account." },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const summary = await ingestAndCompile(handleOrUrl, { refresh, onProgress: send });
        send({ state: "ready", ...toWireSummary(summary) });
      } catch (error) {
        if (error instanceof IngestError) {
          send({ state: "failed", code: error.code, error: error.message });
        } else {
          console.error("[personas] unexpected failure", error);
          send({
            state: "failed",
            code: "upstream",
            error: "Something went wrong compiling that account.",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    // A streamed body cannot carry a meaningful status code for a late failure,
    // so failures are reported as a `failed` event inside a 200 stream.
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
