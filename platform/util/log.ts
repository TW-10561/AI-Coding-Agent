// ---------------------------------------------------------------------------
// Lightweight console-based logger for standalone HITL / security modules.
// Matches the Log.create() interface used throughout policy implementations.
// ---------------------------------------------------------------------------

interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void
  debug(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}

const isDebug = process.env.LOG_LEVEL === "debug"

export const Log = {
  create({ service }: { service: string }): Logger {
    const prefix = `[${service}]`
    return {
      info:  (msg, meta) => console.info(prefix, msg, ...(meta ? [meta] : [])),
      debug: (msg, meta) => { if (isDebug) console.debug(prefix, msg, ...(meta ? [meta] : [])) },
      warn:  (msg, meta) => console.warn(prefix, msg, ...(meta ? [meta] : [])),
      error: (msg, meta) => console.error(prefix, msg, ...(meta ? [meta] : [])),
    }
  },
}
