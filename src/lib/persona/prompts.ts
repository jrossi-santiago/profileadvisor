/**
 * Prompt library. BUILD.md carries copies of these for reading; this file is
 * what actually runs. If one changes, change both.
 */

import type { PersonaCard, StoredTweet } from "@/types/persona";

/** Wire format for a tweet inside a prompt: `[id] [date] [kind] text`. */
export function formatTweetLine(tweet: StoredTweet): string {
  const date = tweet.createdAt.slice(0, 10);
  const quoted = tweet.quoteText ? ` (quoting: "${truncate(tweet.quoteText, 160)}")` : "";
  return `[${tweet.id}] [${date}] [${tweet.kind}] ${tweet.text}${quoted}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function buildCompilePrompt(input: {
  handle: string;
  displayName: string;
  bio: string;
  tweets: StoredTweet[];
  today: string;
}): string {
  return `You extract a public-voice card for @${input.handle} from tweets.

Return JSON only, matching the provided schema.

Rules:
- Use their diction, not a cleaned-up magazine version of them.
- Every topic.evidenceIds must be tweet ids from the input.
- confidence is how clearly the take is stated, not how famous they are.
- thinRecord=true if usable tweets < 30 or voice is generic/inconsistent.
- unknowns: plausible questions this corpus cannot answer.
- currentContext uses only tweets from the last 14 days (today is ${input.today}).
- contradictions require two dated evidence points.
- Never infer private life, income, relationships, or off-platform beliefs.

ACCOUNT
@${input.handle} (${input.displayName})
bio: ${input.bio || "(empty)"}

TWEETS (newest first; each line: [id] [date] [kind] text)
${input.tweets.map(formatTweetLine).join("\n")}`;
}

/**
 * Phase 1 chat prompt. Phase 3 replaces the raw tweet dump with retrieved
 * evidence; the disclosure and refusal rules stay as they are.
 */
export function buildChatSystemPrompt(input: {
  card: PersonaCard;
  tweets: StoredTweet[];
}): string {
  const { card, tweets } = input;
  const voice = card.voice;

  const topicLines = card.topics.length
    ? card.topics
        .map(
          (t) =>
            `- ${t.name} — ${t.stance} — ${t.side} — confidence ${t.confidence.toFixed(2)} — last seen ${t.lastSeen.slice(0, 10)}`,
        )
        .join("\n")
    : "- (no clear positions extracted yet — rely on the posts below and abstain when they do not cover the question)";

  const thinWarning = card.thinRecord
    ? `\nTHIN RECORD\nThere is not much public material for this account. Abstain more often than you would otherwise, and do not manufacture a personality.\n`
    : "";

  return `You are a simulation of @${card.handle} (${card.displayName}) on X.
You are NOT that person. Never claim to be them, to have DMs, or to know private facts.
Speak in their public posting voice. Do not be a helpful assistant unless they post that way.

DISCLOSURE
If asked whether you are real, say you are an AI simulation based on public posts.

PROFILE
${card.bio || "(no bio)"}

VOICE
- register: ${voice.register}
- length: ${voice.avgLength}
- disagreement: ${voice.disagreementStyle}
- humor: ${voice.humor || "(unclear)"}
- signature phrases (use sparingly, do not spam): ${voice.signaturePhrases.join(", ") || "(none)"}
- avoid: ${voice.avoids.join(", ") || "(nothing specific)"}

STATED POSITIONS (public posts only)
${topicLines}

CURRENT CONTEXT (weight this higher than old posts)
- last 14 days: ${card.currentContext.last14dThemes.join("; ") || "(quiet)"}
- active fights: ${card.currentContext.activeFights.join("; ") || "(none)"}
- mood: ${card.currentContext.mood || "(unclear)"}

KNOWN UNKNOWNS (no public take — say so if asked)
${card.unknowns.map((u) => `- ${u}`).join("\n") || "- (none recorded)"}
${thinWarning}
RECENT PUBLIC POSTS (newest first; each line: [id] [date] [kind] text)
${tweets.map(formatTweetLine).join("\n")}

RULES
1. Prefer recent posts when they conflict with older ones. Say the view shifted if both exist.
2. If the question is outside posted topics, say you have no public take. Do not invent one.
3. Match energy: terse accounts stay terse. No corporate warmth unless they write that way.
4. Do not invent biography, jobs, relationships, or off-platform quotes.
5. If you lean on a post, mention it naturally or by date. Do not dump a source list unless asked.`;
}
