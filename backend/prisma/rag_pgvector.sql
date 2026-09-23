-- Tier 2 RAG DDL — run ONCE via the DIRECT_URL (:5432 direct host), NOT the
-- :6543 pooler (prisma db push / db execute hang there at the advisory lock).
--   psql "$DIRECT_URL" -f prisma/rag_pgvector.sql
-- Afterwards: stop backend → npx prisma generate → restart (EPERM lesson).
-- Additive only: IF NOT EXISTS throughout, safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS embedding vector(768);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_id TEXT,
  chunk TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kc_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS kc_source_idx
  ON knowledge_chunks (source, source_id);
CREATE INDEX IF NOT EXISTS items_embedding_hnsw
  ON inventory_items USING hnsw (embedding vector_cosine_ops);

-- Cosine-similarity top-k over the knowledge index.
-- src filter: 'inventory' | 'rule' | 'template' | NULL (all sources).
CREATE OR REPLACE FUNCTION match_chunks(q vector(768), k INT, src TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, source TEXT, source_id TEXT, chunk TEXT, score FLOAT) AS $$
  SELECT kc.id, kc.source, kc.source_id, kc.chunk,
         1 - (kc.embedding <=> q) AS score
  FROM knowledge_chunks kc
  WHERE (src IS NULL OR kc.source = src)
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> q
  LIMIT k;
$$ LANGUAGE sql STABLE;
