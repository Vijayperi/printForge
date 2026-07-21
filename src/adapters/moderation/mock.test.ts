import { describe, expect, it } from "vitest"

import { MockModerator } from "@/src/adapters/moderation/mock"

describe("MockModerator", () => {
  it("allows any text prompt", async () => {
    const result = await new MockModerator().check({ text: "a friendly dinosaur" })
    expect(result).toEqual({ ok: true, value: { verdict: "allow" } })
  })

  it("allows an image payload", async () => {
    const result = await new MockModerator().check({ imageBytes: new Uint8Array([1, 2, 3]) })
    expect(result.ok && result.value.verdict).toBe("allow")
  })
})
