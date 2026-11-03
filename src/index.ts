import { salesforceMcp } from "./mcp/salesforce.client.js";
import { closeRagDatabase, initializeRagDatabase } from "./rag/db.js";
import { createSlackApp } from "./slack/app.js";
import { logger } from "./utils/logger.js";

async function bootstrap(): Promise<void> {
  try {
    await initializeRagDatabase();
  } catch (error) {
    logger.warn(
      "Could not initialize PostgreSQL pgvector RAG database; continuing without RAG.",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }

  try {
    await salesforceMcp.initialize();
  } catch (error) {
    logger.warn(
      "Could not connect to Salesforce MCP on startup; continuing with local tools only.",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }

  const app = createSlackApp();
  await app.start();
  logger.info("Slack Agent POC is running!");

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    await app.stop().catch(() => {});
    await salesforceMcp.close();
    await closeRagDatabase();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await bootstrap();
