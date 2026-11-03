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

  initialized = true;
  logger.info("PostgreSQL pgvector RAG database initialized.");
}

export async function closeRagDatabase(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    initialized = false;
  }
}
