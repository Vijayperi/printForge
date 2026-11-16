import { describe, expect, it, vi } from "vitest"

import { FixedClock } from "@/src/lib/clock"
import { createLogger, logger, loggerEnvFromNodeEnv, type LogSink } from "@/src/lib/logger"

function fakeSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = []
  return { sink: { write: (line) => lines.push(line) }, lines }
}

describe("createLogger", () => {
  it("is silent in the test environment", () => {
    const { sink, lines } = fakeSink()
    const log = createLogger({ env: "test", sink })
    log.debug("a")
    log.info("b")
    log.warn("c")
    log.error("d")
    expect(lines).toEqual([])
  })

  it("emits JSON lines in production with an injected clock", () => {
    const { sink, lines } = fakeSink()
    const clock = new FixedClock(new Date("2026-07-19T10:00:00.000Z"))
    const log = createLogger({ env: "production", sink, clock })
    log.info("order paid", { orderId: "ord_1" })
    expect(JSON.parse(lines[0] as string)).toEqual({
      level: "info",
      msg: "order paid",
      time: "2026-07-19T10:00:00.000Z",
      orderId: "ord_1",
    })
  })

  it("emits all four levels", () => {
    const { sink, lines } = fakeSink()
    const clock = new FixedClock(new Date("2026-07-19T10:00:00.000Z"))
    const log = createLogger({ env: "production", sink, clock })
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    expect(lines.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual([
      "debug",
      "info",
      "warn",
      "error",
    ])
  })

  it("emits human-readable lines in development, with and without fields", () => {
    const { sink, lines } = fakeSink()
    const log = createLogger({ env: "development", sink })
    log.warn("plain")
    log.error("with fields", { a: 1 })
    expect(lines).toEqual(["[warn] plain", '[error] with fields {"a":1}'])
  })

  it("defaults to a console sink and the system clock", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const log = createLogger({ env: "production" })
    log.info("to console")
    expect(spy).toHaveBeenCalledOnce()
    const line = JSON.parse(spy.mock.calls[0]?.[0] as string) as { msg: string; time: string }
    expect(line.msg).toBe("to console")
    expect(new Date(line.time).getTime()).not.toBeNaN()
    spy.mockRestore()
  })
})

describe("loggerEnvFromNodeEnv", () => {
  it("maps production", () => {
    expect(loggerEnvFromNodeEnv("production")).toBe("production")
  })

  it("maps test", () => {
    expect(loggerEnvFromNodeEnv("test")).toBe("test")
  })

  it("defaults everything else to development", () => {
    expect(loggerEnvFromNodeEnv("development")).toBe("development")
    expect(loggerEnvFromNodeEnv(undefined)).toBe("development")
    expect(loggerEnvFromNodeEnv("staging")).toBe("development")
  })
})

describe("module-level logger", () => {
  it("exists and is silent under vitest", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    logger.info("should not appear")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
