import OpenAI from "openai";
import { env } from "../config/env.js";
import { llm, MODEL } from "../llm/client.js";
import { getAllTools, type AgentTool } from "../tools/index.js";
import { logger } from "../utils/logger.js";
import { SYSTEM_PROMPT } from "./prompts.js";

function safeParseArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

export async function runAgent(userText: string): Promise<string> {
  const toolRegistry = await getAllTools();
  const toolSpecs = Object.values<AgentTool>(toolRegistry).map((t) => t.spec);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    { role: "user", content: userText },
  ];

  for (let step = 0; step < env.agent.maxSteps; step++) {
    logger.debug(`Agent step ${step + 1}/${env.agent.maxSteps}`);

    const response = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolSpecs.length > 0 ? toolSpecs : undefined,
    });

    const msg = response.choices[0]?.message;
    if (!msg) {
      break;
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || "";
    }

    messages.push(msg);

    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;

      const tool = toolRegistry[call.function.name];
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error: unknown tool ${call.function.name}`,
        });
        continue;
      }

      try {
        const args = safeParseArgs(call.function.arguments);
        const output = await tool.run(args);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: output,
        });
      } catch (err) {
        logger.error(`Tool execution failed: ${call.function.name}`, err);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error executing ${call.function.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  return "I'm sorry, I couldn't complete that request within the maximum allowed steps.";
}
