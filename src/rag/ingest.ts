import fs from "node:fs/promises";
import path from "node:path";
import { closeRagDatabase, initializeRagDatabase } from "./db.js";
import { ingestDocument } from "./repository.js";
import { logger } from "../utils/logger.js";

async function runIngestion(): Promise<void> {
  const docsDir = path.resolve(process.cwd(), "docs");

  try {
    await initializeRagDatabase();
    const entries = await fs.readdir(docsDir, { withFileTypes: true });
    const files = entries.filter(
      (e) => e.isFile() && (e.name.endsWith(".md") || e.name.endsWith(".txt"))
    );

    if (files.length === 0) {
      logger.info("No .md or .txt files found in ./docs to ingest.");
      return;
    }

    for (const file of files) {
      const fullPath = path.join(docsDir, file.name);
      const content = await fs.readFile(fullPath, "utf8");
      const title = path.basename(file.name, path.extname(file.name));

      const outcome = await ingestDocument({
        title,
        content,
        source: `docs/${file.name}`,
      });

      if (outcome.accepted) {
        logger.info(`Ingested ${file.name}`, {
          category: outcome.category,
          chunksCount: outcome.chunksInserted,
        });
      } else {
        logger.warn(`Skipped ${file.name} (rejected by RAG governance)`, {
          reason: outcome.validation.reason,
        });
      }
    }
  } finally {
    await closeRagDatabase();
  }
}

await runIngestion();
