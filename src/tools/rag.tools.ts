import { env } from "../config/env.js";
import { ingestDocument, searchKnowledgeBase } from "../rag/repository.js";
import type { AgentTool } from "./types.js";

export const searchKnowledgeTool: AgentTool = {
  spec: {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "Search the PostgreSQL pgvector knowledge base for company documentation, runbooks, FAQs, and past resolutions using hybrid semantic + keyword search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query or question to look up in the knowledge base.",
          },
          category: {
            type: "string",
            description: "Optional category filter (e.g. 'general', 'documentation', 'runbook', 'salesforce').",
          },
          topK: {
            type: "number",
            description: "Maximum number of matching chunks to return (default: 5).",
          },
        },
        required: ["query"],
      },
    },
  },
  run: async (args) => {
    const query = String(args.query || "");
    const topK = args.topK ? Number(args.topK) : 5;
    const category = args.category ? String(args.category) : undefined;

    const results = await searchKnowledgeBase(query, topK, category);
    if (results.length === 0) {
      return "No matching knowledge base articles found.";
    }
    return JSON.stringify(results, null, 2);
  },
};

export const saveKnowledgeTool: AgentTool = {
  spec: {
    type: "function",
    function: {
      name: "save_to_knowledge_base",
      description:
        "Save a new note, runbook, FAQ, or troubleshooting resolution into the PostgreSQL pgvector knowledge base for future retrieval.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short descriptive title of the knowledge entry.",
          },
          content: {
            type: "string",
            description: "Full text content to chunk, embed, and store.",
          },
          category: {
            type: "string",
            description: "Category tag (e.g., 'general', 'runbook', 'salesforce', 'faq').",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  run: async (args) => {
    const title = String(args.title || "Untitled");
    const content = String(args.content || "");
    const category = String(args.category || "general");

    const chunksInserted = await ingestDocument({
      title,
      content,
      source: "slack",
      category,
    });

    return `Successfully saved "${title}" into the knowledge base (${chunksInserted} chunk(s) indexed).`;
  },
};

export function getRagTools(): Record<string, AgentTool> {
  if (!env.rag.enabled) {
    return {};
  }

  return {
    search_knowledge_base: searchKnowledgeTool,
    save_to_knowledge_base: saveKnowledgeTool,
  };
}
