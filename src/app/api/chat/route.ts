import { buildPrompt, recentTweetLimit } from "@/lib/chat/system-prompt";
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

  const { system, injectedTweetIds } = buildPrompt({
    card: persona.card,
    tweets: persona.tweets,
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
          detail: { injected: injectedTweetIds.length, model: provider.chatModel },
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
      "X-Injected-Tweet-Ids": injectedTweetIds.slice(0, 50).join(","),
    },
  });
}
