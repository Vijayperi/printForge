import { Scene } from "three"
import { describe, expect, it } from "vitest"

import {
  buildSceneFromStl,
  convertStlToGlb,
  ensureFileReader,
  exportGlb,
} from "@/src/adapters/conversion/stlToGlb"
import { looksLikeGlb } from "@/src/adapters/storage"

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]

function binaryStl(triangles: number[][]): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * triangles.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, triangles.length, true)
  triangles.forEach((tri, i) => {
    const base = 84 + 50 * i + 12
    for (let v = 0; v < 9; v += 1) view.setFloat32(base + v * 4, tri[v] as number, true)
  })
  return bytes
}

describe("ensureFileReader", () => {
  it("does nothing when FileReader already exists", () => {
    const existing = class {}
    const host = { FileReader: existing }
    ensureFileReader(host)
    expect(host.FileReader).toBe(existing)
  })

  it("installs a working polyfill when FileReader is absent", async () => {
    const host: { FileReader?: unknown } = {}
    ensureFileReader(host)
    expect(host.FileReader).toBeDefined()
    const Reader = host.FileReader as new () => {
      onloadend: (() => void) | null
      result: ArrayBuffer | null
      readAsArrayBuffer: (blob: Blob) => void
    }
    const reader = new Reader()
    await new Promise<void>((resolve) => {
      reader.onloadend = () => resolve()
      reader.readAsArrayBuffer(new Blob([new Uint8Array([1, 2, 3])]))
    })
    expect(reader.result?.byteLength).toBe(3)
  })
})

describe("buildSceneFromStl", () => {
  it("builds a scene from a valid STL", () => {
    const result = buildSceneFromStl(binaryStl([TRI]))
    expect(result.ok && result.value).toBeInstanceOf(Scene)
  })

  it("rejects an invalid STL", () => {
    const result = buildSceneFromStl(new Uint8Array([1, 2, 3]))
    expect(!result.ok && result.error.code).toBe("validation")
  })
})

describe("convertStlToGlb", () => {
  it("converts a valid STL into GLB bytes", async () => {
    const result = await convertStlToGlb(binaryStl([TRI, TRI]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(looksLikeGlb(result.value)).toBe(true)
  })

  it("propagates a parse rejection", async () => {
    const result = await convertStlToGlb(new Uint8Array([9, 9, 9]))
    expect(!result.ok && result.error.code).toBe("validation")
  })
})

describe("exportGlb", () => {
  it("exports a scene to GLB", async () => {
    const scene = buildSceneFromStl(binaryStl([TRI]))
    if (!scene.ok) throw new Error("scene build failed")
    const result = await exportGlb(scene.value)
    expect(result.ok && looksLikeGlb(result.value)).toBe(true)
  })
})
