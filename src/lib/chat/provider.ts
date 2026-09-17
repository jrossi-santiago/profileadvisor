/**
 * Chat model provider. xAI Grok is the default; OpenAI is the fallback when
 * XAI_API_KEY is absent. Both speak the OpenAI chat-completions shape, so one
 * hand-rolled client covers them and keeps an SDK out of the dependency tree.
 */

import type { EnvLike } from "@/types/env";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super("No chat provider configured. Set XAI_API_KEY (preferred) or OPENAI_API_KEY.");
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export type ProviderConfig = {
  name: "xai" | "openai";
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  /** Cheaper/faster model used for persona compilation. */
  compileModel: string;
};

export function resolveProvider(env: EnvLike = process.env): ProviderConfig {
  const xaiKey = env.XAI_API_KEY?.trim();
  if (xaiKey) {
    return {
      name: "xai",
      baseUrl: env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1",
      apiKey: xaiKey,
      chatModel: env.XAI_CHAT_MODEL?.trim() || "grok-4",
      compileModel: env.XAI_COMPILE_MODEL?.trim() || env.XAI_CHAT_MODEL?.trim() || "grok-4-fast",
    };
  }

  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      name: "openai",
      baseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
      apiKey: openaiKey,
      chatModel: env.OPENAI_CHAT_MODEL?.trim() || "gpt-4.1",
      compileModel: env.OPENAI_COMPILE_MODEL?.trim() || "gpt-4.1-mini",
    };
  }

  throw new ProviderNotConfiguredError();
}

export function isProviderConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.XAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim());
}

type CompletionOptions = {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object back. Used by the persona compiler. */
  json?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

async function post(
  config: ProviderConfig,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (cause) {
    throw new ProviderError(`Could not reach ${config.name}: ${String(cause)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      `${config.name} returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      response.status,
    );
  }
  return response;
}

/** One-shot completion. Used by the persona compiler. */
export async function complete(
  config: ProviderConfig,
  options: CompletionOptions,
): Promise<string> {
  const response = await post(
    config,
    {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4000,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    },
    options,
  );

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new ProviderError(`${config.name} returned an empty completion.`);
  }
  return content;
}

/**
 * Streaming completion, yielding text deltas. Parses the OpenAI SSE framing
 * directly: `data: {json}` lines terminated by `data: [DONE]`.
 */
export async function* streamCompletion(
  config: ProviderConfig,
  options: CompletionOptions,
): AsyncGenerator<string> {
  const response = await post(
    config,
    {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.8,
      max_tokens: options.maxTokens ?? 1200,
      stream: true,
    },
    options,
  );

  if (!response.body) throw new ProviderError("Provider returned no stream body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The last element may be a partial line; keep it for the next chunk.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // A malformed frame mid-stream should not kill a good reply.
        continue;
      }
    }
  }
}
