import OpenAI from "openai";

export const MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

export const llm = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Slack Agent POC",
  },
});
