import type { AgentTool } from "./types.js";

export const getTimeTool: AgentTool = {
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
};

export const localTools: Record<string, AgentTool> = {
  get_time: getTimeTool,
};
