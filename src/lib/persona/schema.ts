/**
 * Zod mirror of src/types/persona.ts. This is the source of truth at runtime:
 * an LLM's JSON only becomes a PersonaCard by surviving personaCardSchema.
 */

import { z } from "zod";

export const voiceRegisterSchema = z.enum([
  "blunt",
  "academic",
  "shitposter",
  "founder-threader",
  "mixed",
]);

export const avgLengthSchema = z.enum(["short", "medium", "thread"]);

export const disagreementStyleSchema = z.enum([
  "ratio",
  "steelman",
  "ignore",
  "pile-on",
  "clarify",
]);

export const stanceSideSchema = z.enum(["for", "against", "mixed", "joke-only", "unclear"]);

export const tweetKindSchema = z.enum(["original", "reply", "quote", "retweet"]);

export const personaTopicSchema = z.object({
  name: z.string().min(1),
  stance: z.string().min(1),
  side: stanceSideSchema,
  confidence: z.number().min(0).max(1),
  lastSeen: z.string(),
  evidenceIds: z.array(z.string()),
});

export const personaCardSchema = z.object({
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  profileUrl: z.string(),
  compiledAt: z.string(),
  tweetCountUsed: z.number().int().nonnegative(),
  thinRecord: z.boolean(),
  voice: z.object({
    register: voiceRegisterSchema,
    avgLength: avgLengthSchema,
    humor: z.string(),
    disagreementStyle: disagreementStyleSchema,
    signaturePhrases: z.array(z.string()),
    avoids: z.array(z.string()),
  }),
  topics: z.array(personaTopicSchema),
  currentContext: z.object({
    last14dThemes: z.array(z.string()),
    activeFights: z.array(z.string()),
    mood: z.string(),
  }),
  knowledgeEnvelope: z.array(z.string()),
  unknowns: z.array(z.string()),
  contradictions: z.array(
    z.object({
      topic: z.string(),
      older: z.string(),
      newer: z.string(),
      olderId: z.string().optional(),
      newerId: z.string().optional(),
    }),
  ),
});

/**
 * What the LLM is asked to return: the judgement fields only. Identity and
 * counts are facts the application already holds, so they are never accepted
 * from the model — it cannot rename the account it is describing.
 */
export const personaExtractionSchema = personaCardSchema.pick({
  voice: true,
  topics: true,
  currentContext: true,
  knowledgeEnvelope: true,
  unknowns: true,
  contradictions: true,
}).extend({
  thinRecord: z.boolean().default(false),
});

export type PersonaExtraction = z.infer<typeof personaExtractionSchema>;
