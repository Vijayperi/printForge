import { describe, expect, it } from "vitest"

import { getGlbConverter } from "@/src/adapters/conversion/factory"
import { MockGlbConverter } from "@/src/adapters/conversion/mock"
import { looksLikeGlb } from "@/src/adapters/storage"

describe("MockGlbConverter", () => {
  const converter = new MockGlbConverter()

  it("derives a minimal valid binary STL (84 bytes)", async () => {
    const stl = await converter.toStl(new Uint8Array([1, 2, 3]))
    expect(stl.ok && stl.value.length).toBe(84)
  })

  it("derives a non-empty PNG thumbnail", async () => {
    const png = await converter.toThumbnail(new Uint8Array([1]))
    expect(png.ok).toBe(true)
    if (png.ok) {
      // PNG magic bytes.
      expect([...png.value.slice(0, 4)]).toEqual([137, 80, 78, 71])
      expect(looksLikeGlb(png.value)).toBe(false)
    }
  })
})

describe("getGlbConverter", () => {
  it("returns the mock converter", () => {
    expect(getGlbConverter()).toBeInstanceOf(MockGlbConverter)
  })
})
