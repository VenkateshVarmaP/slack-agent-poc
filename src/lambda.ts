import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { salesforceMcp } from "./mcp/salesforce.client.js";
import { initializeRagDatabase } from "./rag/db.js";
import { createSlackLambdaApp } from "./slack/app.js";
import {
  handleAgentConversation,
  type IncomingSlackMessage,
} from "./slack/handlers/mention.handler.js";
import { logger } from "./utils/logger.js";

interface AsyncWorkerPayload {
  __asyncAgentWorker: true;
  message: IncomingSlackMessage;
}

const lambdaClient = new LambdaClient({});
let initialized = false;

async function ensureServicesInitialized(): Promise<void> {
  if (initialized) return;
  await initializeRagDatabase().catch((err) => {
    logger.warn("Lambda RAG initialization warning", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  await salesforceMcp.initialize().catch((err) => {
    logger.warn("Lambda Salesforce MCP initialization warning", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  initialized = true;
}

/**
 * Enqueues a background execution of the same Lambda function (`InvocationType: "Event"`)
 * so the HTTP webhook can return `200 OK` to Slack within Slack's strict 3-second limit.
 */
export async function dispatchLambdaBackgroundWorker(
  message: IncomingSlackMessage
): Promise<boolean> {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    return false;
  }

  const payload: AsyncWorkerPayload = {
    __asyncAgentWorker: true,
    message,
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  logger.info("Dispatched async Lambda background worker", {
    functionName,
    channel: message.channel,
    ts: message.ts,
  });
  return true;
}

export const handler = async (
  event: APIGatewayProxyEvent | AsyncWorkerPayload,
  context: Context
): Promise<APIGatewayProxyResult | void> => {
  await ensureServicesInitialized();

  // Branch 1: Asynchronous Background Worker Invocation (runs full LLM + RAG + MCP loop)
  if ("__asyncAgentWorker" in event && event.__asyncAgentWorker === true) {
    logger.info("Running async Lambda background worker", {
      channel: event.message.channel,
      threadTs: event.message.threadTs,
    });
    const { app } = createSlackLambdaApp();
    await handleAgentConversation(app.client, event.message);
    return;
  }

  // Branch 2: Synchronous Slack HTTP Webhook (Events API / Interactive Approval Buttons)
  const { awsLambdaReceiver } = createSlackLambdaApp();
  const boltHandler = await awsLambdaReceiver.start();
  return boltHandler(
    event as Parameters<typeof boltHandler>[0],
    context,
    () => {}
  );
};
