import { describe, expect, it } from "vitest"

import { optimizeGlb, readGlbChunks, writeGlb } from "@/src/adapters/conversion/optimizeGlb"
import { buildSceneFromStl, exportGlb } from "@/src/adapters/conversion/stlToGlb"

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Build a GLB by hand so each malformed case can be produced exactly. */
function glb(
  chunks: { type: number; data: Uint8Array }[],
  over: { magic?: number; version?: number; length?: number } = {}
): Uint8Array {
  const padded = chunks.map((chunk) => ({ ...chunk, pad: (4 - (chunk.data.byteLength % 4)) % 4 }))
  const total =
    12 + padded.reduce((sum, chunk) => sum + 8 + chunk.data.byteLength + chunk.pad, 0)

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, over.magic ?? GLB_MAGIC, true)
  view.setUint32(4, over.version ?? 2, true)
  view.setUint32(8, over.length ?? total, true)

  let offset = 12
  for (const chunk of padded) {
    view.setUint32(offset, chunk.data.byteLength + chunk.pad, true)
    view.setUint32(offset + 4, chunk.type, true)
    out.set(chunk.data, offset + 8)
    // Spec padding: spaces for JSON, zeroes for everything else.
    if (chunk.type === CHUNK_JSON) {
      out.fill(0x20, offset + 8 + chunk.data.byteLength, offset + 8 + chunk.data.byteLength + chunk.pad)
    }
    offset += 8 + chunk.data.byteLength + chunk.pad
  }
  return out
}

function jsonChunk(text: string) {
  return { type: CHUNK_JSON, data: encode(text) }
}

/** A GLB three itself produced, so the optimizer is proven on real output. */
async function realGlb(): Promise<Uint8Array> {
  const stl = new Uint8Array(84 + 50)
  const view = new DataView(stl.buffer)
  view.setUint32(80, 1, true)
  const triangle = [0, 0, 0, 10, 0, 0, 0, 10, 0]
  for (let v = 0; v < 9; v += 1) view.setFloat32(84 + 12 + v * 4, triangle[v] as number, true)

  const scene = buildSceneFromStl(stl)
  if (!scene.ok) throw new Error("fixture scene failed to build")
  const exported = await exportGlb(scene.value)
  if (!exported.ok) throw new Error("fixture GLB failed to export")
  return exported.value
}

describe("readGlbChunks", () => {
  it("reads a JSON chunk and a BIN chunk", () => {
    const bytes = glb([jsonChunk('{"asset":{"version":"2.0"}}'), { type: CHUNK_BIN, data: new Uint8Array([1, 2, 3, 4]) }])
    const chunks = readGlbChunks(bytes)

    expect(chunks.ok).toBe(true)
    if (chunks.ok) {
      expect(chunks.value).toHaveLength(2)
      expect(chunks.value[1]?.data).toEqual(new Uint8Array([1, 2, 3, 4]))
    }
  })

  it.each([
    ["a file too short to hold a header", new Uint8Array(4), /too short/],
    ["a file that is not a GLB", glb([jsonChunk("{}")], { magic: 0x12345678 }), /bad magic/],
    ["a GLB from a future version", glb([jsonChunk("{}")], { version: 3 }), /version 3/],
    ["a length header that lies", glb([jsonChunk("{}")], { length: 999 }), /disagrees/],
    ["a container with no chunks at all", glb([]), /no chunks/],
    ["a container that does not start with JSON", glb([{ type: CHUNK_BIN, data: new Uint8Array(4) }]), /does not start with JSON/],
  ])("refuses %s", (_label, bytes, message) => {
    const result = readGlbChunks(bytes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(message)
  })

  it("refuses a chunk that runs past the end of the file", () => {
    const bytes = glb([jsonChunk("{}")])
    // Claim the JSON chunk is far longer than the bytes that follow it.
    new DataView(bytes.buffer).setUint32(12, 4096, true)
    const result = readGlbChunks(bytes)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/past the end/)
  })
})

describe("writeGlb", () => {
  it("round-trips through readGlbChunks", () => {
    const json = encode('{"asset":{"version":"2.0"}}')
    const bin = new Uint8Array([9, 8, 7])
    const chunks = readGlbChunks(writeGlb(json, bin))

    expect(chunks.ok).toBe(true)
    if (chunks.ok) {
      expect(chunks.value[0]?.type).toBe(CHUNK_JSON)
      expect(chunks.value[1]?.type).toBe(CHUNK_BIN)
      // The BIN chunk keeps its bytes; only its padding grows.
      expect(chunks.value[1]?.data.subarray(0, 3)).toEqual(bin)
    }
  })

  it("writes a JSON-only GLB when there is no binary chunk", () => {
    const bytes = writeGlb(encode('{"a":1}'), null)
    const chunks = readGlbChunks(bytes)

    expect(chunks.ok && chunks.value).toHaveLength(1)
  })

  it("pads the JSON chunk with spaces so it stays parseable", () => {
    const bytes = writeGlb(encode('{"a":1}'), null)
    const chunks = readGlbChunks(bytes)
    if (!chunks.ok) throw new Error("expected a readable GLB")

    const text = new TextDecoder().decode(chunks.value[0]?.data)
    expect(text.length % 4).toBe(0)
    expect(JSON.parse(text)).toEqual({ a: 1 })
  })

  it("keeps every chunk 4-byte aligned", () => {
    const bytes = writeGlb(encode('{"a":1}'), new Uint8Array([1, 2, 3, 4, 5]))
    expect(bytes.byteLength % 4).toBe(0)
  })
})

describe("optimizeGlb", () => {
  it("strips insignificant whitespace from the JSON chunk", () => {
    const pretty = JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [0] }] }, null, 2)
    const result = optimizeGlb(glb([jsonChunk(pretty)]))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.optimizedBytes).toBeLessThan(result.value.originalBytes)
      const chunks = readGlbChunks(result.value.bytes)
      if (!chunks.ok) throw new Error("optimized GLB is unreadable")
      expect(JSON.parse(new TextDecoder().decode(chunks.value[0]?.data))).toEqual({
        asset: { version: "2.0" },
        scenes: [{ nodes: [0] }],
      })
    }
  })

  it("drops chunks the glTF spec tells clients to ignore", () => {
    const pretty = JSON.stringify({ asset: { version: "2.0" } }, null, 4)
    const withExtra = glb([
      jsonChunk(pretty),
      { type: CHUNK_BIN, data: new Uint8Array([1, 2, 3, 4]) },
      { type: 0x12345678, data: new Uint8Array(64) },
    ])

    const result = optimizeGlb(withExtra)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const chunks = readGlbChunks(result.value.bytes)
    expect(chunks.ok && chunks.value.map((c) => c.type)).toEqual([CHUNK_JSON, CHUNK_BIN])
  })

  it("preserves the binary chunk byte for byte", () => {
    const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const source = glb([jsonChunk(JSON.stringify({ asset: { version: "2.0" } }, null, 8)), { type: CHUNK_BIN, data: bin }])

    const result = optimizeGlb(source)
    if (!result.ok) throw new Error("expected an optimized GLB")
    const chunks = readGlbChunks(result.value.bytes)
    if (!chunks.ok) throw new Error("optimized GLB is unreadable")

    expect(chunks.value[1]?.data.subarray(0, bin.byteLength)).toEqual(bin)
  })

  it("returns the original when it is already minimal", () => {
    const source = glb([jsonChunk(JSON.stringify({ asset: { version: "2.0" } }))])
    const result = optimizeGlb(source)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.bytes).toBe(source)
      expect(result.value.optimizedBytes).toBe(result.value.originalBytes)
    }
  })

  it("leaves a GLB three exported no larger than it was", async () => {
    const source = await realGlb()
    const result = optimizeGlb(source)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.optimizedBytes).toBeLessThanOrEqual(result.value.originalBytes)
      // Whatever it did, the result is still a GLB a viewer can open.
      expect(readGlbChunks(result.value.bytes).ok).toBe(true)
    }
  })

  it("refuses bytes that are not a GLB at all", () => {
    const result = optimizeGlb(encode("this is not a model"))
    expect(result.ok).toBe(false)
  })

  it("accepts an exporter that padded its JSON chunk with NULs", () => {
    // Not spec-conformant, but common enough in the wild that refusing it would
    // reject models every viewer opens.
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }, null, 2))
    const nulPadded = glb([{ type: CHUNK_JSON, data: json }])
    const start = 12 + 8 + json.byteLength
    nulPadded.fill(0, start, start + ((4 - (json.byteLength % 4)) % 4))

    const result = optimizeGlb(nulPadded)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.optimizedBytes).toBeLessThan(result.value.originalBytes)
  })

  it("refuses a GLB whose JSON chunk is not JSON", () => {
    const result = optimizeGlb(glb([jsonChunk("{not json")]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toMatch(/not valid JSON/)
  })
})
