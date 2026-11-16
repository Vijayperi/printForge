import { describe, expect, it } from "vitest"

import { cn } from "@/src/lib/utils"

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b")
  })

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c")
  })

  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("handles array and object inputs", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c")
  })

  it("returns an empty string with no input", () => {
    expect(cn()).toBe("")
  })
})
