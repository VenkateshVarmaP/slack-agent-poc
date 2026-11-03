import OpenAI from "openai";
import { env } from "../config/env.js";

export const MODEL = env.llm.model;

export const llm = new OpenAI({
  baseURL: env.llm.baseURL,
  apiKey: env.llm.apiKey,
  defaultHeaders: {
    "HTTP-Referer": env.llm.referer,
    "X-Title": env.llm.appTitle,
  },
});
