import { salesforceMcp } from "../mcp/salesforce.client.js";
import { localTools } from "./local.tools.js";
import type { AgentTool } from "./types.js";

export async function getAllTools(): Promise<Record<string, AgentTool>> {
  await salesforceMcp.initialize();
  return {
    ...localTools,
    ...salesforceMcp.getTools(),
  };
}

export type { AgentTool } from "./types.js";
