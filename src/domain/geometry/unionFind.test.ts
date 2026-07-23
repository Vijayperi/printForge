import { describe, expect, it } from "vitest"

import { UnionFind } from "@/src/domain/geometry/unionFind"

describe("UnionFind", () => {
  it("starts with every element its own root", () => {
    const uf = new UnionFind(3)
    expect(uf.find(0)).toBe(0)
    expect(uf.find(1)).toBe(1)
    expect(uf.find(2)).toBe(2)
  })

  it("unions elements into a shared root", () => {
    const uf = new UnionFind(4)
    uf.union(0, 1)
    uf.union(2, 3)
    expect(uf.find(0)).toBe(uf.find(1))
    expect(uf.find(2)).toBe(uf.find(3))
    expect(uf.find(0)).not.toBe(uf.find(2))
  })

  it("is a no-op when both elements are already connected", () => {
    const uf = new UnionFind(3)
    uf.union(0, 1)
    uf.union(0, 1) // already same root → early return
    expect(uf.countRoots([0, 1])).toBe(1)
  })

  it("attaches the smaller tree under the larger (union by size)", () => {
    const uf = new UnionFind(5)
    // Build a larger set {0,1,2} then union a singleton {3} — exercises the
    // size-swap so the singleton attaches under the larger root.
    uf.union(0, 1)
    uf.union(0, 2)
    uf.union(3, 0)
    expect(uf.find(3)).toBe(uf.find(0))
    // ...and the reverse order, so the swap runs in both directions.
    uf.union(4, 3)
    expect(uf.find(4)).toBe(uf.find(0))
  })

  it("compresses paths so repeated finds return the root", () => {
    const uf = new UnionFind(4)
    uf.union(0, 1)
    uf.union(1, 2)
    uf.union(2, 3)
    const root = uf.find(3)
    expect(uf.find(3)).toBe(root)
  })

  it("counts distinct roots among the given members", () => {
    const uf = new UnionFind(6)
    uf.union(0, 1)
    uf.union(2, 3)
    // roots: {0,1}, {2,3}, {4}, {5} restricted to members {0,2,4,5} → 4
    expect(uf.countRoots([0, 2, 4, 5])).toBe(4)
    expect(uf.countRoots([0, 1])).toBe(1)
  })
})
