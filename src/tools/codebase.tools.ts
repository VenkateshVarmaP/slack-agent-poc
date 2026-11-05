import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool } from "./types.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".continue"]);

async function walkFiles(dir: string, rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".env")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath, rootDir)));
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".json") ||
      entry.name.endsWith(".md")
    ) {
      results.push(path.relative(rootDir, fullPath));
    }
  }

  return results;
}

export const searchCodebaseTool: AgentTool = {
  spec: {
    type: "function",
    function: {
      name: "search_codebase",
      description:
        "Read-only tool to inspect live source code files or search for keywords/symbols in the project repository. Use this when asked about how the codebase works instead of looking in the RAG knowledge base.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "Optional relative file path to read directly (e.g. 'src/rag/repository.ts' or 'package.json').",
          },
          searchQuery: {
            type: "string",
            description:
              "Optional keyword, function name, or symbol to search across all repository source files.",
          },
        },
      },
    },
  },
  run: async (args) => {
    const rootDir = process.cwd();
    const filePathArg = args.filePath ? String(args.filePath).trim() : "";
    const searchQuery = args.searchQuery ? String(args.searchQuery).trim() : "";

    if (filePathArg) {
      const resolved = path.resolve(rootDir, filePathArg);
      if (!resolved.startsWith(rootDir) || path.basename(resolved).startsWith(".env")) {
        return "Error: Access to the requested path is restricted.";
      }
      try {
        const content = await fs.readFile(resolved, "utf8");
        return `// File: ${filePathArg}\n${content.slice(0, 8000)}`;
      } catch {
        return `Error: File '${filePathArg}' not found.`;
      }
    }

    const allFiles = await walkFiles(rootDir, rootDir);
    if (!searchQuery) {
      return `Repository files:\n${allFiles.map((f) => `- ${f}`).join("\n")}`;
    }

    const matches: Array<{ file: string; snippets: string[] }> = [];
    const needle = searchQuery.toLowerCase();

    for (const relFile of allFiles) {
      const content = await fs.readFile(path.join(rootDir, relFile), "utf8");
      const lines = content.split("\n");
      const hitLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hitLines.push(`L${i + 1}: ${lines[i].trim()}`);
        }
      }

      if (hitLines.length > 0) {
        matches.push({ file: relFile, snippets: hitLines.slice(0, 10) });
      }
    }

    if (matches.length === 0) {
      return `No matches found in repository for '${searchQuery}'. Available files:\n${allFiles.join(", ")}`;
    }

    return JSON.stringify(matches, null, 2);
  },
};

export const codebaseTools: Record<string, AgentTool> = {
  search_codebase: searchCodebaseTool,
};
