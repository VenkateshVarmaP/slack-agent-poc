import { App, AwsLambdaReceiver } from "@slack/bolt";
import { env } from "../config/env.js";
import { registerApprovalActionHandlers } from "./handlers/approval.handler.js";
import { registerAppMentionHandler } from "./handlers/mention.handler.js";

/**
 * Target 1: Always-On Socket Mode App (for Local Dev, EC2, ECS, App Runner)
 */
export function createSlackApp(): App {
  if (!env.slack.appToken) {
    throw new Error(
      "SLACK_APP_TOKEN is required when running in Socket Mode."
    );
  }

  const app = new App({
    token: env.slack.botToken,
    appToken: env.slack.appToken,
    socketMode: true,
  });

  registerAppMentionHandler(app);
  registerApprovalActionHandlers(app);

  return app;
}

/**
 * Target 2: Serverless HTTP App using AwsLambdaReceiver (for AWS Lambda + Function URL / API Gateway)
 */
export function createSlackLambdaApp(): {
  app: App;
  awsLambdaReceiver: AwsLambdaReceiver;
} {
  if (!env.slack.signingSecret) {
    throw new Error(
      "SLACK_SIGNING_SECRET is required when running on AWS Lambda."
    );
  }

  const awsLambdaReceiver = new AwsLambdaReceiver({
    signingSecret: env.slack.signingSecret,
  });

  const app = new App({
    token: env.slack.botToken,
    receiver: awsLambdaReceiver,
    processBeforeResponse: true,
  });

  registerAppMentionHandler(app);
  registerApprovalActionHandlers(app);

  return { app, awsLambdaReceiver };
}
