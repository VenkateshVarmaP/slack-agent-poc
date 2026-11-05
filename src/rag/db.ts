import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let initialized = false;

export function getDbPool(): pg.Pool {
  if (!env.rag.databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    const isLocal =
      env.rag.databaseUrl.includes("localhost") ||
      env.rag.databaseUrl.includes("127.0.0.1");

    pool = new Pool({
      connectionString: env.rag.databaseUrl,
      ssl: isLocal
        ? false
        : {
            rejectUnauthorized: env.rag.sslRejectUnauthorized,
          },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  return pool;
}

export async function initializeRagDatabase(): Promise<void> {
  if (!env.rag.enabled) {
    logger.info("RAG database is disabled (no DATABASE_URL set).");
    return;
  }

  if (initialized) return;

  const db = getDbPool();
  const dims = env.llm.embeddingDimensions;

  await db.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  const existingDimsRes = await db
    .query(
      `
      SELECT atttypmod
      FROM pg_attribute
      WHERE attrelid = 'knowledge_chunks'::regclass
        AND attname = 'embedding';
      `
    )
    .catch(() => ({ rows: [] }));

  if (existingDimsRes.rows.length > 0 && existingDimsRes.rows[0].atttypmod !== dims) {
    logger.warn(
      `Updating knowledge_chunks embedding column dimension from ${existingDimsRes.rows[0].atttypmod} to ${dims}`
    );
    await db.query(`DROP TABLE IF EXISTS knowledge_chunks;`);
  }

  // 1. Knowledge Base Chunks Table with unique (source, title) for clean UPSERT deduplication
  await db.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      embedding vector(${dims}) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Deduplicate any pre-existing rows before ensuring the unique index
  await db.query(`
    DELETE FROM knowledge_chunks a
    USING knowledge_chunks b
    WHERE a.id < b.id
      AND a.source = b.source
      AND a.title = b.title;
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_source_title
    ON knowledge_chunks (source, title);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
    ON knowledge_chunks
    USING hnsw (embedding vector_cosine_ops);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts
    ON knowledge_chunks
    USING GIN (to_tsvector('english', title || ' ' || content));
  `);

  // 2. Multi-Turn Thread Memory Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      slack_user_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
    ON conversation_messages (channel_id, thread_ts, created_at ASC);
  `);

  // 3. Audit Logs Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      slack_user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      tools_called TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'completed',
      response_preview TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 4. Human-in-the-Loop Pending Approvals Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id TEXT PRIMARY KEY,
      slack_user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_args JSONB NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      decided_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  initialized = true;
  logger.info("PostgreSQL pgvector RAG, Memory, Audit, and Approvals tables initialized.");
}

export async function closeRagDatabase(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    initialized = false;
  }
}
