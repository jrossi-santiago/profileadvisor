CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"injected_tweet_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_cards" (
	"handle" text PRIMARY KEY NOT NULL,
	"card" jsonb NOT NULL,
	"compiled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tweet_count_used" integer DEFAULT 0 NOT NULL,
	"thin_record" boolean DEFAULT false NOT NULL,
	"source_tweet_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compile_error" text
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"handle" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"is_protected" boolean DEFAULT false NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"user_id" text,
	"share_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tweets" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"is_reply" boolean DEFAULT false NOT NULL,
	"in_reply_to_id" text,
	"conversation_id" text,
	"quote_text" text,
	"url" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"units" real DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"handle" text,
	"user_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_id_idx" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "threads_handle_idx" ON "threads" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "tweets_handle_created_idx" ON "tweets" USING btree ("handle","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_events_kind_idx" ON "usage_events" USING btree ("kind","created_at");