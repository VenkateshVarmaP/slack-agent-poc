import OpenAI from "openai";

export interface Tool {
  spec: OpenAI.ChatCompletionTool;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export const tools: Record<string, Tool> = {
  get_time: {
    spec: {
      type: "function",
      function: {
        name: "get_time",
        description: "Get the current date and time in ISO format.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async () => {
      return new Date().toISOString();
    },
  },
};
