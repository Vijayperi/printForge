/**
 * Disjoint-set union with path compression and union-by-size. Backed by typed
 * arrays so the connectivity passes (components, boundary-loop counting) stay
 * allocation-light on the large perf fixture.
 */
export class UnionFind {
  private readonly parent: Int32Array
  private readonly size: Uint32Array

  constructor(count: number) {
    this.parent = new Int32Array(count)
    this.size = new Uint32Array(count)
    for (let i = 0; i < count; i += 1) {
      this.parent[i] = i
      this.size[i] = 1
    }
  }

  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root] as number
    // Path compression.
    let node = x
    while (this.parent[node] !== root) {
      const next = this.parent[node] as number
      this.parent[node] = root
      node = next
    }
    return root
  }

  union(a: number, b: number): void {
    let ra = this.find(a)
    let rb = this.find(b)
    if (ra === rb) return
    if ((this.size[ra] as number) < (this.size[rb] as number)) {
      const tmp = ra
      ra = rb
      rb = tmp
    }
    this.parent[rb] = ra
    this.size[ra] = (this.size[ra] as number) + (this.size[rb] as number)
  }

  /** Number of distinct roots among the indices in `members`. */
  countRoots(members: Iterable<number>): number {
    const roots = new Set<number>()
    for (const m of members) roots.add(this.find(m))
    return roots.size
  }
}
