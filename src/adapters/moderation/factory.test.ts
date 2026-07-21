import { describe, expect, it } from "vitest"

import { getModerator } from "@/src/adapters/moderation/factory"
import { MockModerator } from "@/src/adapters/moderation/mock"

describe("getModerator", () => {
  it("returns the mock moderator", () => {
    expect(getModerator()).toBeInstanceOf(MockModerator)
  })
})
