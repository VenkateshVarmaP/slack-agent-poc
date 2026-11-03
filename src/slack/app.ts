import { App } from "@slack/bolt";
import { env } from "../config/env.js";
import { registerAppMentionHandler } from "./handlers/mention.handler.js";

export function createSlackApp(): App {
  const app = new App({
    token: env.slack.botToken,
    appToken: env.slack.appToken,
    socketMode: true,
  });

  registerAppMentionHandler(app);

  return app;
}
