/**
 * Shared persona types. Frozen contract — a later phase may extend these, but
 * renaming or removing a field means updating BUILD.md in the same change.
 *
 * Zod schemas mirroring these types land in src/lib/persona in Phase 1.
 */

export type VoiceRegister =
  | "blunt"
  | "academic"
  | "shitposter"
  | "founder-threader"
  | "mixed";

export type AvgLength = "short" | "medium" | "thread";

export type DisagreementStyle =
  | "ratio"
  | "steelman"
  | "ignore"
  | "pile-on"
  | "clarify";

export type StanceSide =
  | "for"
  | "against"
  | "mixed"
  | "joke-only"
  | "unclear";

export type TweetKind = "original" | "reply" | "quote" | "retweet";

export type StoredTweet = {
  id: string;
  handle: string;
  text: string;
  createdAt: string; // ISO
  kind: TweetKind;
  isReply: boolean;
  inReplyToId: string | null;
  conversationId: string | null;
  quoteText: string | null;
  url: string;
  metrics: {
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    views: number | null;
  };
};

export type PersonaTopic = {
  name: string;
  stance: string;
  side: StanceSide;
  confidence: number; // 0–1
  lastSeen: string;
  evidenceIds: string[];
};

export type PersonaCard = {
  handle: string;
  displayName: string;
  bio: string;
  profileUrl: string;
  compiledAt: string;
  tweetCountUsed: number;
  thinRecord: boolean;
  voice: {
    register: VoiceRegister;
    avgLength: AvgLength;
    humor: string;
    disagreementStyle: DisagreementStyle;
    signaturePhrases: string[];
    avoids: string[];
  };
  topics: PersonaTopic[];
  currentContext: {
    last14dThemes: string[];
    activeFights: string[];
    mood: string;
  };
  knowledgeEnvelope: string[];
  unknowns: string[];
  contradictions: {
    topic: string;
    older: string;
    newer: string;
    olderId?: string;
    newerId?: string;
  }[];
};
