import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { getDbPool, initializeRagDatabase } from "../rag/db.js";
import { logger } from "../utils/logger.js";

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PendingApprovalRecord {
  id: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  summary: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
}

const inMemoryThreads = new Map<string, ThreadMessage[]>();
const inMemoryApprovals = new Map<string, PendingApprovalRecord>();

function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export async function getThreadHistory(
  channelId: string,
  threadTs: string,
  limit = env.agent.maxThreadMessages
): Promise<ThreadMessage[]> {
  if (!env.rag.enabled) {
    const msgs = inMemoryThreads.get(threadKey(channelId, threadTs)) || [];
    return msgs.slice(-limit);
  }

  try {
    await initializeRagDatabase();
    const db = getDbPool();
    const { rows } = await db.query(
      `
      SELECT role, content
      FROM (
        SELECT role, content, created_at
        FROM conversation_messages
        WHERE channel_id = $1 AND thread_ts = $2
        ORDER BY created_at DESC
        LIMIT $3
      ) sub
      ORDER BY created_at ASC;
      `,
      [channelId, threadTs, limit]
    );

    return rows.map((r) => ({
      role: r.role as "user" | "assistant",
      content: String(r.content),
    }));
  } catch (error) {
    logger.warn("Failed to read thread history from PostgreSQL; using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function appendThreadMessage(params: {
  channelId: string;
  threadTs: string;
  slackUserId?: string;
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  const key = threadKey(params.channelId, params.threadTs);
  const existing = inMemoryThreads.get(key) || [];
  existing.push({ role: params.role, content: params.content });
  inMemoryThreads.set(key, existing.slice(-20));

  if (!env.rag.enabled) return;

  try {
    await initializeRagDatabase();
    const db = getDbPool();
    await db.query(
      `
      INSERT INTO conversation_messages (channel_id, thread_ts, slack_user_id, role, content)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [
        params.channelId,
        params.threadTs,
        params.slackUserId || null,
        params.role,
        params.content,
      ]
    );
  } catch (error) {
    logger.warn("Failed to persist conversation message", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function hasActiveThreadInDb(
  channelId: string,
  threadTs: string
): Promise<boolean> {
  if (inMemoryThreads.has(threadKey(channelId, threadTs))) {
    return true;
  }
  if (!env.rag.enabled) return false;

  try {
    await initializeRagDatabase();
    const db = getDbPool();
    const { rowCount } = await db.query(
      `SELECT 1 FROM conversation_messages WHERE channel_id = $1 AND thread_ts = $2 LIMIT 1`,
      [channelId, threadTs]
    );
    return (rowCount || 0) > 0;
  } catch {
    return false;
  }
}

export async function recordAuditLog(params: {
  slackUserId: string;
  channelId: string;
  threadTs: string;
  userPrompt: string;
  toolsCalled: string[];
  status: string;
  responsePreview: string;
}): Promise<void> {
  if (!env.rag.enabled) return;

  try {
    await initializeRagDatabase();
    const db = getDbPool();
    await db.query(
      `
      INSERT INTO audit_logs (slack_user_id, channel_id, thread_ts, user_prompt, tools_called, status, response_preview)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
      `,
      [
        params.slackUserId,
        params.channelId,
        params.threadTs,
        params.userPrompt,
        params.toolsCalled,
        params.status,
        params.responsePreview.slice(0, 500),
      ]
    );
  } catch (error) {
    logger.warn("Failed to write audit log", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createPendingApproval(params: {
  slackUserId: string;
  channelId: string;
  threadTs: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  summary: string;
}): Promise<PendingApprovalRecord> {
  const id = randomUUID().slice(0, 12);
  const record: PendingApprovalRecord = {
    id,
    ...params,
    status: "pending",
  };

  inMemoryApprovals.set(id, record);

  if (env.rag.enabled) {
    try {
      await initializeRagDatabase();
      const db = getDbPool();
      await db.query(
        `
        INSERT INTO pending_approvals (id, slack_user_id, channel_id, thread_ts, tool_name, tool_args, summary, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending');
        `,
        [
          id,
          params.slackUserId,
          params.channelId,
          params.threadTs,
          params.toolName,
          JSON.stringify(params.toolArgs),
          params.summary,
        ]
      );
    } catch (error) {
      logger.warn("Failed to persist pending approval to DB", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return record;
}

export async function resolvePendingApproval(
  id: string,
  decision: "approved" | "rejected",
  decidedBy: string
): Promise<PendingApprovalRecord | null> {
  if (env.rag.enabled) {
    try {
      await initializeRagDatabase();
      const db = getDbPool();
      const { rows } = await db.query(
        `
        UPDATE pending_approvals
        SET status = $2, decided_by = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING *;
        `,
        [id, decision, decidedBy]
      );

      if (rows.length > 0) {
        const row = rows[0];
        const updated: PendingApprovalRecord = {
          id: String(row.id),
          slackUserId: String(row.slack_user_id),
          channelId: String(row.channel_id),
          threadTs: String(row.thread_ts),
          toolName: String(row.tool_name),
          toolArgs: (row.tool_args as Record<string, unknown>) || {},
          summary: String(row.summary),
          status: decision,
          decidedBy,
        };
        inMemoryApprovals.set(id, updated);
        return updated;
      }
    } catch (error) {
      logger.warn("Failed to update pending approval in DB", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const mem = inMemoryApprovals.get(id);
  if (mem && mem.status === "pending") {
    mem.status = decision;
    mem.decidedBy = decidedBy;
    return mem;
  }

  return null;
}

export function isUserAuthorizedForWrites(slackUserId?: string): boolean {
  if (env.slack.adminUserIds.length === 0) {
    return true;
  }
  return Boolean(slackUserId && env.slack.adminUserIds.includes(slackUserId));
}
