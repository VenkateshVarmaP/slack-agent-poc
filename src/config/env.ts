export interface AppConfig {
  slack: {
    botToken: string;
    appToken: string;
  };
  llm: {
    apiKey: string;
    baseURL: string;
    model: string;
    appTitle: string;
    referer: string;
  };
  salesforceMcp: {
    enabled: boolean;
    serverUrl: string;
    clientId: string;
    callbackPort: string;
  };
  agent: {
    maxSteps: number;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env: AppConfig = {
  slack: {
    botToken: requireEnv("SLACK_BOT_TOKEN"),
    appToken: requireEnv("SLACK_APP_TOKEN"),
  },
  llm: {
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    model: process.env.OPENROUTER_MODEL || "openrouter/free",
    appTitle: process.env.APP_TITLE || "Slack Agent POC",
    referer: process.env.APP_REFERER || "http://localhost:3000",
  },
  salesforceMcp: {
    enabled: process.env.SF_MCP_ENABLED !== "false",
    serverUrl:
      process.env.SF_MCP_SERVER_URL ||
      "https://api.salesforce.com/platform/mcp/v1/d/orgfarm-80570c66ae-dev-ed/develop/platform/headless-360",
    clientId:
      process.env.SF_MCP_CLIENT_ID ||
      "3MVG97Tt9.zIfTDt4jmNe1k8yGlmrJN2q8Wa.rQNOg3_Jk2vi2zSLHQRTwb7V6c.S_pQ4spSaX7wMmHV1Ifol",
    callbackPort: process.env.SF_MCP_CALLBACK_PORT || "8080",
  },
  agent: {
    maxSteps: Number(process.env.AGENT_MAX_STEPS || 8),
  },
};
