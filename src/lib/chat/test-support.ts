/**
 * Deterministic stand-in for an embeddings provider, so retrieval can be tested
 * against real pgvector with no API key and no network.
 *
 * It is a hashed bag-of-words: each token lands in a fixed dimension, so two
 * strings sharing vocabulary are genuinely close in cosine terms and strings
 * sharing nothing are near-orthogonal. That is enough to test ranking, the
 * recency rerank, and the no-relevant-evidence path. It is not a real semantic
 * model — it has no synonyms — so fixtures must share literal words.
 */

import { DEFAULT_EMBEDDING_DIMENSIONS, type EmbeddingConfig } from "@/lib/chat/embeddings";

export const fakeEmbeddingProvider: EmbeddingConfig = {
  baseUrl: "https://embeddings.invalid/v1",
  apiKey: "test-key",
  model: "fake-deterministic",
  dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
};

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "but", "of", "to", "in",
  "on", "for", "with", "that", "this", "it", "its", "as", "at", "by", "from", "you",
  "your", "they", "their", "what", "do", "does", "did", "about", "not", "no",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/** FNV-1a, so a token always lands in the same dimension. */
function hashToken(token: string, dimensions: number): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

export function fakeEmbedding(text: string, dimensions = DEFAULT_EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    vector[hashToken(token, dimensions)] += 1;
  }

  // Normalize so cosine similarity is a dot product and magnitudes do not make
  // longer posts look more relevant.
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    // An all-stopword string still needs a valid unit vector.
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

/** A `fetch` that answers the embeddings endpoint with deterministic vectors. */
export function fakeEmbeddingFetch(
  options: { failWith?: number; onCall?: (inputs: string[]) => void } = {},
): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    if (options.failWith) {
      return new Response("embeddings unavailable", { status: options.failWith });
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      input?: string[];
      dimensions?: number;
    };
    const inputs = body.input ?? [];
    options.onCall?.(inputs);

    return Response.json({
      data: inputs.map((text, index) => ({
        index,
        embedding: fakeEmbedding(text, body.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS),
      })),
    });
  }) as unknown as typeof fetch;
}
