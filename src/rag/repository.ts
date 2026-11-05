import { chunkText } from "./chunker.js";
import { getDbPool, initializeRagDatabase } from "./db.js";
import { generateEmbedding, toPgVectorLiteral } from "./embeddings.js";
import {
  validateKnowledgeForStorage,
  type IngestionValidationResult,
} from "./guardrails.js";

export interface KnowledgeSearchResult {
  id: number;
  title: string;
  source: string;
  category: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface SaveKnowledgeInput {
  title: string;
  content: string;
  source?: string;
  category?: string;
  metadata?: Record<string, unknown>;
  skipValidation?: boolean;
}

export interface IngestDocumentOutcome {
  accepted: boolean;
  chunksInserted: number;
  category: string;
  validation: IngestionValidationResult;
}

export async function searchKnowledgeBase(
  query: string,
  topK = 5,
  category?: string
): Promise<KnowledgeSearchResult[]> {
  await initializeRagDatabase();
  const db = getDbPool();

  const queryEmbedding = await generateEmbedding(query);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  const params: unknown[] = [vectorLiteral, query, Math.min(Math.max(topK, 1), 20)];
  let categoryFilter = "";

  if (category) {
    params.push(category);
    categoryFilter = `AND category = $${params.length}`;
  }

  const sql = `
    SELECT
      id,
      title,
      source,
      category,
      content,
      metadata,
      (
        (1 - (embedding <=> $1::vector)) * 0.8 +
        LEAST(ts_rank_cd(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', $2)), 1.0) * 0.2
      ) AS similarity
    FROM knowledge_chunks
    WHERE 1=1 ${categoryFilter}
    ORDER BY similarity DESC
    LIMIT $3;
  `;

  const { rows } = await db.query(sql, params);

  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    source: String(row.source),
    category: String(row.category),
    content: String(row.content),
    similarity: Number(Number(row.similarity).toFixed(4)),
    metadata: (row.metadata as Record<string, unknown>) || {},
  }));
}

export async function ingestDocument(
  input: SaveKnowledgeInput
): Promise<IngestDocumentOutcome> {
  const validation = input.skipValidation
    ? { allowed: true, reason: "Validation bypassed.", suggestedCategory: "runbook" as const }
    : await validateKnowledgeForStorage(input.title, input.content);

  const resolvedCategory =
    input.category || validation.suggestedCategory || "runbook";

  if (!validation.allowed) {
    return {
      accepted: false,
      chunksInserted: 0,
      category: resolvedCategory,
      validation,
    };
  }

  await initializeRagDatabase();
  const db = getDbPool();

  const source = input.source || "manual";
  const chunks = chunkText(input.content);
  let upserted = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTitle =
      chunks.length > 1
        ? `${input.title} (Part ${i + 1}/${chunks.length})`
        : input.title;
    const embedding = await generateEmbedding(`${chunkTitle}\n\n${chunk}`);
    const vectorLiteral = toPgVectorLiteral(embedding);

    await db.query(
      `
      INSERT INTO knowledge_chunks (title, source, category, content, metadata, embedding, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::vector, NOW())
      ON CONFLICT (source, title)
      DO UPDATE SET
        category = EXCLUDED.category,
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata,
        embedding = EXCLUDED.embedding,
        updated_at = NOW();
      `,
      [
        chunkTitle,
        source,
        resolvedCategory,
        chunk,
        JSON.stringify(input.metadata || {}),
        vectorLiteral,
      ]
    );
    upserted++;
  }

  return {
    accepted: true,
    chunksInserted: upserted,
    category: resolvedCategory,
    validation,
  };
}

export async function deleteKnowledgeByTitleOrId(params: {
  id?: number;
  titleQuery?: string;
}): Promise<number> {
  await initializeRagDatabase();
  const db = getDbPool();

  if (params.id !== undefined) {
    const res = await db.query(`DELETE FROM knowledge_chunks WHERE id = $1`, [
      params.id,
    ]);
    return res.rowCount || 0;
  }

  if (params.titleQuery) {
    const res = await db.query(
      `DELETE FROM knowledge_chunks WHERE title ILIKE $1`,
      [`%${params.titleQuery}%`]
    );
    return res.rowCount || 0;
  }

  return 0;
}
