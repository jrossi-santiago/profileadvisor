import { buildPrompt, recentTweetLimit } from "@/lib/chat/system-prompt";
import { retrieveTweets } from "@/lib/chat/retrieval";
import { backfillEmbeddings } from "@/lib/persona/embed";
import {
  isProviderConfigured,
  resolveProvider,
  streamCompletion,
  type ChatMessage,
} from "@/lib/chat/provider";
import { ensureThread, loadPersona, recordUsage, saveMessage } from "@/lib/persona/store";
import { canonicalHandle } from "@/lib/x/handle";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatRequest = {
  handle?: unknown;
  threadId?: unknown;
  messages?: unknown;
};

/** Only user/assistant turns are accepted — the system prompt is ours to set. */
function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): ChatMessage[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    return [{ role, content: content.slice(0, 4000) }];
  });
}

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const handle = typeof body.handle === "string" ? canonicalHandle(body.handle) : "";
  const history = parseMessages(body.messages);
  const threadId = typeof body.threadId === "string" ? body.threadId : crypto.randomUUID();

  if (!handle) return Response.json({ error: "Missing handle." }, { status: 400 });
  if (history.length === 0) return Response.json({ error: "No message to answer." }, { status: 400 });

  if (!isProviderConfigured()) {
    return Response.json(
      { error: "No chat provider configured. Set XAI_API_KEY (or OPENAI_API_KEY) and restart." },
      { status: 503 },
    );
  }

  const persona = await loadPersona(handle, recentTweetLimit());
  if (!persona) {
    return Response.json(
      { error: `No compiled persona for @${handle}. Compile it first.`, code: "not-compiled" },
      { status: 404 },
    );
  }

  const latestQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  // Tweets stored before embeddings were configured, or added by a later
  // refresh, are embedded here. It is a no-op once the corpus is covered.
  await backfillEmbeddings(handle).catch((error) =>
    console.warn("[chat] embedding backfill failed", error),
  );

  const evidence = await retrieveTweets({
    handle,
    query: latestQuestion,
    card: persona.card,
  }).catch((error) => {
    console.warn("[chat] retrieval failed; falling back to recent posts", error);
    return null;
  });

  if (evidence && !evidence.semanticUsed) {
    console.info(`[retrieval] handle=${handle} recency-only reason=${evidence.reason}`);
  }

  const { system, injectedTweetIds } = buildPrompt({
    card: persona.card,
    // Retrieval reads the corpus itself; persona.tweets is the fallback when
    // there is no database behind this request.
    tweets: evidence?.recent.length ? evidence.recent : persona.tweets,
    retrieved: evidence?.retrieved.map((scored) => scored.tweet),
  });

  const latestUserMessage = [...history].reverse().find((m) => m.role === "user");
  await ensureThread(threadId, handle);
  if (latestUserMessage) {
    await saveMessage({ threadId, role: "user", content: latestUserMessage.content });
  }

  const provider = resolveProvider();
  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of streamCompletion(provider, {
          model: provider.chatModel,
          messages: [{ role: "system", content: system }, ...history],
          signal: request.signal,
        })) {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (error) {
        console.error("[chat] stream failed", error);
        controller.enqueue(
          encoder.encode("\n\n[the simulation dropped the connection — try again]"),
        );
      } finally {
        controller.close();
        if (full) {
          await saveMessage({
            threadId,
            role: "assistant",
            content: full,
            injectedTweetIds,
          }).catch((error) => console.error("[chat] could not persist reply", error));
        }
        await recordUsage({
          kind: "chat",
          units: 1,
          costUsd: 0,
          handle,
          detail: {
            injected: injectedTweetIds.length,
            model: provider.chatModel,
            retrieval: evidence?.semanticUsed ? "semantic" : "recency",
            retrieved: evidence?.retrieved.length ?? 0,
          },
        }).catch(() => undefined);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Thread-Id": threadId,
      // The "Why this answer" panel reads the posts that were really in context.
      // Retrieved ids come first so the panel shows question-specific evidence
      // rather than whatever happened to be posted most recently.
      "X-Injected-Tweet-Ids": (evidence?.retrieved.length
        ? [...evidence.retrieved.map((s) => s.tweet.id), ...injectedTweetIds]
        : injectedTweetIds
      )
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, 50)
        .join(","),
      "X-Retrieval-Mode": evidence?.semanticUsed ? "semantic" : "recency",
    },
  });
}
