import { SystemClock, type Clock } from "@/src/lib/clock"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogSink {
  write(line: string): void
}

type LogFn = (msg: string, fields?: Record<string, unknown>) => void

export interface Logger {
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
}

export type LoggerEnv = "development" | "test" | "production"

export function createLogger(opts: { env: LoggerEnv; sink?: LogSink; clock?: Clock }): Logger {
  const sink: LogSink = opts.sink ?? { write: (line) => console.log(line) }
  const clock: Clock = opts.clock ?? new SystemClock()

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (opts.env === "test") return
    if (opts.env === "production") {
      sink.write(JSON.stringify({ level, msg, time: clock.now().toISOString(), ...fields }))
      return
    }
    sink.write(`[${level}] ${msg}${fields === undefined ? "" : ` ${JSON.stringify(fields)}`}`)
  }

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  }
}

export function loggerEnvFromNodeEnv(nodeEnv: string | undefined): LoggerEnv {
  if (nodeEnv === "production") return "production"
  if (nodeEnv === "test") return "test"
  return "development"
}

export const logger: Logger = createLogger({ env: loggerEnvFromNodeEnv(process.env.NODE_ENV) })
