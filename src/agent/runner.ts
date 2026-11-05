import OpenAI from "openai";
import { env } from "../config/env.js";
import { createChatCompletionWithRetry } from "../llm/client.js";
import { getAllTools, type AgentTool } from "../tools/index.js";
import { logger } from "../utils/logger.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import {
  createPendingApproval,
  isUserAuthorizedForWrites,
  type PendingApprovalRecord,
  type ThreadMessage,
} from "./store.js";

export interface AgentRunOptions {
  slackUserId?: string;
  channelId?: string;
  threadTs?: string;
  threadHistory?: ThreadMessage[];
  onToolStart?: (toolName: string) => Promise<void> | void;
}

export interface AgentRunResult {
  text: string;
  toolsUsed: string[];
  pendingApproval?: PendingApprovalRecord;
}

const WRITE_TOOLS_REQUIRING_RBAC = new Set([
  "sf_dispatch",
  "save_to_knowledge_base",
  "delete_from_knowledge_base",
]);

function isDestructiveToolCall(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (toolName === "delete_from_knowledge_base") {
    return true;
  }
  if (toolName === "sf_dispatch") {
    const method = String(args.method || "POST").toUpperCase();
    return method !== "GET";
  }
  return false;
}

function summarizePendingAction(
  toolName: string,
  args: Record<string, unknown>
): string {
  if (toolName === "sf_dispatch") {
    const method = String(args.method || "POST").toUpperCase();
    const url = String(args.url || "");
    const bodyPreview = args.body
      ? `\n*Payload:* \`${JSON.stringify(args.body).slice(0, 300)}\``
      : "";
    return `*Salesforce State-Changing Request*\n• *Method:* \`${method}\`\n• *Endpoint:* \`${url}\`${bodyPreview}`;
  }

  if (toolName === "delete_from_knowledge_base") {
    return `*Delete from Knowledge Base*\n• *Target:* \`${JSON.stringify(args)}\``;
  }

  return `*Action:* \`${toolName}\`\n• *Arguments:* \`${JSON.stringify(args).slice(0, 300)}\``;
}

function truncateToolOutput(output: string): string {
  const maxChars = env.agent.maxToolOutputChars;
  if (output.length <= maxChars) {
    return output;
  }
  return `${output.slice(0, maxChars)}\n... [Truncated ${
    output.length - maxChars
  } characters to fit context window]`;
}

function safeParseArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

export async function runAgent(
  userText: string,
  options: AgentRunOptions = {}
): Promise<AgentRunResult> {
  const toolRegistry = await getAllTools();
  const toolSpecs = Object.values<AgentTool>(toolRegistry).map((t) => t.spec);
  const toolsUsed: string[] = [];

  const historyMessages: OpenAI.ChatCompletionMessageParam[] = (
    options.threadHistory || []
  ).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    ...historyMessages,
    { role: "user", content: userText },
  ];

  for (let step = 0; step < env.agent.maxSteps; step++) {
    logger.debug(`Agent step ${step + 1}/${env.agent.maxSteps}`);

    const response = await createChatCompletionWithRetry({
      messages,
      tools: toolSpecs.length > 0 ? toolSpecs : undefined,
    });

    const msg = response.choices[0]?.message;
    if (!msg) {
      break;
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        text: msg.content || "",
        toolsUsed,
      };
    }

    messages.push(msg);

    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;

      const toolName = call.function.name;
      const tool = toolRegistry[toolName];
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error: unknown tool ${toolName}`,
        });
        continue;
      }

      const args = safeParseArgs(call.function.arguments);

      // 1. RBAC Check for Write Tools
      if (
        WRITE_TOOLS_REQUIRING_RBAC.has(toolName) &&
        !isUserAuthorizedForWrites(options.slackUserId)
      ) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `PERMISSION_DENIED: User <@${options.slackUserId}> is not in SLACK_ADMIN_USER_IDS and cannot execute write tool '${toolName}'.`,
        });
        continue;
      }

      // 2. Human-in-the-Loop (HITL) Approval Interception for Destructive Mutations
      if (
        env.slack.requireApprovalForWrites &&
        isDestructiveToolCall(toolName, args) &&
        options.channelId &&
        options.threadTs
      ) {
        const summary = summarizePendingAction(toolName, args);
        const approval = await createPendingApproval({
          slackUserId: options.slackUserId || "unknown",
          channelId: options.channelId,
          threadTs: options.threadTs,
          toolName,
          toolArgs: args,
          summary,
        });

        toolsUsed.push(toolName);
        return {
          text: `:shield: *Approval Required Before Executing Mutation*\n${summary}`,
          toolsUsed,
          pendingApproval: approval,
        };
      }

      try {
        toolsUsed.push(toolName);
        await options.onToolStart?.(toolName);

        const rawOutput = await tool.run(args);
        const output = truncateToolOutput(rawOutput);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: output,
        });
      } catch (err) {
        logger.error(`Tool execution failed: ${toolName}`, err);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error executing ${toolName}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  return {
    text: "I'm sorry, I couldn't complete that request within the maximum allowed steps.",
    toolsUsed,
  };
}
