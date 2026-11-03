import { chunkText } from "./chunker.js";
import { getDbPool, initializeRagDatabase } from "./db.js";
import { generateEmbedding, toPgVectorLiteral } from "./embeddings.js";

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

export async function ingestDocument(input: SaveKnowledgeInput): Promise<number> {
  await initializeRagDatabase();
  const db = getDbPool();

  const chunks = chunkText(input.content);
  let inserted = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTitle = chunks.length > 1 ? `${input.title} (Part ${i + 1}/${chunks.length})` : input.title;
    const embedding = await generateEmbedding(`${chunkTitle}\n\n${chunk}`);
    const vectorLiteral = toPgVectorLiteral(embedding);

    await db.query(
      `
      INSERT INTO knowledge_chunks (title, source, category, content, metadata, embedding)
      VALUES ($1, $2, $3, $4, $5, $6::vector)
      `,
      [
        chunkTitle,
        input.source || "manual",
        input.category || "general",
        chunk,
        JSON.stringify(input.metadata || {}),
        vectorLiteral,
      ]
    );
    inserted++;
  }

  return inserted;
}
