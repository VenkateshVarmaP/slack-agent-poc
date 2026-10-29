import { App } from "@slack/bolt";
import { runAgent } from "./agent.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.event("app_mention", async ({ event, client }) => {
  const { channel, ts, text } = event as {
    channel: string;
    ts: string;
    text: string;
  };

  try {
    await client.reactions.add({
      channel,
      timestamp: ts,
      name: "eyes",
    }).catch(() => {});

    const cleanedText = text.replace(/<@[^>]+>\s*/g, "");

    const response = await runAgent(cleanedText);

    await client.chat.postMessage({
      channel,
      thread_ts: ts,
      text: response,
    });
  } catch (error) {
    console.error(error);
    await client.chat.postMessage({
      channel,
      thread_ts: ts,
      text: "Sorry, I encountered an error processing your request.",
    }).catch(() => {});
  }
});

await app.start();
console.log("Slack Agent POC is running!");
