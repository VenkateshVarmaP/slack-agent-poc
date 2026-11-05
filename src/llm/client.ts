import OpenAI from "openai";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const MODEL = env.llm.model;

export const llm = new OpenAI({
  baseURL: env.llm.baseURL,
  apiKey: env.llm.apiKey,
  defaultHeaders: {
    "HTTP-Referer": env.llm.referer,
    "X-Title": env.llm.appTitle,
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes chat completions with exponential backoff retry on 429/5xx
 * and automatic model fallback when the primary model is unavailable.
 */
export async function createChatCompletionWithRetry(
  params: Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, "model">,
  preferredModel = MODEL
): Promise<OpenAI.ChatCompletion> {
  const modelsToTry =
    preferredModel !== env.llm.fallbackModel
      ? [preferredModel, env.llm.fallbackModel]
      : [preferredModel];

  let lastError: unknown;

  for (const currentModel of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await llm.chat.completions.create({
          ...params,
          model: currentModel,
        });
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number })?.status;
        const isRetryable =
          status === 429 || status === 502 || status === 503 || status === 504;

        logger.warn("LLM request failed", {
          model: currentModel,
          attempt: attempt + 1,
          status,
          error: err instanceof Error ? err.message : String(err),
        });

        if (!isRetryable) {
          break;
        }
        await sleep(600 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}
