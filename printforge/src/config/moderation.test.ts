import { describe, expect, it } from "vitest"

import { denyTerms, flagTerms, moderationCategories } from "@/src/config/moderation"

describe("moderation config", () => {
  it("provides non-empty deny and flag lists", () => {
    expect(denyTerms.length).toBeGreaterThan(0)
    expect(flagTerms.length).toBeGreaterThan(0)
  })

  it("keeps every term lowercase", () => {
    for (const term of [...denyTerms, ...flagTerms]) {
      expect(term).toBe(term.toLowerCase())
    }
  })

  it("keeps deny and flag lists disjoint", () => {
    const flagSet = new Set(flagTerms)
    expect(denyTerms.some((t) => flagSet.has(t))).toBe(false)
  })

  it("describes the moderation categories", () => {
    expect(moderationCategories.length).toBeGreaterThan(0)
  })
})
