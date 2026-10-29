import OpenAI from "openai";
import { llm, MODEL } from "./llm.js";
import { tools, type Tool } from "./tools.js";

function safeParseArgs(rawArgs: string | undefined): Record<string, unknown> {
  if (!rawArgs) return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

export async function runAgent(userText: string): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "You are a helpful Slack assistant. Keep answers concise and direct.",
    },
    { role: "user", content: userText },
  ];

  for (let step = 0; step < 5; step++) {
    const response = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools: Object.values<Tool>(tools).map((t) => t.spec),
    });

    const msg = response.choices[0].message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || "";
    }

    messages.push(msg);

    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;

      const tool = tools[call.function.name];
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Error: unknown tool ${call.function.name}`,
        });
        continue;
      }

      const args = safeParseArgs(call.function.arguments);
      const output = await tool.run(args);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }
  }

  return "I'm sorry, I couldn't complete that request.";
}
