/**
 * Embeddings provider. OpenAI-compatible `/embeddings`, so it works with
 * OpenAI and anything that mirrors that shape.
 *
 * xAI is the default *chat* provider but does not publish an embeddings
 * endpoint, so embeddings resolve separately: EMBEDDING_API_KEY if set,
 * otherwise OPENAI_API_KEY. When neither exists, retrieval degrades to
 * recency-only rather than failing — see retrieveTweets.
 */

import type { EnvLike } from "@/types/env";

export class EmbeddingsNotConfiguredError extends Error {
  constructor() {
    super("No embeddings provider. Set EMBEDDING_API_KEY or OPENAI_API_KEY.");
    this.name = "EmbeddingsNotConfiguredError";
  }
}

export class EmbeddingsError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EmbeddingsError";
    this.status = status;
  }
}

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Must match the vector column width in the schema. */
  dimensions: number;
};

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export function resolveEmbeddingProvider(env: EnvLike = process.env): EmbeddingConfig {
  const apiKey = env.EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new EmbeddingsNotConfiguredError();

  const dims = Number(env.EMBEDDING_DIMENSIONS);
  return {
    baseUrl: env.EMBEDDING_BASE_URL?.trim() || "https://api.openai.com/v1",
    apiKey,
    model: env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    dimensions:
      Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : DEFAULT_EMBEDDING_DIMENSIONS,
  };
}

export function isEmbeddingsConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.EMBEDDING_API_KEY?.trim() || env.OPENAI_API_KEY?.trim());
}

/**
 * What actually gets embedded. Date and kind ride along with the text so a
 * query like "what did they say in 2024" has something to match, and so a
 * reply reads differently from an original with the same words.
 */
export function embeddingInput(tweet: {
  text: string;
  kind: string;
  createdAt: string;
  quoteText?: string | null;
}): string {
  const date = tweet.createdAt.slice(0, 10);
  const quoted = tweet.quoteText ? ` (quoting: ${tweet.quoteText})` : "";
  return `[${date}] [${tweet.kind}] ${tweet.text}${quoted}`;
}

export type EmbedOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

/**
 * Embeds a batch of strings, preserving input order. Batches are capped by the
 * caller; this issues exactly one request.
 */
export async function embedBatch(
  config: EmbeddingConfig,
  inputs: string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await doFetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: inputs,
        dimensions: config.dimensions,
      }),
      signal: options.signal,
    });
  } catch (cause) {
    throw new EmbeddingsError(`Could not reach the embeddings provider: ${String(cause)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new EmbeddingsError(
      `Embeddings provider returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const rows = payload.data;
  if (!Array.isArray(rows) || rows.length !== inputs.length) {
    throw new EmbeddingsError(
      `Embeddings provider returned ${rows?.length ?? 0} vectors for ${inputs.length} inputs.`,
    );
  }

  // The API documents an `index` on each row; sort by it rather than trusting
  // array order, so a reordered response cannot mismatch vectors to tweets.
  const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((row, position) => {
    if (!Array.isArray(row.embedding)) {
      throw new EmbeddingsError(`Embedding ${position} was missing from the response.`);
    }
    if (row.embedding.length !== config.dimensions) {
      throw new EmbeddingsError(
        `Embedding ${position} had ${row.embedding.length} dimensions, expected ${config.dimensions}.`,
      );
    }
    return row.embedding;
  });
}

export async function embedOne(
  config: EmbeddingConfig,
  input: string,
  options: EmbedOptions = {},
): Promise<number[]> {
  const [vector] = await embedBatch(config, [input], options);
  return vector;
}

/** Cosine similarity for two equal-length vectors. Returns 0 for a zero vector. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vectors must have the same length.");

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
