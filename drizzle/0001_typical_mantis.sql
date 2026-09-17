-- pgvector must exist before the column that uses it. Supabase ships it;
-- self-hosted Postgres needs the postgresql-<ver>-pgvector package.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "tweets" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tweets_embedding_idx" ON "tweets" USING hnsw ("embedding" vector_cosine_ops);