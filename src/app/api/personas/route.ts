import { NextResponse } from "next/server";
import { IngestError, ingestAndCompile } from "@/lib/persona/ingest";

export const runtime = "nodejs";
/** Ingest walks up to 25 upstream pages; the default 15s budget is not enough. */
export const maxDuration = 120;

const STATUS_BY_CODE: Record<IngestError["code"], number> = {
  "invalid-handle": 400,
  "not-found": 404,
  protected: 403,
  "no-substance": 422,
  upstream: 502,
  "not-configured": 503,
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const handleOrUrl =
    typeof body === "object" && body !== null && "handleOrUrl" in body
      ? String((body as { handleOrUrl: unknown }).handleOrUrl)
      : "";

  if (!handleOrUrl) {
    return NextResponse.json({ error: "Provide a handle or X profile URL." }, { status: 400 });
  }

  try {
    const summary = await ingestAndCompile(handleOrUrl);
    return NextResponse.json({
      handle: summary.handle,
      displayName: summary.displayName,
      tweetCountUsed: summary.tweetCountUsed,
      thinRecord: summary.thinRecord,
      compiled: summary.compiled,
      compileError: summary.compileError ?? null,
      pagesFetched: summary.pagesFetched,
      estimatedCostUsd: summary.estimatedCostUsd,
      persisted: summary.persisted,
    });
  } catch (error) {
    if (error instanceof IngestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: STATUS_BY_CODE[error.code] },
      );
    }
    console.error("[personas] unexpected failure", error);
    return NextResponse.json({ error: "Something went wrong compiling that account." }, { status: 500 });
  }
}
