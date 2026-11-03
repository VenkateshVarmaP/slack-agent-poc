import { env } from "../config/env.js";
import { llm } from "../llm/client.js";

export async function generateEmbedding(text: string): Promise<number[]> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const targetDims = env.llm.embeddingDimensions;
  const response = await llm.embeddings.create({
    model: env.llm.embeddingModel,
    input: cleaned,
    dimensions: targetDims,
  });

  let vector = response.data[0]?.embedding;
  if (!vector || !Array.isArray(vector)) {
    throw new Error(`Failed to generate embedding using model ${env.llm.embeddingModel}`);
  }

  if (vector.length > targetDims) {
    vector = vector.slice(0, targetDims);
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      vector = vector.map((val) => val / norm);
    }
  }

  return vector;
}

export function toPgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
