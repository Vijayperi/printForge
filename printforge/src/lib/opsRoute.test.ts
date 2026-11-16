import { describe, expect, it } from "vitest"
import { z } from "zod"

import { appError } from "@/src/lib/errors"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

const schema = z.strictObject({ reason: z.string().min(1) })

function post(body: BodyInit): Request {
  return new Request("http://test/api/ops/thing", { method: "POST", body })
}

describe("jsonError", () => {
  it("maps an app error to its http status and body", async () => {
    const response = jsonError(appError("not_found", "order not found"))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "order not found" },
    })
  })
})

describe("parseJsonBody", () => {
  it("returns the parsed body", async () => {
    await expect(parseJsonBody(post(JSON.stringify({ reason: "ok" })), schema)).resolves.toEqual({
      ok: true,
      value: { reason: "ok" },
    })
  })

  it("rejects a body that is not json", async () => {
    const result = await parseJsonBody(post("{"), schema)
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } })
    if (!result.ok) expect(result.error.message).toBe("request body must be json")
  })

  it("names the offending field when validation fails", async () => {
    const result = await parseJsonBody(post(JSON.stringify({ reason: "" })), schema)
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } })
    if (!result.ok) expect(result.error.message).toMatch(/^reason: /)
  })
})
