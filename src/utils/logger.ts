type LogLevel = "info" | "warn" | "error" | "debug";

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.log(formatMessage("info", message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(formatMessage("warn", message, meta));
  },
  error(message: string, error?: unknown, meta?: Record<string, unknown>) {
    const errMeta =
      error instanceof Error
        ? { ...meta, error: error.message, stack: error.stack }
        : { ...meta, error };
    console.error(formatMessage("error", message, errMeta));
  },
  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.DEBUG === "true") {
      console.debug(formatMessage("debug", message, meta));
    }
  },
};
