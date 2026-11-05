import { env } from "../config/env.js";
import {
  deleteKnowledgeByTitleOrId,
  ingestDocument,
  searchKnowledgeBase,
} from "../rag/repository.js";
import type { AgentTool } from "./types.js";

export const searchKnowledgeTool: AgentTool = {
  spec: {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "Search the PostgreSQL pgvector knowledge base ONLY for durable institutional knowledge: internal runbooks, troubleshooting guides, architecture decisions, and team policies. Do NOT use this tool for live Salesforce org configurations, active user/profile state, or CRM records (use sf_discover/sf_describe/sf_dispatch_readonly for live org state instead).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query or question to look up in the knowledge base.",
          },
          category: {
            type: "string",
            enum: [
              "runbook",
              "troubleshooting",
              "architecture_decision",
              "team_policy",
              "onboarding",
              "faq",
              "documentation",
            ],
            description: "Optional category filter.",
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
        "Validate and upsert durable institutional knowledge (runbooks, troubleshooting resolutions, architecture decisions, team policies, SLAs) into PostgreSQL pgvector. Existing entries with the same title and source are automatically updated in place. NEVER call this to store live Salesforce org configurations, CRM records, raw source code, or secrets.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short descriptive title of the knowledge entry.",
          },
          content: {
            type: "string",
            description: "Full text content to validate, chunk, embed, and upsert.",
          },
          category: {
            type: "string",
            enum: [
              "runbook",
              "troubleshooting",
              "architecture_decision",
              "team_policy",
              "onboarding",
              "faq",
            ],
            description: "Category tag for the institutional knowledge.",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  run: async (args) => {
    const title = String(args.title || "Untitled");
    const content = String(args.content || "");
    const category = args.category ? String(args.category) : undefined;

    const outcome = await ingestDocument({
      title,
      content,
      source: "slack",
      category,
    });

    if (!outcome.accepted) {
      return `STORAGE_REJECTED: ${outcome.validation.reason}`;
    }

    return `Successfully validated and upserted "${title}" into the knowledge base under category '${outcome.category}' (${outcome.chunksInserted} chunk(s) indexed).`;
  },
};

export const deleteKnowledgeTool: AgentTool = {
  spec: {
    type: "function",
    function: {
      name: "delete_from_knowledge_base",
      description:
        "Delete outdated, superseded, or incorrect institutional knowledge entries from the PostgreSQL pgvector knowledge base by ID or title.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "Exact numeric chunk ID to delete (from search_knowledge_base results).",
          },
          titleQuery: {
            type: "string",
            description: "Case-insensitive title substring to match and delete.",
          },
        },
      },
    },
  },
  run: async (args) => {
    const id = args.id !== undefined ? Number(args.id) : undefined;
    const titleQuery = args.titleQuery ? String(args.titleQuery) : undefined;

    const deletedCount = await deleteKnowledgeByTitleOrId({ id, titleQuery });
    if (deletedCount === 0) {
      return "No matching knowledge base entries found to delete.";
    }
    return `Deleted ${deletedCount} knowledge base entry/entries.`;
  },
};

export function getRagTools(): Record<string, AgentTool> {
  if (!env.rag.enabled) {
    return {};
  }

  return {
    search_knowledge_base: searchKnowledgeTool,
    save_to_knowledge_base: saveKnowledgeTool,
    delete_from_knowledge_base: deleteKnowledgeTool,
  };
}
