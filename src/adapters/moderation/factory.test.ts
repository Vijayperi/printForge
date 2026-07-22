import { describe, expect, it } from "vitest"

import { getModerator } from "@/src/adapters/moderation/factory"
import { WordlistModerator } from "@/src/adapters/moderation/wordlist"

describe("getModerator", () => {
  it("returns the wordlist moderator", () => {
    expect(getModerator()).toBeInstanceOf(WordlistModerator)
  })
})
