import { describe, expect, it } from "vitest"

import { WordlistModerator } from "@/src/adapters/moderation/wordlist"

const moderator = new WordlistModerator({
  denyTerms: ["gun", "explosive"],
  flagTerms: ["knife", "brand"],
})

describe("WordlistModerator", () => {
  it("allows a benign prompt", async () => {
    const result = await moderator.check({ text: "a friendly dinosaur planter" })
    expect(result).toEqual({ ok: true, value: { verdict: "allow" } })
  })

  it("denies a prompt containing a deny term (case-insensitive)", async () => {
    const result = await moderator.check({ text: "a realistic GUN model" })
    expect(result.ok && result.value).toEqual({ verdict: "deny", category: "gun" })
  })

  it("flags a prompt containing a flag term when no deny term matches", async () => {
    const result = await moderator.check({ text: "a decorative knife holder" })
    expect(result.ok && result.value).toEqual({ verdict: "flag", category: "knife" })
  })

  it("prefers deny over flag when both are present", async () => {
    const result = await moderator.check({ text: "a knife and a gun" })
    expect(result.ok && result.value.verdict).toBe("deny")
  })

  it("matches whole words only (no false positive on substrings)", async () => {
    // "begun" contains "gun", "branding" contains "brand" — neither should match.
    const result = await moderator.check({ text: "we have begun branding the shop" })
    expect(result.ok && result.value.verdict).toBe("allow")
  })

  it("allows image-only input (no text) pending an image classifier", async () => {
    const result = await moderator.check({ imageBytes: new Uint8Array([1, 2, 3]) })
    expect(result.ok && result.value.verdict).toBe("allow")
  })

  it("escapes regex metacharacters in terms", async () => {
    const special = new WordlistModerator({ denyTerms: ["a.b"], flagTerms: [] })
    // The "." must be literal, not a wildcard: "axb" must NOT match "a.b".
    expect((await special.check({ text: "an axb widget" })).ok && (await special.check({ text: "an axb widget" })).ok).toBe(true)
    const literal = await special.check({ text: "an axb widget" })
    expect(literal.ok && literal.value.verdict).toBe("allow")
    const hit = await special.check({ text: "an a.b widget" })
    expect(hit.ok && hit.value.verdict).toBe("deny")
  })
})
