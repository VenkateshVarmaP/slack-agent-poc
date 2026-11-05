import type { KnownBlock } from "@slack/types";
import type { PendingApprovalRecord } from "../agent/store.js";

const MAX_SECTION_TEXT_LENGTH = 2900;

/**
 * Converts standard GitHub Markdown into Slack's native `mrkdwn` syntax,
 * while leaving fenced code blocks untouched.
 */
export function toSlackMrkdwn(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        return part.replace(/^```[a-zA-Z0-9_-]+\n/, "```\n");
      }

      return (
        part
          // Headings (#, ##, ###) -> *Heading*
          .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
          // Bold (**text** or __text__) -> *text*
          .replace(/\*\*(.+?)\*\*/g, "*$1*")
          .replace(/__(.+?)__/g, "*$1*")
          // Strikethrough (~~text~~) -> ~text~
          .replace(/~~(.+?)~~/g, "~$1~")
          // Markdown links [Label](https://...) -> <https://...|Label>
          .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
          // Unordered bullets (- or *) -> •
          .replace(/^(\s*)[-*]\s+/gm, "$1• ")
      );
    })
    .join("");
}

function splitLongSection(text: string): string[] {
  if (text.length <= MAX_SECTION_TEXT_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if ((current + "\n" + line).length > MAX_SECTION_TEXT_LENGTH) {
      if (current.trim()) chunks.push(current.trim());
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "📚 Knowledge Base",
  save_to_knowledge_base: "💾 Saved to Knowledge Base",
  delete_from_knowledge_base: "🗑️ Knowledge Base Cleanup",
  search_codebase: "💻 Repository Codebase",
  sf_discover: "☁️ Salesforce Discovery",
  sf_describe: "📋 Salesforce API Schema",
  sf_dispatch_readonly: "🔍 Salesforce Org Query",
  sf_dispatch: "⚡ Salesforce Org Action",
  get_time: "🕒 System Time",
};

export function formatToolStatusMessage(toolName: string): string {
  switch (toolName) {
    case "search_knowledge_base":
      return "🔍 _Searching AWS RDS Knowledge Base..._";
    case "save_to_knowledge_base":
      return "🛡️ _Validating & indexing knowledge into AWS RDS pgvector..._";
    case "delete_from_knowledge_base":
      return "🗑️ _Removing entry from AWS RDS Knowledge Base..._";
    case "search_codebase":
      return "💻 _Inspecting project repository source code..._";
    case "sf_discover":
      return "☁️ _Discovering Salesforce Headless 360 recipes..._";
    case "sf_describe":
      return "📋 _Inspecting Salesforce operation schema..._";
    case "sf_dispatch_readonly":
      return "🔎 _Querying Salesforce org..._";
    case "sf_dispatch":
      return "⚡ _Executing Salesforce org operation..._";
    default:
      return `⚙️ _Running \`${toolName}\`..._`;
  }
}

export function buildSlackBlocks(
  rawResponse: string,
  toolsUsed: string[] = [],
  pendingApproval?: PendingApprovalRecord
): KnownBlock[] {
  const mrkdwn = toSlackMrkdwn(rawResponse.trim());
  const sections = mrkdwn
    .split(/\n\s*---+\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const blocks: KnownBlock[] = [];

  for (let i = 0; i < sections.length; i++) {
    const subChunks = splitLongSection(sections[i]);
    for (const chunk of subChunks) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: chunk,
        },
      });
    }

    if (i < sections.length - 1) {
      blocks.push({ type: "divider" });
    }
  }

  if (pendingApproval) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "✅ Approve & Execute",
            emoji: true,
          },
          style: "primary",
          action_id: "agent_approve_action",
          value: pendingApproval.id,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "❌ Reject",
            emoji: true,
          },
          style: "danger",
          action_id: "agent_reject_action",
          value: pendingApproval.id,
        },
      ],
    });
  }

  if (toolsUsed.length > 0) {
    const uniqueBadges = Array.from(new Set(toolsUsed)).map(
      (name) => TOOL_LABELS[name] || `\`${name}\``
    );

    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Sources:* ${uniqueBadges.join("  •  ")}`,
        },
      ],
    });
  }

  return blocks.slice(0, 50);
}
