/**
 * Turns a PersonaCard into the 6–8 plain-language bullets shown in the preview.
 *
 * Copy rules from BUILD.md: "public voice" and "simulated takes from posts".
 * Never "soul", "clone of the real you", or "indistinguishable".
 */

import type { PersonaCard } from "@/types/persona";

const REGISTER_COPY: Record<PersonaCard["voice"]["register"], string> = {
  blunt: "Posts bluntly — short, declarative, little hedging",
  academic: "Posts like an academic — careful, qualified, citation-minded",
  shitposter: "Posts as a shitposter — jokes first, sincerity smuggled in",
  "founder-threader": "Posts founder threads — numbered lessons, build-in-public framing",
  mixed: "No single register — the posting voice shifts by topic",
};

const LENGTH_COPY: Record<PersonaCard["voice"]["avgLength"], string> = {
  short: "Keeps it to a line or two",
  medium: "Writes a paragraph at a time",
  thread: "Tends to thread",
};

const DISAGREE_COPY: Record<PersonaCard["voice"]["disagreementStyle"], string> = {
  ratio: "Disagrees by dunking",
  steelman: "Disagrees by steelmanning first",
  ignore: "Mostly ignores disagreement",
  "pile-on": "Piles on when others are already arguing",
  clarify: "Disagrees by asking for clarification",
};

/**
 * Bullets in priority order, because the cap truncates the tail. The
 * anti-invention signals — what this account has no take on, and where it has
 * publicly changed its mind — rank above humour and catchphrases: they are what
 * stops a reader trusting an answer the account never earned.
 */
export function personaBullets(card: PersonaCard, max = 8): string[] {
  const bullets: string[] = [];

  if (card.thinRecord) {
    bullets.push(`Thin public record — ${card.tweetCountUsed} usable posts, so it abstains often`);
  }

  bullets.push(
    REGISTER_COPY[card.voice.register],
    LENGTH_COPY[card.voice.avgLength],
    DISAGREE_COPY[card.voice.disagreementStyle],
  );

  const firm = card.topics.filter((topic) => topic.confidence >= 0.7);
  if (firm.length > 0) {
    bullets.push(`Firm public takes on ${firm.slice(0, 3).map((t) => t.name).join(", ")}`);
  }

  if (card.unknowns.length > 0) {
    bullets.push(`No public take on ${card.unknowns.slice(0, 2).join(" or ")}`);
  }

  if (card.contradictions.length > 0) {
    bullets.push(`Has publicly changed position on ${card.contradictions[0].topic}`);
  }

  if (card.currentContext.last14dThemes.length > 0) {
    bullets.push(`Posting lately about ${card.currentContext.last14dThemes.slice(0, 3).join(", ")}`);
  }

  if (card.currentContext.activeFights.length > 0) {
    bullets.push(`Currently arguing about ${card.currentContext.activeFights[0]}`);
  }

  if (card.voice.humor) bullets.push(`Humour reads as ${card.voice.humor}`);

  if (card.voice.signaturePhrases.length > 0) {
    bullets.push(`Recurring phrasing: ${card.voice.signaturePhrases.slice(0, 3).join(", ")}`);
  }

  return bullets.slice(0, max);
}

/** "3 hours ago" / "2 days ago", for the compile freshness line. */
export function relativeAge(iso: string, now = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
