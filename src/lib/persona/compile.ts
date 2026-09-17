/**
 * Persona compilation: tweets in, PersonaCard out.
 *
 * Compilation is best-effort by design. A model that returns junk, invents
 * evidence ids, or times out must not block chat — the fallback is a thin card
 * that admits it knows little, which is a safer failure than a confident
 * fabrication.
 */

import { z } from "zod";
import { personaExtractionSchema } from "@/lib/persona/schema";
import { buildCompilePrompt } from "@/lib/persona/prompts";
import { complete, resolveProvider, type ProviderConfig } from "@/lib/chat/provider";
import type { PersonaCard, StoredTweet } from "@/types/persona";

/** Below this many usable tweets there is not enough to clone a voice. */
export const THIN_RECORD_THRESHOLD = 30;

export type CompileInput = {
  handle: string;
  displayName: string;
  bio: string;
  profileUrl: string;
  tweets: StoredTweet[];
};

export type CompileOutcome = {
  card: PersonaCard;
  /** False when the fallback card was used. */
  compiled: boolean;
  error?: string;
  sourceTweetIds: string[];
};

/**
 * A card that claims nothing beyond the account's identity. Chat still works —
 * it just runs off the raw posts with no extracted positions to lean on.
 */
export function thinFallbackCard(input: CompileInput): PersonaCard {
  return {
    handle: input.handle,
    displayName: input.displayName,
    bio: input.bio,
    profileUrl: input.profileUrl,
    compiledAt: new Date().toISOString(),
    tweetCountUsed: input.tweets.length,
    thinRecord: true,
    voice: {
      register: "mixed",
      avgLength: averageLength(input.tweets),
      humor: "",
      disagreementStyle: "clarify",
      signaturePhrases: [],
      avoids: [],
    },
    topics: [],
    currentContext: { last14dThemes: [], activeFights: [], mood: "" },
    knowledgeEnvelope: [],
    unknowns: [],
    contradictions: [],
  };
}

/** Cheap structural read of post length, used by the fallback card. */
export function averageLength(tweets: StoredTweet[]): PersonaCard["voice"]["avgLength"] {
  if (tweets.length === 0) return "short";
  const mean = tweets.reduce((sum, t) => sum + t.text.length, 0) / tweets.length;
  if (mean < 120) return "short";
  if (mean < 240) return "medium";
  return "thread";
}

/**
 * Drops topics whose evidence does not exist in the corpus. A topic with an
 * invented id is a hallucination wearing a citation, so it does not survive.
 */
export function pruneUngroundedTopics<T extends { evidenceIds: string[] }>(
  topics: T[],
  knownIds: Set<string>,
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;

  for (const topic of topics) {
    const grounded = topic.evidenceIds.filter((id) => knownIds.has(id));
    if (grounded.length === 0) {
      dropped += 1;
      continue;
    }
    kept.push({ ...topic, evidenceIds: grounded });
  }

  return { kept, dropped };
}

/** Pulls the JSON object out of a reply that may be fenced or prefixed. */
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object found in the reply.");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Merges a validated extraction with facts the application already knows.
 * Identity, counts, and compiledAt are never taken from the model.
 */
export function mergeExtraction(
  input: CompileInput,
  extraction: z.infer<typeof personaExtractionSchema>,
): PersonaCard {
  const knownIds = new Set(input.tweets.map((t) => t.id));
  const { kept } = pruneUngroundedTopics(extraction.topics, knownIds);

  return {
    handle: input.handle,
    displayName: input.displayName,
    bio: input.bio,
    profileUrl: input.profileUrl,
    compiledAt: new Date().toISOString(),
    tweetCountUsed: input.tweets.length,
    thinRecord: extraction.thinRecord || input.tweets.length < THIN_RECORD_THRESHOLD,
    voice: extraction.voice,
    topics: kept,
    currentContext: extraction.currentContext,
    knowledgeEnvelope: extraction.knowledgeEnvelope,
    unknowns: extraction.unknowns,
    contradictions: extraction.contradictions,
  };
}

export async function compilePersona(
  input: CompileInput,
  options: { provider?: ProviderConfig; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<CompileOutcome> {
  const sourceTweetIds = input.tweets.map((t) => t.id);

  if (input.tweets.length === 0) {
    return {
      card: thinFallbackCard(input),
      compiled: false,
      error: "No usable tweets to compile from.",
      sourceTweetIds,
    };
  }

  let provider: ProviderConfig;
  try {
    provider = options.provider ?? resolveProvider();
  } catch (error) {
    return {
      card: thinFallbackCard(input),
      compiled: false,
      error: error instanceof Error ? error.message : String(error),
      sourceTweetIds,
    };
  }

  try {
    const raw = await complete(provider, {
      model: provider.compileModel,
      json: true,
      temperature: 0.1,
      maxTokens: 4000,
      signal: options.signal,
      fetchImpl: options.fetchImpl,
      messages: [
        {
          role: "system",
          content:
            "You extract structured public-voice cards from tweets. Return a single JSON object and nothing else.",
        },
        {
          role: "user",
          content: buildCompilePrompt({
            handle: input.handle,
            displayName: input.displayName,
            bio: input.bio,
            tweets: input.tweets,
            today: new Date().toISOString().slice(0, 10),
          }),
        },
      ],
    });

    const parsed = personaExtractionSchema.safeParse(extractJsonObject(raw));
    if (!parsed.success) {
      return {
        card: thinFallbackCard(input),
        compiled: false,
        error: `Compile output failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        sourceTweetIds,
      };
    }

    return { card: mergeExtraction(input, parsed.data), compiled: true, sourceTweetIds };
  } catch (error) {
    return {
      card: thinFallbackCard(input),
      compiled: false,
      error: error instanceof Error ? error.message : String(error),
      sourceTweetIds,
    };
  }
}
