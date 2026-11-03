import type { App } from "@slack/bolt";
import { runAgent } from "../../agent/runner.js";
import { logger } from "../../utils/logger.js";

export function registerAppMentionHandler(app: App): void {
  app.event("app_mention", async ({ event, client }) => {
    const { channel, ts, text, user } = event as {
      channel: string;
      ts: string;
      text: string;
      user?: string;
    };

    logger.info("Received app_mention event", { channel, user, ts });

    try {
      await client.reactions
        .add({
          channel,
          timestamp: ts,
          name: "eyes",
        })
        .catch(() => {});

      const cleanedText = text.replace(/<@[^>]+>\s*/g, "");
      const response = await runAgent(cleanedText);

      await client.chat.postMessage({
        channel,
        thread_ts: ts,
        text: response,
      });
    } catch (error) {
      logger.error("Failed to process app_mention event", error, { channel, ts });
      await client.chat
        .postMessage({
          channel,
          thread_ts: ts,
          text: "Sorry, I encountered an error processing your request.",
        })
        .catch(() => {});
    }
  });
}
