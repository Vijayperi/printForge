import { describe, expect, it } from "vitest"

import { insertReturning, selectWhere } from "@/src/data/db"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

interface Row {
  id: string
  n: number
  [key: string]: unknown
}

describe("FakeDb", () => {
  it("constructs empty and via createFakeDb", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
    expect(createFakeDb()).toBeInstanceOf(FakeDb)
  })

  it("seeds and snapshots rows immutably", () => {
    const db = createFakeDb()
    db.seed("t", { id: "a", n: 1 })
    const snap = db.rows("t")
    snap[0]!["n"] = 999
    expect(db.rows("t")[0]?.["n"]).toBe(1) // snapshot is a copy
  })

  it("returns an empty snapshot for an unknown table", () => {
    expect(createFakeDb().rows("nope")).toEqual([])
  })

  it("inserts, enforcing the configured unique key", async () => {
    const db = createFakeDb({ t: { rows: [], unique: ["id"] } })
    const first = await db.from<Row>("t").insert({ id: "a", n: 1 }).select().single()
    expect(first.error).toBeNull()
    const dup = await db.from<Row>("t").insert({ id: "a", n: 2 }).select().single()
    expect(dup.error?.code).toBe("23505")
  })

  it("selects with eq filters, ordering, and limit", async () => {
    const db = createFakeDb({
      t: {
        rows: [
          { id: "a", n: 3 },
          { id: "b", n: 1 },
          { id: "c", n: 2 },
        ],
      },
    })
    const asc = await db.from<Row>("t").select().order("n", { ascending: true }).limit(2)
    expect(asc.data.map((r) => r.id)).toEqual(["b", "c"])

    const desc = await db.from<Row>("t").select().order("n", { ascending: false })
    expect(desc.data.map((r) => r.id)).toEqual(["a", "c", "b"])

    const filtered = await db.from<Row>("t").select().eq("id", "a")
    expect(filtered.data).toHaveLength(1)
  })

  it("orders with default ascending when opts omitted, and handles equal keys", async () => {
    const db = createFakeDb({ t: { rows: [{ id: "a", n: 1 }, { id: "b", n: 1 }] } })
    const res = await db.from<Row>("t").select().order("n")
    expect(res.data).toHaveLength(2)
  })

  it("maybeSingle returns the first row or null", async () => {
    const db = createFakeDb({ t: { rows: [{ id: "a", n: 1 }] } })
    expect((await db.from<Row>("t").select().eq("id", "a").maybeSingle()).data).toEqual({ id: "a", n: 1 })
    expect((await db.from<Row>("t").select().eq("id", "z").maybeSingle()).data).toBeNull()
  })

  it("updates matching rows and returns them", async () => {
    const db = createFakeDb({ t: { rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] } })
    const res = await db.from<Row>("t").update({ n: 9 }).eq("id", "a").select().single()
    expect(res.data).toEqual({ id: "a", n: 9 })
    expect(db.rows("t")).toContainEqual({ id: "b", n: 2 })
  })

  it("deletes matching rows", async () => {
    const db = createFakeDb({ t: { rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }] } })
    const res = await db.from<Row>("t").delete().eq("id", "a")
    expect(res.data).toEqual([{ id: "a", n: 1 }])
    expect(db.rows("t")).toEqual([{ id: "b", n: 2 }])
  })

  it("failNext injects an error once, then clears", async () => {
    const db = createFakeDb({ t: { rows: [] } })
    db.failNext({ message: "boom", code: "XX" })
    const failed = await db.from<Row>("t").select()
    expect(failed.error?.code).toBe("XX")
    const ok = await db.from<Row>("t").select()
    expect(ok.error).toBeNull()
  })

  it("failCall fails only the nth terminal op", async () => {
    const db = createFakeDb({ t: { rows: [{ id: "a", n: 1 }] } })
    db.failCall(2, { message: "second fails" })
    expect((await db.from<Row>("t").select()).error).toBeNull() // op 1 ok
    expect((await db.from<Row>("t").select()).error?.message).toBe("second fails") // op 2 fails
    expect((await db.from<Row>("t").select()).error).toBeNull() // op 3 ok
  })

  it("ensure creates a table only once", () => {
    const db = createFakeDb()
    db.ensure("t")
    db.seed("t", { id: "a", n: 1 })
    db.ensure("t") // must not wipe existing rows
    expect(db.rows("t")).toHaveLength(1)
  })

  it("interoperates with db.ts helpers", async () => {
    const db = createFakeDb({ t: { rows: [] } })
    await insertReturning(db, "t", { id: "a", n: 1 })
    const rows = await selectWhere(db, "t", [["id", "a"]])
    expect(rows.ok && rows.value).toHaveLength(1)
  })

  it("rejects a thenable rejection path", async () => {
    // Exercises the onrejected channel of the thenable.
    const db = createFakeDb({ t: { rows: [] } })
    const builder = db.from<Row>("t").select()
    await expect(
      Promise.resolve(builder).then(() => {
        throw new Error("downstream")
      })
    ).rejects.toThrow("downstream")
  })
})
