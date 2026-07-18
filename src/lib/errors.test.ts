import { describe, expect, it } from "vitest"

import { AppError, appError, toHttpError, type ErrorCode } from "@/src/lib/errors"

describe("AppError", () => {
  it("carries code, message, and name", () => {
    const e = new AppError("not_found", "missing thing")
    expect(e.code).toBe("not_found")
    expect(e.message).toBe("missing thing")
    expect(e.name).toBe("AppError")
    expect(e.cause).toBeUndefined()
  })

  it("carries a cause when provided", () => {
    const inner = new Error("inner")
    const e = new AppError("internal", "outer", inner)
    expect(e.cause).toBe(inner)
  })

  it("appError helper constructs an AppError", () => {
    const e = appError("conflict", "already exists")
    expect(e).toBeInstanceOf(AppError)
    expect(e.code).toBe("conflict")
  })

  it("appError helper forwards a cause", () => {
    const e = appError("provider_error", "upstream", "raw-detail")
    expect(e.cause).toBe("raw-detail")
  })
})

describe("toHttpError", () => {
  const cases: Array<[ErrorCode, number]> = [
    ["validation", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["rate_limited", 429],
    ["provider_error", 502],
    ["precondition_failed", 412],
    ["internal", 500],
  ]

  it.each(cases)("maps %s to HTTP %d", (code, status) => {
    const result = toHttpError(new AppError(code, "msg"))
    expect(result.status).toBe(status)
    expect(result.body).toEqual({ error: { code, message: "msg" } })
  })
})
