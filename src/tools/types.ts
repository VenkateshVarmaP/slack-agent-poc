import OpenAI from "openai";

export interface AgentTool {
  spec: OpenAI.ChatCompletionTool;
  run: (args: Record<string, unknown>) => Promise<string>;
}
