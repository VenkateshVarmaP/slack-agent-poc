import type { App } from "@slack/bolt";
import { runAgent } from "../../agent/runner.js";
import {
  appendThreadMessage,
  getThreadHistory,
  hasActiveThreadInDb,
  recordAuditLog,
} from "../../agent/store.js";
import { dispatchLambdaBackgroundWorker } from "../../lambda.js";
import { logger } from "../../utils/logger.js";
import {
  buildSlackBlocks,
  formatToolStatusMessage,
  toSlackMrkdwn,
} from "../formatter.js";

export interface IncomingSlackMessage {
  channel: string;
  ts: string;
  threadTs: string;
  text: string;
  user?: string;
}

export async function handleAgentConversation(
  client: App["client"],
  msg: IncomingSlackMessage
): Promise<void> {
  const { channel, ts, threadTs, text, user } = msg;
  let statusMessageTs: string | undefined;

  try {
    await client.reactions
      .add({
        channel,
        timestamp: ts,
        name: "eyes",
      })
      .catch(() => {});

    const thinkingMsg = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "💭 _Thinking..._",
      blocks: [
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "💭 _Thinking..._" }],
        },
      ],
    });
    statusMessageTs = thinkingMsg.ts;

    const cleanedText = text.replace(/<@[^>]+>\s*/g, "").trim();

    // 1. Load Multi-Turn Thread Memory from AWS RDS PostgreSQL
    const threadHistory = await getThreadHistory(channel, threadTs);

    // 2. Run Agent with RBAC, HITL Approval Interception, and Live Status Updates
    const {
      text: responseText,
      toolsUsed,
      pendingApproval,
    } = await runAgent(cleanedText, {
      slackUserId: user,
      channelId: channel,
      threadTs,
      threadHistory,
      onToolStart: async (toolName) => {
        if (!statusMessageTs) return;
        const statusLabel = formatToolStatusMessage(toolName);
        await client.chat
          .update({
            channel,
            ts: statusMessageTs,
            text: statusLabel,
            blocks: [
              {
                type: "context",
                elements: [{ type: "mrkdwn", text: statusLabel }],
              },
            ],
          })
          .catch(() => {});
      },
    });

    // 3. Persist User + Assistant turn in Thread Memory & Record Audit Log
    await appendThreadMessage({
      channelId: channel,
      threadTs,
      slackUserId: user,
      role: "user",
      content: cleanedText,
    });
    await appendThreadMessage({
      channelId: channel,
      threadTs,
      role: "assistant",
      content: responseText,
    });

    await recordAuditLog({
      slackUserId: user || "unknown",
      channelId: channel,
      threadTs,
      userPrompt: cleanedText,
      toolsCalled: toolsUsed,
      status: pendingApproval ? "awaiting_approval" : "completed",
      responsePreview: responseText,
    });

    const fallbackText = toSlackMrkdwn(responseText);
    const blocks = buildSlackBlocks(responseText, toolsUsed, pendingApproval);

    if (statusMessageTs) {
      await client.chat.update({
        channel,
        ts: statusMessageTs,
        text: fallbackText,
        blocks,
      });
    } else {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: fallbackText,
        blocks,
      });
    }

    await client.reactions
      .remove({
        channel,
        timestamp: ts,
        name: "eyes",
      })
      .catch(() => {});

    await client.reactions
      .add({
        channel,
        timestamp: ts,
        name: "white_check_mark",
      })
      .catch(() => {});
  } catch (error) {
    logger.error("Failed to process Slack agent message", error, { channel, ts });

    const errorBlocks = [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: ":warning: *Sorry, I encountered an error processing your request.*",
        },
      },
    ];

    if (statusMessageTs) {
      await client.chat
        .update({
          channel,
          ts: statusMessageTs,
          text: "Sorry, I encountered an error processing your request.",
          blocks: errorBlocks,
        })
        .catch(() => {});
    } else {
      await client.chat
        .postMessage({
          channel,
          thread_ts: threadTs,
          text: "Sorry, I encountered an error processing your request.",
          blocks: errorBlocks,
        })
        .catch(() => {});
    }
  }
}

async function routeSlackMessage(
  client: App["client"],
  msg: IncomingSlackMessage
): Promise<void> {
  // When running on AWS Lambda HTTP mode, offload to async background worker
  // so Slack gets a 200 OK within its 3-second timeout window.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const dispatched = await dispatchLambdaBackgroundWorker(msg);
    if (dispatched) return;
  }

  await handleAgentConversation(client, msg);
}

export function registerAppMentionHandler(app: App): void {
  // 1. Handle @mentions in channels and threads
  app.event("app_mention", async ({ event, client }) => {
    const { channel, ts, thread_ts, text, user } = event as {
      channel: string;
      ts: string;
      thread_ts?: string;
      text: string;
      user?: string;
    };

    const effectiveThreadTs = thread_ts || ts;
    logger.info("Received app_mention event", {
      channel,
      user,
      ts,
      threadTs: effectiveThreadTs,
    });

    await routeSlackMessage(client, {
      channel,
      ts,
      threadTs: effectiveThreadTs,
      text,
      user,
    });
  });

  // 2. Handle Direct Messages (DMs) and follow-up replies in active bot threads without needing @mention
  app.event("message", async ({ event, client }) => {
    const msg = event as {
      channel?: string;
      channel_type?: string;
      ts?: string;
      thread_ts?: string;
      text?: string;
      user?: string;
      bot_id?: string;
      subtype?: string;
    };

    if (
      msg.bot_id ||
      msg.subtype ||
      !msg.text ||
      !msg.channel ||
      !msg.ts ||
      /<@[^>]+>/.test(msg.text)
    ) {
      return;
    }

    const isDirectMessage = msg.channel_type === "im";
    const effectiveThreadTs = msg.thread_ts || msg.ts;

    if (isDirectMessage) {
      logger.info("Received direct message", {
        channel: msg.channel,
        user: msg.user,
        ts: msg.ts,
      });
      await routeSlackMessage(client, {
        channel: msg.channel,
        ts: msg.ts,
        threadTs: effectiveThreadTs,
        text: msg.text,
        user: msg.user,
      });
      return;
    }

    if (msg.thread_ts && (await hasActiveThreadInDb(msg.channel, msg.thread_ts))) {
      logger.info("Received follow-up reply in active bot thread", {
        channel: msg.channel,
        user: msg.user,
        threadTs: msg.thread_ts,
      });
      await routeSlackMessage(client, {
        channel: msg.channel,
        ts: msg.ts,
        threadTs: msg.thread_ts,
        text: msg.text,
        user: msg.user,
      });
    }
  });
}
