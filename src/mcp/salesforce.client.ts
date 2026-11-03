import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { env } from "../config/env.js";
import type { AgentTool } from "../tools/types.js";
import { logger } from "../utils/logger.js";

class SalesforceMcpManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Record<string, AgentTool> = {};
  private connectingPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (!env.salesforceMcp.enabled) {
      logger.info("Salesforce Headless 360 MCP integration is disabled.");
      return;
    }

    if (this.client) return;
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = this.connect();
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async connect(): Promise<void> {
    logger.info("Connecting to Salesforce Headless 360 MCP server...", {
      url: env.salesforceMcp.serverUrl,
    });

    const staticClientInfo = JSON.stringify({
      client_id: env.salesforceMcp.clientId,
    });

    this.transport = new StdioClientTransport({
      command: "npx",
      args: [
        "-y",
        "mcp-remote@latest",
        env.salesforceMcp.serverUrl,
        env.salesforceMcp.callbackPort,
        "--static-oauth-client-info",
        staticClientInfo,
      ],
      env: {
        ...(process.env as Record<string, string>),
        PATH: `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin`,
      },
    });

    const client = new Client(
      {
        name: "slack-agent-poc",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(this.transport);
    this.client = client;

    const { tools: mcpTools } = await client.listTools();
    const mappedTools: Record<string, AgentTool> = {};

    for (const mcpTool of mcpTools) {
      const toolName = `sf_${mcpTool.name}`;
      mappedTools[toolName] = {
        spec: {
          type: "function",
          function: {
            name: toolName,
            description: mcpTool.description || `Salesforce Headless 360 tool: ${mcpTool.name}`,
            parameters: (mcpTool.inputSchema as Record<string, unknown>) || {
              type: "object",
              properties: {},
            },
          },
        },
        run: async (args: Record<string, unknown>) => {
          logger.info(`Invoking Salesforce MCP tool: ${mcpTool.name}`, { args });
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: args,
          });

          if (Array.isArray(result.content)) {
            return result.content
              .map((item) => {
                if (typeof item === "object" && item !== null && "text" in item) {
                  return String(item.text);
                }
                return JSON.stringify(item);
              })
              .join("\n");
          }

          return JSON.stringify(result);
        },
      };
    }

    this.tools = mappedTools;
    logger.info("Salesforce Headless 360 MCP connected", {
      toolsLoaded: Object.keys(this.tools),
    });
  }

  getTools(): Record<string, AgentTool> {
    return this.tools;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
      this.transport = null;
    }
  }
}

export const salesforceMcp = new SalesforceMcpManager();
