import { describe, expect, it } from "vitest"

import { parseStl, type StlRejectKind } from "@/src/domain/geometry/stlParse"

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]

function binaryStl(triangles: number[][], header = ""): Uint8Array {
  const count = triangles.length
  const bytes = new Uint8Array(84 + 50 * count)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < header.length && i < 80; i += 1) bytes[i] = header.charCodeAt(i)
  view.setUint32(80, count, true)
  triangles.forEach((tri, i) => {
    const base = 84 + 50 * i + 12 // skip normal
    for (let v = 0; v < 9; v += 1) view.setFloat32(base + v * 4, tri[v] as number, true)
  })
  return bytes
}

function asciiStl(triangles: number[][]): Uint8Array {
  let s = "solid test\n"
  for (const t of triangles) {
    s += "facet normal 0 0 0\nouter loop\n"
    s += `vertex ${t[0]} ${t[1]} ${t[2]}\n`
    s += `vertex ${t[3]} ${t[4]} ${t[5]}\n`
    s += `vertex ${t[6]} ${t[7]} ${t[8]}\n`
    s += "endloop\nendfacet\n"
  }
  return new TextEncoder().encode(s + "endsolid test\n")
}

function expectReject(bytes: Uint8Array, kind: StlRejectKind, limits?: { maxBytes: number; maxTriangles: number }) {
  const result = parseStl(bytes, limits)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.kind).toBe(kind)
}

describe("parseStl — binary", () => {
  it("parses a valid binary STL and round-trips the triangle count and positions", () => {
    const result = parseStl(binaryStl([TRI, TRI]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.triangleCount).toBe(2)
      expect(result.value.positions.length).toBe(18)
      expect([...result.value.positions.slice(0, 9)]).toEqual(TRI)
    }
  })

  it("treats a binary file that starts with 'solid' as binary (layout wins)", () => {
    const result = parseStl(binaryStl([TRI], "solid but actually binary"))
    expect(result.ok && result.value.triangleCount).toBe(1)
  })

  it("rejects an empty binary mesh", () => {
    expectReject(binaryStl([]), "empty")
  })

  it("rejects a NaN vertex in binary", () => {
    const bytes = binaryStl([TRI])
    new DataView(bytes.buffer).setFloat32(84 + 12, Number.NaN, true)
    expectReject(bytes, "nan_vertex")
  })

  it("rejects when the byte length does not match the triangle count", () => {
    const bytes = binaryStl([TRI])
    new DataView(bytes.buffer).setUint32(80, 5, true) // claim 5 triangles, wrong length
    expectReject(bytes, "count_mismatch")
  })
})

describe("parseStl — ASCII", () => {
  it("parses a valid ASCII STL", () => {
    const result = parseStl(asciiStl([TRI]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.triangleCount).toBe(1)
      expect([...result.value.positions]).toEqual(TRI)
    }
  })

  it("rejects a NaN vertex in ASCII", () => {
    expectReject(new TextEncoder().encode("solid x\nfacet\nvertex NaN 0 0\nvertex 1 0 0\nvertex 0 1 0\n"), "nan_vertex")
  })

  it("rejects a facet with a non-multiple-of-3 vertex count", () => {
    expectReject(new TextEncoder().encode("solid x\nvertex 0 0 0\nvertex 1 0 0\nendsolid"), "count_mismatch")
  })

  it("rejects an ASCII file with a facet but no vertices", () => {
    expectReject(new TextEncoder().encode("solid x\nfacet normal 0 0 0\nendfacet\nendsolid"), "empty")
  })

  it("rejects a 'solid' file that is not recognizable STL", () => {
    expectReject(new TextEncoder().encode("solid x\njust some text here\nendsolid"), "unrecognized")
  })
})

describe("parseStl — size and shape guards", () => {
  it("rejects a file over the byte limit", () => {
    expectReject(binaryStl([TRI]), "too_large", { maxBytes: 10, maxTriangles: 2_000_000 })
  })

  it("rejects a binary mesh over the triangle limit", () => {
    expectReject(binaryStl([TRI, TRI]), "too_large", { maxBytes: 1e9, maxTriangles: 1 })
  })

  it("rejects an ASCII mesh over the triangle limit", () => {
    expectReject(asciiStl([TRI, TRI]), "too_large", { maxBytes: 1e9, maxTriangles: 1 })
  })

  it("rejects a file too small to be binary and not ASCII (truncated)", () => {
    expectReject(new Uint8Array([1, 2, 3]), "truncated")
  })

  it("rejects a large non-STL blob (count mismatch)", () => {
    expectReject(new Uint8Array(100), "count_mismatch")
  })
})
