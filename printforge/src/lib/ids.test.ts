import { describe, expect, it } from "vitest"

import { ID_PREFIXES, isId, newId } from "@/src/lib/ids"

describe("newId", () => {
  it.each(ID_PREFIXES.map((p) => [p] as const))("generates a valid %s id", (prefix) => {
    const id = newId(prefix)
    expect(id.startsWith(`${prefix}_`)).toBe(true)
    expect(isId(prefix, id)).toBe(true)
  })

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId("proj")))
    expect(ids.size).toBe(100)
  })
})

describe("isId", () => {
  it("rejects an id with the wrong prefix", () => {
    expect(isId("ord", newId("proj"))).toBe(false)
  })

  it("rejects a ulid that is too short", () => {
    expect(isId("proj", "proj_ABC")).toBe(false)
  })

  it("rejects lowercase ulid characters", () => {
    expect(isId("proj", `proj_${"a".repeat(26)}`)).toBe(false)
  })

  it("rejects excluded Crockford characters (I, L, O, U)", () => {
    expect(isId("proj", `proj_${"I".repeat(26)}`)).toBe(false)
    expect(isId("proj", `proj_${"U".repeat(26)}`)).toBe(false)
  })

  it("rejects empty and unrelated strings", () => {
    expect(isId("proj", "")).toBe(false)
    expect(isId("proj", "hello")).toBe(false)
  })
})
