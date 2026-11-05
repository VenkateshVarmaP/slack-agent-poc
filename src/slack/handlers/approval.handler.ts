import type { App, BlockAction } from "@slack/bolt";
import {
  appendThreadMessage,
  isUserAuthorizedForWrites,
  recordAuditLog,
  resolvePendingApproval,
} from "../../agent/store.js";
import { getAllTools } from "../../tools/index.js";
import { logger } from "../../utils/logger.js";
import { buildSlackBlocks, toSlackMrkdwn } from "../formatter.js";

export function registerApprovalActionHandlers(app: App): void {
  app.action<BlockAction>(
    "agent_approve_action",
    async ({ ack, body, client }) => {
      await ack();

      const action = body.actions[0];
      const approvalId = "value" in action ? String(action.value || "") : "";
      const userId = body.user.id;
      const channelId = body.channel?.id;
      const messageTs = body.message?.ts;

      if (!isUserAuthorizedForWrites(userId)) {
        if (channelId && messageTs) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: ":no_entry: You are not authorized to approve state-changing operations.",
          });
        }
        return;
      }

      const approval = await resolvePendingApproval(
        approvalId,
        "approved",
        userId
      );
      if (!approval) {
        return;
      }

      try {
        const tools = await getAllTools();
        const tool = tools[approval.toolName];
        if (!tool) {
          throw new Error(`Tool '${approval.toolName}' is no longer available.`);
        }

        const rawResult = await tool.run(approval.toolArgs);
        const resultSummary = `:white_check_mark: *Approved & Executed by <@${userId}>*\n${approval.summary}\n---\n*Execution Output:*\n\`\`\`\n${rawResult.slice(0, 1800)}\n\`\`\``;

        await appendThreadMessage({
          channelId: approval.channelId,
          threadTs: approval.threadTs,
          slackUserId: userId,
          role: "assistant",
          content: resultSummary,
        });

        await recordAuditLog({
          slackUserId: userId,
          channelId: approval.channelId,
          threadTs: approval.threadTs,
          userPrompt: `[APPROVED_ACTION:${approval.id}] ${approval.toolName}`,
          toolsCalled: [approval.toolName],
          status: "approved_and_executed",
          responsePreview: rawResult,
        });

        if (channelId && messageTs) {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: toSlackMrkdwn(resultSummary),
            blocks: buildSlackBlocks(resultSummary, [approval.toolName]),
          });
        }
      } catch (error) {
        logger.error("Failed to execute approved action", error, {
          approvalId,
        });
        if (channelId && messageTs) {
          const errText = `:x: *Approved by <@${userId}>, but execution failed:*\n\`${
            error instanceof Error ? error.message : String(error)
          }\``;
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: errText,
            blocks: buildSlackBlocks(errText, [approval.toolName]),
          });
        }
      }
    }
  );

  app.action<BlockAction>(
    "agent_reject_action",
    async ({ ack, body, client }) => {
      await ack();

      const action = body.actions[0];
      const approvalId = "value" in action ? String(action.value || "") : "";
      const userId = body.user.id;
      const channelId = body.channel?.id;
      const messageTs = body.message?.ts;

      const approval = await resolvePendingApproval(
        approvalId,
        "rejected",
        userId
      );
      if (!approval) {
        return;
      }

      const rejectSummary = `:octagonal_sign: *Action Rejected by <@${userId}>*\n~${approval.summary.replace(/\n/g, " — ")}~`;

      await appendThreadMessage({
        channelId: approval.channelId,
        threadTs: approval.threadTs,
        slackUserId: userId,
        role: "assistant",
        content: rejectSummary,
      });

      await recordAuditLog({
        slackUserId: userId,
        channelId: approval.channelId,
        threadTs: approval.threadTs,
        userPrompt: `[REJECTED_ACTION:${approval.id}] ${approval.toolName}`,
        toolsCalled: [approval.toolName],
        status: "rejected",
        responsePreview: "Rejected by user",
      });

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: rejectSummary,
          blocks: buildSlackBlocks(rejectSummary),
        });
      }
    }
  );
}
