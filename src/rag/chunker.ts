export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export function chunkText(
  text: string,
  options: ChunkOptions = {}
): string[] {
  const maxChars = options.maxChars ?? 1200;
  const overlapChars = options.overlapChars ?? 200;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        chunks.push(current);
        const tail = current.slice(-overlapChars);
        current = `${tail}\n\n${para}`.slice(0, maxChars);
      } else {
        for (let i = 0; i < para.length; i += maxChars - overlapChars) {
          chunks.push(para.slice(i, i + maxChars));
        }
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
