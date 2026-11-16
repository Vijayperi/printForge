import { describe, expect, it } from "vitest"

import { err, mapResult, ok, unwrapOr } from "@/src/lib/result"

describe("result", () => {
  it("ok wraps a value", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 })
  })

  it("err wraps an error", () => {
    expect(err("boom")).toEqual({ ok: false, error: "boom" })
  })

  it("mapResult transforms an ok value", () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6))
  })

  it("mapResult passes an err through untouched", () => {
    const failure = err("nope")
    expect(mapResult(failure, (n: number) => n * 3)).toBe(failure)
  })

  it("unwrapOr returns the value for ok", () => {
    expect(unwrapOr(ok("hello"), "fallback")).toBe("hello")
  })

  it("unwrapOr returns the fallback for err", () => {
    expect(unwrapOr(err("bad"), "fallback")).toBe("fallback")
  })
})
