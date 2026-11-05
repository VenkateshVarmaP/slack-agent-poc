import { llm, MODEL } from "../llm/client.js";
import { logger } from "../utils/logger.js";

export type KnowledgeCategory =
  | "runbook"
  | "troubleshooting"
  | "architecture_decision"
  | "team_policy"
  | "onboarding"
  | "faq";

export interface IngestionValidationResult {
  allowed: boolean;
  reason: string;
  suggestedCategory?: KnowledgeCategory;
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /xox[baprs]-[0-9A-Za-z-]+/, label: "Slack API token" },
  { pattern: /sk-or-v1-[0-9a-f]{32,}/i, label: "OpenRouter API key" },
  { pattern: /AKIA[0-9A-Z]{16}/, label: "AWS Access Key ID" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "Private key" },
  {
    pattern: /postgresql:\/\/[^:\s]+:[^@\s]+@[^\s]+/i,
    label: "Database connection string with credentials",
  },
];

const RAW_CODE_HEURISTICS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:^|\n)\s*(?:import\s+[\s\S]+?from\s+['"].+?['"];?|export\s+(?:async\s+)?(?:function|class|interface|const)\s+\w+)/m,
    label: "Raw TypeScript/JavaScript source code",
  },
  {
    pattern:
      /(?:^|\n)\s*(?:public|private|global)\s+(?:with\s+sharing\s+|without\s+sharing\s+)?(?:class|trigger)\s+\w+/i,
    label: "Raw Salesforce Apex class/trigger code",
  },
  {
    pattern: /<\?xml[\s\S]*?<(?:\w+:)?(?:Profile|PermissionSet|CustomObject|Flow|ApexClass)\b/i,
    label: "Raw Salesforce Metadata XML dump",
  },
];

/**
 * Fast deterministic checks + LLM semantic classification to ensure PostgreSQL pgvector
 * only stores durable institutional knowledge—never live Salesforce org config, CRM records,
 * raw source code, or credentials.
 */
export async function validateKnowledgeForStorage(
  title: string,
  content: string
): Promise<IngestionValidationResult> {
  const combined = `${title}\n${content}`;

  // 1. Deterministic Check: Block secrets & credentials
  for (const { pattern, label } of SECRET_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        allowed: false,
        reason: `Rejected: Content contains a ${label}. Secrets and credentials must never be stored in the knowledge base.`,
      };
    }
  }

  // 2. Deterministic Check: Block raw code files or XML metadata dumps
  const codeLines = content
    .split("\n")
    .filter((line) => /[;{}()=<>]/.test(line)).length;
  const totalLines = Math.max(content.split("\n").length, 1);

  for (const { pattern, label } of RAW_CODE_HEURISTICS) {
    if (pattern.test(content) && codeLines / totalLines > 0.45) {
      return {
        allowed: false,
        reason: `Rejected: Content appears to be ${label}. Source code and metadata XML belong in Git or should be queried live from the Salesforce org, not stored in the RAG database.`,
      };
    }
  }

  // 3. Semantic Policy Check via LLM Classifier
  try {
    const response = await llm.chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a strict Data Governance Gatekeeper for an enterprise RAG Knowledge Base (PostgreSQL pgvector).
Your job is to classify whether a piece of information should be stored in the Knowledge Base or REJECTED.

ALLOW ONLY durable institutional knowledge:
- Runbooks, operational procedures, deployment windows, escalation paths ("runbook")
- Troubleshooting guides, error resolution notes, gotchas ("troubleshooting")
- Architecture Decision Records (ADRs), design rationale, system integration notes ("architecture_decision")
- Team policies, compliance rules, naming conventions, SLAs ("team_policy")
- Onboarding instructions and internal FAQs ("onboarding" or "faq")

STRICTLY REJECT (allowed: false):
1. Live Salesforce Org State / Config Values: e.g., current boolean flags on AccountSettings, list of active users/profiles in the org, current field values, org limits, or live metadata state that can be queried in real-time via the Salesforce Headless 360 MCP server.
2. Live CRM Business Records: e.g., specific Account, Contact, Opportunity, Lead, or Case record dumps, customer PII, or deal amounts.
3. Raw Source Code / Repo Logic: e.g., Apex classes, LWC components, TypeScript files, or SQL dumps that belong in the Git repository.
4. Out-of-Scope / Trivial Chatter: e.g., general world trivia, weather, jokes, personal reminders, or unrelated topics.

Respond ONLY with valid JSON matching this exact structure:
{"allowed": boolean, "reason": "concise explanation", "suggestedCategory": "runbook" | "troubleshooting" | "architecture_decision" | "team_policy" | "onboarding" | "faq"}`,
        },
        {
          role: "user",
          content: `Title: ${title}\nContent:\n${content}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as IngestionValidationResult;
      if (typeof parsed.allowed === "boolean" && typeof parsed.reason === "string") {
        return parsed;
      }
    }
  } catch (error) {
    logger.warn("LLM knowledge validation fallback triggered", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    allowed: true,
    reason: "Passed deterministic governance checks.",
    suggestedCategory: "runbook",
  };
}
